import { Modal, App, Notice, requestUrl } from "obsidian";
import { AmazonSession, KINDLE_API_BASE } from "./types";

const LOG = "[Kindle Scribe Auth]";

/**
 * Manages Amazon authentication via Electron session cookies.
 * Provides login modal, session validation, and cookie extraction.
 */
export class AmazonAuthManager {
  private session: AmazonSession | null = null;

  constructor(private app: App) {}

  /** Returns the current session if valid, or null. */
  getSession(): AmazonSession | null {
    return this.session;
  }

  /** Sets session from persisted data (loaded on plugin start). */
  restoreSession(session: AmazonSession | null): void {
    this.session = session;
    if (session) {
      console.log(`${LOG} Restored session for marketplace: ${session.marketplace}, valid: ${session.isValid}`);
    }
  }

  /** Check if we have a valid session. */
  isAuthenticated(): boolean {
    return this.session !== null && this.session.isValid;
  }

  /**
   * Validate the current session by making a lightweight API call.
   * Returns true if the session is still valid.
   */
  async validateSession(): Promise<boolean> {
    if (!this.session) {
      console.log(`${LOG} No session to validate`);
      return false;
    }

    console.log(`${LOG} Validating session...`);
    try {
      const response = await requestUrl({
        url: `${KINDLE_API_BASE}/kindle-notebook/api/notes`,
        headers: {
          Cookie: this.session.cookies,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });
      const isValid = response.status === 200;
      this.session.isValid = isValid;
      this.session.lastValidated = Date.now();
      console.log(`${LOG} Session validation result: ${isValid} (status: ${response.status})`);
      return isValid;
    } catch (e: any) {
      console.error(`${LOG} Session validation failed:`, e.message);
      this.session.isValid = false;
      return false;
    }
  }

  /**
   * Open the Amazon login modal. Returns the session on success.
   */
  async login(marketplace: string): Promise<AmazonSession | null> {
    console.log(`${LOG} Opening login modal for marketplace: ${marketplace}`);
    return new Promise((resolve) => {
      const modal = new AmazonLoginModal(this.app, marketplace, (cookies) => {
        if (cookies) {
          console.log(`${LOG} Login successful, got ${cookies.length} chars of cookies`);
          this.session = {
            cookies,
            marketplace,
            isValid: true,
            lastValidated: Date.now(),
          };
          new Notice("Successfully logged in to Amazon.");
          resolve(this.session);
        } else {
          console.warn(`${LOG} Login completed but no cookies extracted`);
          new Notice("Login failed — could not extract session. Check console for details.");
          resolve(null);
        }
      });
      modal.open();
    });
  }

  /** Clear the current session (logout). */
  logout(): void {
    this.session = null;
    console.log(`${LOG} Session cleared`);
    new Notice("Logged out of Amazon.");
  }

  /**
   * Make an authenticated request using Obsidian's requestUrl.
   * This avoids CORS issues and works within the plugin sandbox.
   */
  async makeAuthenticatedRequest(
    url: string,
    options: { headers?: Record<string, string>; method?: string; body?: string } = {}
  ): Promise<Response> {
    if (!this.session || !this.session.cookies) {
      throw new Error("Not authenticated. Please log in to Amazon first.");
    }

    const headers: Record<string, string> = {
      Cookie: this.session.cookies,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      ...(options.headers || {}),
    };

    console.log(`${LOG} Request: ${options.method || "GET"} ${url}`);

    const response = await requestUrl({
      url,
      method: options.method || "GET",
      headers,
      body: options.body,
    });

    console.log(`${LOG} Response: ${response.status} from ${url}`);

    // Wrap in a Response-like object for compatibility
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      statusText: `${response.status}`,
      json: () => Promise.resolve(response.json),
      text: () => Promise.resolve(response.text),
      arrayBuffer: () => Promise.resolve(response.arrayBuffer),
      headers: new Headers(response.headers),
    } as unknown as Response;
  }
}

/**
 * Modal that displays Amazon's login page in a webview.
 * Extracts session cookies after successful authentication.
 *
 * Uses Electron's webview tag with a persistent partition.
 * Cookie extraction tries multiple approaches for compatibility
 * across different Electron/Obsidian versions.
 */
class AmazonLoginModal extends Modal {
  private marketplace: string;
  private onComplete: (cookies: string | null) => void;
  private webviewEl: HTMLElement | null = null;
  private completed = false;
  private partitionName: string;

  constructor(
    app: App,
    marketplace: string,
    onComplete: (cookies: string | null) => void
  ) {
    super(app);
    this.marketplace = marketplace;
    this.onComplete = onComplete;
    // Use a unique partition each time so there are NEVER cached cookies
    this.partitionName = `kindle-scribe-${Date.now()}`;
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("kindle-scribe-login-modal");
    this.modalEl.style.width = "650px";
    this.modalEl.style.height = "750px";

    contentEl.createEl("p", {
      text: "Loading Amazon login...",
      cls: "kindle-scribe-login-instructions",
    });

    // Render the login UI directly with a fresh partition
    this.renderLoginUI(contentEl);
  }

  /** Render the webview login interface. */
  private renderLoginUI(contentEl: HTMLElement): void {
    contentEl.empty();

    contentEl.createEl("p", {
      text: "Log in to your Amazon account below. Once you see the Kindle notebook page (or your Amazon homepage after login), click the button to complete setup.",
      cls: "kindle-scribe-login-instructions",
    });

    // Prominent "Done" button
    const buttonRow = contentEl.createDiv();
    buttonRow.style.marginBottom = "8px";
    buttonRow.style.display = "flex";
    buttonRow.style.justifyContent = "space-between";
    buttonRow.style.alignItems = "center";

    const hint = buttonRow.createEl("span", {
      text: "After logging in with the correct account:",
    });
    hint.style.fontSize = "0.85em";
    hint.style.color = "var(--text-muted)";

    const doneBtn = buttonRow.createEl("button", {
      text: "✓ Done — Extract Session",
      cls: "mod-cta",
    });
    doneBtn.addEventListener("click", () => this.attemptCookieExtraction());

    // Use login URL directly (ephemeral partition means fresh start)
    const loginUrl = this.getLoginUrl();
    console.log(`${LOG} Using ephemeral partition: ${this.partitionName}`);
    console.log(`${LOG} Login URL: ${loginUrl}`);

    // Create webview element for Amazon login
    this.webviewEl = contentEl.createEl("webview" as keyof HTMLElementTagNameMap) as any;
    const webview = this.webviewEl!;
    // Start directly at login page (ephemeral partition = no cached cookies)
    webview.setAttribute("src", loginUrl);
    webview.setAttribute("style", "width: 100%; height: 600px; border: 1px solid var(--background-modifier-border); border-radius: 4px;");
    // Ephemeral partition (no "persist:" prefix) — completely fresh, no cached cookies
    webview.setAttribute("partition", this.partitionName);
    webview.setAttribute("useragent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

    // Log all navigations for debugging (no auto-detection — user clicks button when ready)
    webview.addEventListener("did-navigate", (event: any) => {
      const url = event.url || "";
      console.log(`${LOG} Webview navigated to: ${url}`);
    });

    webview.addEventListener("did-navigate-in-page", (event: any) => {
      const url = event.url || "";
      console.log(`${LOG} Webview in-page navigation: ${url}`);
    });

    webview.addEventListener("did-fail-load", (event: any) => {
      console.error(`${LOG} Webview failed to load:`, event.errorCode, event.errorDescription);
      if (event.errorCode !== -3) { // -3 is aborted (normal during redirects)
        new Notice(`Page load failed: ${event.errorDescription}`);
      }
    });

    webview.addEventListener("dom-ready", () => {
      console.log(`${LOG} Webview DOM ready`);
    });

    webview.addEventListener("console-message", (event: any) => {
      // Forward webview console messages for debugging
      if (event.level >= 2) { // warnings and errors
        console.log(`${LOG} [webview console] ${event.message}`);
      }
    });
  }

  onClose(): void {
    if (!this.completed) {
      console.log(`${LOG} Login modal closed without completing`);
      this.onComplete(null);
    }
    this.contentEl.empty();
    this.webviewEl = null;
  }

  /** Check if a URL indicates successful login. */
  private isPostLoginUrl(url: string): boolean {
    // Only trigger on the actual Kindle notebook page, not intermediate redirects
    const isPost = (
      url.includes("read.amazon.com/kindle-notebook") ||
      url.includes("read.amazon.com/notebook")
    );
    return isPost;
  }

  /** Try to extract cookies and complete the login flow. */
  private async attemptCookieExtraction(): Promise<void> {
    if (this.completed) return;

    console.log(`${LOG} Attempting cookie extraction...`);
    const cookies = await this.extractCookies();

    if (cookies && cookies.length > 10) {
      console.log(`${LOG} Successfully extracted ${cookies.length} chars of cookies`);
      console.log(`${LOG} Cookie names: ${this.getCookieNames(cookies)}`);
      this.completed = true;
      this.onComplete(cookies);
      this.close();
    } else {
      console.warn(`${LOG} Cookie extraction returned insufficient data: "${cookies?.substring(0, 50)}..."`);
      new Notice("Could not extract cookies yet. Try clicking the button again after the page fully loads.");
    }
  }

  /** Get just the cookie names for debug logging (not values). */
  private getCookieNames(cookieStr: string): string {
    return cookieStr
      .split("; ")
      .map((c) => c.split("=")[0])
      .join(", ");
  }

  private getLoginUrl(): string {
    const baseUrls: Record<string, string> = {
      US: "https://www.amazon.com",
      UK: "https://www.amazon.co.uk",
      DE: "https://www.amazon.de",
      FR: "https://www.amazon.fr",
      ES: "https://www.amazon.es",
      IT: "https://www.amazon.it",
      JP: "https://www.amazon.co.jp",
      CA: "https://www.amazon.ca",
      AU: "https://www.amazon.com.au",
      IN: "https://www.amazon.in",
    };

    const base = baseUrls[this.marketplace] || baseUrls["US"];
    // Standard Amazon sign-in that redirects to the Kindle notebook page after login
    const returnTo = encodeURIComponent("https://read.amazon.com/kindle-notebook");
    return `${base}/ap/signin?openid.pape.max_auth_age=0&openid.return_to=${returnTo}&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=amzn_kindle_mykindle_us&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0`;
  }

  private getSignOutUrl(): string {
    const baseUrls: Record<string, string> = {
      US: "https://www.amazon.com",
      UK: "https://www.amazon.co.uk",
      DE: "https://www.amazon.de",
      FR: "https://www.amazon.fr",
      ES: "https://www.amazon.es",
      IT: "https://www.amazon.it",
      JP: "https://www.amazon.co.jp",
      CA: "https://www.amazon.ca",
      AU: "https://www.amazon.com.au",
      IN: "https://www.amazon.in",
    };

    const base = baseUrls[this.marketplace] || baseUrls["US"];
    return `${base}/gp/flex/sign-out.html?action=sign-out&ref_=nav_AccountFlyout_signout`;
  }

  /**
   * Extract cookies from the webview's Electron session.
   * Tries multiple approaches for compatibility across Obsidian versions.
   */
  private async extractCookies(): Promise<string | null> {
    // Approach 1: Electron session API (most reliable)
    const sessionCookies = await this.extractViaSessionAPI();
    if (sessionCookies) return sessionCookies;

    // Approach 2: executeJavaScript on the webview
    const jsCookies = await this.extractViaJavaScript();
    if (jsCookies) return jsCookies;

    // Approach 3: Try accessing the webContents directly
    const wcCookies = await this.extractViaWebContents();
    if (wcCookies) return wcCookies;

    console.error(`${LOG} All cookie extraction methods failed`);
    return null;
  }

  /** Approach 1: Use Electron's session.cookies API. */
  private async extractViaSessionAPI(): Promise<string | null> {
    try {
      console.log(`${LOG} Trying session API extraction...`);

      // In modern Obsidian, electron.remote may not be available
      // Try multiple ways to access the session
      let session: any = null;

      // Try 1: Direct electron require
      try {
        const electron = require("electron");
        if (electron.remote?.session) {
          session = electron.remote.session;
          console.log(`${LOG} Got session via electron.remote`);
        }
      } catch (e) {
        console.log(`${LOG} electron.remote not available`);
      }

      // Try 2: @electron/remote package
      if (!session) {
        try {
          const remote = require("@electron/remote");
          session = remote.session;
          console.log(`${LOG} Got session via @electron/remote`);
        } catch (e) {
          console.log(`${LOG} @electron/remote not available`);
        }
      }

      if (!session) {
        console.log(`${LOG} No session API available`);
        return null;
      }

      const ses = session.fromPartition(this.partitionName);
      const allCookies = await ses.cookies.get({});
      console.log(`${LOG} Session API returned ${allCookies.length} total cookies`);

      // Filter to Amazon-related cookies
      const amazonCookies = allCookies.filter(
        (cookie: any) =>
          cookie.domain.includes("amazon") ||
          cookie.domain.includes(".amazon.")
      );

      console.log(`${LOG} Found ${amazonCookies.length} Amazon cookies`);

      if (amazonCookies.length === 0) {
        return null;
      }

      // Check for critical auth cookies
      const cookieNames = amazonCookies.map((c: any) => c.name);
      const hasSessionId = cookieNames.some((n: string) =>
        n.includes("session-id") || n.includes("ubid") || n.includes("at-main")
      );
      console.log(`${LOG} Has auth-related cookies: ${hasSessionId}`);
      console.log(`${LOG} Cookie names: ${cookieNames.join(", ")}`);

      return amazonCookies
        .map((cookie: any) => `${cookie.name}=${cookie.value}`)
        .join("; ");
    } catch (e: any) {
      console.warn(`${LOG} Session API extraction failed:`, e.message);
      return null;
    }
  }

  /** Approach 2: Execute JavaScript in the webview to get document.cookie. */
  private async extractViaJavaScript(): Promise<string | null> {
    try {
      console.log(`${LOG} Trying JavaScript extraction...`);

      if (!this.webviewEl) {
        console.log(`${LOG} No webview element available`);
        return null;
      }

      const webview = this.webviewEl as any;
      if (!webview.executeJavaScript) {
        console.log(`${LOG} webview.executeJavaScript not available`);
        return null;
      }

      const cookies = await webview.executeJavaScript("document.cookie");
      console.log(`${LOG} JavaScript extraction got ${cookies?.length || 0} chars`);

      if (cookies && cookies.length > 10) {
        return cookies;
      }
      return null;
    } catch (e: any) {
      console.warn(`${LOG} JavaScript extraction failed:`, e.message);
      return null;
    }
  }

  /** Approach 3: Access webContents session directly. */
  private async extractViaWebContents(): Promise<string | null> {
    try {
      console.log(`${LOG} Trying webContents extraction...`);

      if (!this.webviewEl) return null;

      const webview = this.webviewEl as any;

      // The webview element has a getWebContentsId() method in Electron
      if (webview.getWebContentsId) {
        const id = webview.getWebContentsId();
        console.log(`${LOG} WebContents ID: ${id}`);

        // Try to get the session from the webContents
        const electron = require("electron");
        if (electron.remote) {
          const wc = electron.remote.webContents.fromId(id);
          if (wc) {
            const allCookies = await wc.session.cookies.get({});
            const amazonCookies = allCookies.filter(
              (cookie: any) =>
                cookie.domain.includes("amazon") ||
                cookie.domain.includes(".amazon.")
            );
            if (amazonCookies.length > 0) {
              console.log(`${LOG} WebContents extraction got ${amazonCookies.length} cookies`);
              return amazonCookies
                .map((cookie: any) => `${cookie.name}=${cookie.value}`)
                .join("; ");
            }
          }
        }
      }

      return null;
    } catch (e: any) {
      console.warn(`${LOG} WebContents extraction failed:`, e.message);
      return null;
    }
  }
}

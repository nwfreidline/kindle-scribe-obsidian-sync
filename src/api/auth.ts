import { Modal, App, Notice, requestUrl } from "obsidian";
import { AmazonSession, KINDLE_API_BASE } from "./types";

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
    if (!this.session) return false;

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
      return isValid;
    } catch {
      this.session.isValid = false;
      return false;
    }
  }

  /**
   * Open the Amazon login modal. Returns the session on success.
   */
  async login(marketplace: string): Promise<AmazonSession | null> {
    return new Promise((resolve) => {
      const modal = new AmazonLoginModal(this.app, marketplace, (cookies) => {
        if (cookies) {
          this.session = {
            cookies,
            marketplace,
            isValid: true,
            lastValidated: Date.now(),
          };
          new Notice("Successfully logged in to Amazon.");
          resolve(this.session);
        } else {
          resolve(null);
        }
      });
      modal.open();
    });
  }

  /** Clear the current session (logout). */
  logout(): void {
    this.session = null;
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

    const response = await requestUrl({
      url,
      method: options.method || "GET",
      headers,
      body: options.body,
    });

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
 * Uses Electron's BrowserWindow via the webview tag, which is the
 * standard approach for Obsidian plugins that need browser-based auth.
 */
class AmazonLoginModal extends Modal {
  private marketplace: string;
  private onComplete: (cookies: string | null) => void;
  private webviewEl: HTMLElement | null = null;

  constructor(
    app: App,
    marketplace: string,
    onComplete: (cookies: string | null) => void
  ) {
    super(app);
    this.marketplace = marketplace;
    this.onComplete = onComplete;
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("kindle-scribe-login-modal");

    contentEl.createEl("p", {
      text: "Log in to your Amazon account to enable Kindle Scribe sync. The window will close automatically after login.",
      cls: "kindle-scribe-login-instructions",
    });

    // Determine the login URL based on marketplace
    const loginUrl = this.getLoginUrl();

    // Create webview element for Amazon login
    // The webview tag is supported in Electron-based apps like Obsidian
    this.webviewEl = contentEl.createEl("webview" as keyof HTMLElementTagNameMap) as any;
    const webview = this.webviewEl!;
    webview.setAttribute("src", loginUrl);
    webview.setAttribute("style", "width: 100%; height: 580px; border: none; border-radius: 4px;");
    webview.setAttribute("partition", "persist:kindle-scribe");
    webview.setAttribute("useragent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

    // Listen for navigation to detect successful login
    webview.addEventListener("did-navigate", async (event: any) => {
      const url = event.url || "";
      if (this.isPostLoginUrl(url)) {
        try {
          const cookies = await this.extractCookies();
          if (cookies) {
            this.onComplete(cookies);
            this.close();
          }
        } catch (e) {
          console.error("[Kindle Scribe] Failed to extract cookies:", e);
          new Notice("Failed to extract login session. Please try again.");
        }
      }
    });

    // Also listen for in-page navigation
    webview.addEventListener("did-navigate-in-page", async (event: any) => {
      const url = event.url || "";
      if (this.isPostLoginUrl(url)) {
        try {
          const cookies = await this.extractCookies();
          if (cookies) {
            this.onComplete(cookies);
            this.close();
          }
        } catch (e) {
          console.error("[Kindle Scribe] Failed to extract cookies:", e);
        }
      }
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.webviewEl = null;
  }

  /** Check if a URL indicates successful login. */
  private isPostLoginUrl(url: string): boolean {
    return (
      url.includes("read.amazon.com") ||
      url.includes("amazon.com/ap/maplanding") ||
      url.includes("amazon.com/gp/css") ||
      (url.includes("amazon.") && url.includes("/ref="))
    );
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
    return `${base}/ap/signin?openid.return_to=https://read.amazon.com/kindle-notebook&openid.mode=checkid_setup&openid.ns=http://specs.openid.net/auth/2.0`;
  }

  /**
   * Extract cookies from the webview's Electron session.
   * Tries multiple approaches for compatibility.
   */
  private async extractCookies(): Promise<string | null> {
    try {
      // Approach 1: Use Electron's session API via the webview's partition
      const electron = require("electron");
      const { session } = electron.remote || (await this.getRemoteModule());

      if (session) {
        const ses = session.fromPartition("persist:kindle-scribe");
        const allCookies = await ses.cookies.get({});

        // Filter to Amazon-related cookies
        const amazonCookies = allCookies.filter(
          (cookie: any) =>
            cookie.domain.includes("amazon") ||
            cookie.domain.includes(".amazon.")
        );

        if (amazonCookies.length === 0) {
          return null;
        }

        return amazonCookies
          .map((cookie: any) => `${cookie.name}=${cookie.value}`)
          .join("; ");
      }
    } catch (e) {
      console.warn("[Kindle Scribe] Primary cookie extraction failed, trying fallback:", e);
    }

    try {
      // Approach 2: Execute JavaScript in the webview to get document.cookie
      if (this.webviewEl) {
        const webview = this.webviewEl as any;
        if (webview.executeJavaScript) {
          const cookies = await webview.executeJavaScript("document.cookie");
          if (cookies && cookies.length > 0) {
            return cookies;
          }
        }
      }
    } catch (e) {
      console.warn("[Kindle Scribe] Fallback cookie extraction failed:", e);
    }

    return null;
  }

  /** Try to get the remote module (handles different Electron versions). */
  private async getRemoteModule(): Promise<any> {
    try {
      return require("@electron/remote");
    } catch {
      return null;
    }
  }
}

import { Modal, App, Notice } from "obsidian";
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
      const response = await this.makeAuthenticatedRequest(
        `${KINDLE_API_BASE}/kindle-notebook/api/notes`
      );
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
   * Make an authenticated request using stored cookies.
   * This wraps the fetch with the necessary cookie headers.
   */
  async makeAuthenticatedRequest(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    if (!this.session || !this.session.cookies) {
      throw new Error("Not authenticated. Please log in to Amazon first.");
    }

    const headers = new Headers(options.headers);
    headers.set("Cookie", this.session.cookies);
    headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

    return fetch(url, {
      ...options,
      headers,
      credentials: "include",
    });
  }
}

/**
 * Modal that displays Amazon's login page in a webview.
 * Extracts session cookies after successful authentication.
 */
class AmazonLoginModal extends Modal {
  private marketplace: string;
  private onComplete: (cookies: string | null) => void;

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
      text: "Log in to your Amazon account to enable Kindle Scribe sync.",
      cls: "kindle-scribe-login-instructions",
    });

    // Determine the login URL based on marketplace
    const loginUrl = this.getLoginUrl();

    // Create webview element for Amazon login
    const webview = contentEl.createEl("webview" as keyof HTMLElementTagNameMap) as any;
    webview.setAttribute("src", loginUrl);
    webview.setAttribute("style", "width: 100%; height: 600px; border: none;");
    webview.setAttribute("partition", "persist:kindle-scribe");

    // Listen for navigation to detect successful login
    webview.addEventListener("did-navigate", async (event: any) => {
      const url = event.url || "";
      // After login, Amazon redirects to the main page
      if (url.includes("read.amazon.com") || url.includes("amazon.com/ap/maplanding")) {
        try {
          const cookies = await this.extractCookies(webview);
          this.onComplete(cookies);
          this.close();
        } catch (e) {
          console.error("Failed to extract cookies:", e);
        }
      }
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }

  private getLoginUrl(): string {
    // Amazon login URL that redirects to the Kindle notebook page
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

  private async extractCookies(webview: any): Promise<string> {
    // Use Electron's session API to get cookies from the webview partition
    const { session } = require("electron").remote || require("@electron/remote");
    const ses = session.fromPartition("persist:kindle-scribe");
    const cookies = await ses.cookies.get({ domain: ".amazon.com" });

    return cookies
      .map((cookie: any) => `${cookie.name}=${cookie.value}`)
      .join("; ");
  }
}

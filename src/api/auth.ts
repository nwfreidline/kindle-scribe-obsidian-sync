import { Modal, App, Notice, requestUrl } from "obsidian";
import { AmazonSession, KINDLE_API_BASE } from "./types";

const LOG = "[Kindle Scribe Auth]";

/**
 * Manages Amazon authentication using a hidden webview.
 * 
 * Instead of extracting cookies (which fails for HttpOnly cookies),
 * this keeps a hidden webview element alive after login and routes
 * all API calls through it via executeJavaScript(fetch(...)).
 * The browser automatically includes all cookies (including HttpOnly).
 */
export class AmazonAuthManager {
  private session: AmazonSession | null = null;
  private webviewEl: HTMLElement | null = null;
  private webviewReady = false;

  constructor(private app: App) {}

  getSession(): AmazonSession | null {
    return this.session;
  }

  restoreSession(session: AmazonSession | null): void {
    this.session = session;
    if (session) {
      console.log(`${LOG} Restored session for marketplace: ${session.marketplace}`);
    }
  }

  isAuthenticated(): boolean {
    return this.session !== null && this.session.isValid;
  }

  /**
   * Validate the current session by making a test API call.
   */
  async validateSession(): Promise<boolean> {
    if (!this.session) return false;

    // If we have a live webview, test via that
    if (this.webviewReady && this.webviewEl) {
      try {
        const result = await this.webviewFetch("/kindle-notebook/api/notes");
        const isValid = result !== null && !result.startsWith("<!") && !result.startsWith("FETCH_ERROR");
        this.session.isValid = isValid;
        console.log(`${LOG} Session validation via webview: ${isValid}`);
        return isValid;
      } catch {
        this.session.isValid = false;
        return false;
      }
    }

    // No webview — session is stale, need to re-login
    console.log(`${LOG} No active webview, session needs re-login`);
    this.session.isValid = false;
    return false;
  }

  /**
   * Open the Amazon login modal. Returns the session on success.
   */
  async login(marketplace: string): Promise<AmazonSession | null> {
    console.log(`${LOG} Opening login modal for marketplace: ${marketplace}`);

    // Destroy any existing webview
    this.destroyWebview();

    return new Promise((resolve) => {
      const modal = new AmazonLoginModal(this.app, marketplace, (webviewEl) => {
        if (webviewEl) {
          // Keep the webview alive for API calls
          this.webviewEl = webviewEl;
          this.webviewReady = true;
          this.session = {
            cookies: "__WEBVIEW_SESSION__",
            marketplace,
            isValid: true,
            lastValidated: Date.now(),
          };
          console.log(`${LOG} Login successful, webview session active`);
          new Notice("Successfully logged in to Amazon.");
          resolve(this.session);
        } else {
          resolve(null);
        }
      });
      modal.open();
    });
  }

  /** Clear the current session. */
  logout(): void {
    this.destroyWebview();
    this.session = null;
    console.log(`${LOG} Session cleared`);
    new Notice("Logged out of Amazon.");
  }

  /**
   * Make an authenticated API request by routing through the webview.
   * The webview's browser session includes all HttpOnly cookies automatically.
   */
  async makeAuthenticatedRequest(
    url: string,
    options: { headers?: Record<string, string>; method?: string; body?: string } = {}
  ): Promise<Response> {
    if (!this.session || !this.session.isValid) {
      throw new Error("Not authenticated. Please log in to Amazon first.");
    }

    if (!this.webviewEl || !this.webviewReady) {
      throw new Error("Session expired. Please log in again.");
    }

    const method = options.method || "GET";
    console.log(`${LOG} Request: ${method} ${url}`);

    // Route the request through the webview
    const result = await this.webviewFetch(url, {
      method,
      headers: options.headers,
      body: options.body,
    });

    if (result === null) {
      throw new Error(`Request failed: no response from webview`);
    }

    // Determine if it's JSON or an error page
    const isJson = result.startsWith("{") || result.startsWith("[");
    const status = isJson ? 200 : 401;

    console.log(`${LOG} Response: ${status} (${result.length} chars) from ${url}`);

    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: `${status}`,
      json: () => Promise.resolve(JSON.parse(result)),
      text: () => Promise.resolve(result),
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(result).buffer),
      headers: new Headers(),
    } as unknown as Response;
  }

  /**
   * Make a fetch request for binary data from inside the webview.
   * Uses Blob + FileReader for reliable base64 encoding of large buffers.
   */
  async makeAuthenticatedBinaryRequest(
    url: string,
    options: { headers?: Record<string, string> } = {}
  ): Promise<ArrayBuffer> {
    if (!this.webviewEl || !this.webviewReady) {
      throw new Error("Session expired. Please log in again.");
    }

    const headersJson = JSON.stringify(options.headers || {});

    const base64 = await this.executeInWebview(`
      (async () => {
        try {
          const resp = await fetch(${JSON.stringify(url)}, {
            credentials: "include",
            headers: ${headersJson}
          });
          if (!resp.ok) return "ERROR:" + resp.status;
          const buf = await resp.arrayBuffer();
          // Use Blob + FileReader for reliable base64 encoding
          return new Promise((resolve, reject) => {
            const blob = new Blob([buf]);
            const reader = new FileReader();
            reader.onloadend = () => {
              const dataUrl = reader.result;
              const base64Part = dataUrl.split(",")[1];
              resolve(base64Part);
            };
            reader.onerror = () => reject("ERROR:FileReader failed");
            reader.readAsDataURL(blob);
          });
        } catch(e) {
          return "ERROR:" + e.message;
        }
      })()
    `);

    if (!base64 || (typeof base64 === "string" && base64.startsWith("ERROR:"))) {
      throw new Error(`Binary request failed: ${base64}`);
    }

    // Decode base64 to ArrayBuffer
    const binaryStr = atob(base64 as string);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    console.log(`${LOG} Binary response: ${bytes.length} bytes from ${url}`);
    return bytes.buffer;
  }

  /** Execute a fetch inside the webview and return the text response. */
  private async webviewFetch(
    url: string,
    options: { method?: string; headers?: Record<string, string>; body?: string } = {}
  ): Promise<string | null> {
    const fetchUrl = url.startsWith("http") ? url : `${KINDLE_API_BASE}${url}`;
    const method = options.method || "GET";
    const headersJson = JSON.stringify(options.headers || {});
    const bodyArg = options.body ? `, body: ${JSON.stringify(options.body)}` : "";

    const script = `
      (async () => {
        try {
          const resp = await fetch(${JSON.stringify(fetchUrl)}, {
            method: ${JSON.stringify(method)},
            credentials: "include",
            headers: ${headersJson}${bodyArg}
          });
          return await resp.text();
        } catch(e) {
          return "FETCH_ERROR:" + e.message;
        }
      })()
    `;

    return this.executeInWebview(script);
  }

  /** Execute JavaScript in the webview. */
  private async executeInWebview(script: string): Promise<string | null> {
    if (!this.webviewEl) return null;
    const webview = this.webviewEl as any;
    if (!webview.executeJavaScript) return null;

    try {
      return await webview.executeJavaScript(script);
    } catch (e: any) {
      console.error(`${LOG} executeJavaScript failed:`, e.message);
      return null;
    }
  }

  /** Destroy the hidden webview. */
  private destroyWebview(): void {
    if (this.webviewEl) {
      this.webviewEl.remove();
      this.webviewEl = null;
      this.webviewReady = false;
    }
  }
}

/**
 * Login modal that shows Amazon's sign-in page.
 * After login, passes the webview element back to the auth manager
 * (instead of extracting cookies).
 */
class AmazonLoginModal extends Modal {
  private marketplace: string;
  private onComplete: (webviewEl: HTMLElement | null) => void;
  private webviewEl: HTMLElement | null = null;
  private completed = false;

  constructor(
    app: App,
    marketplace: string,
    onComplete: (webviewEl: HTMLElement | null) => void
  ) {
    super(app);
    this.marketplace = marketplace;
    this.onComplete = onComplete;
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("kindle-scribe-login-modal");
    this.modalEl.style.width = "650px";
    this.modalEl.style.height = "750px";

    contentEl.createEl("p", {
      text: "Log in to your Amazon account. Once you see the Kindle notebook page, click Done.",
      cls: "kindle-scribe-login-instructions",
    });

    // Done button
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
      text: "✓ Done — Complete Login",
      cls: "mod-cta",
    });
    doneBtn.addEventListener("click", () => this.completeLogin());

    // Use a unique ephemeral partition — guarantees fresh login every time
    const partitionName = `kindle-scribe-${Date.now()}`;
    const loginUrl = "https://read.amazon.com/kindle-notebook";
    console.log(`${LOG} Partition: ${partitionName}`);
    console.log(`${LOG} Starting at: ${loginUrl}`);

    // Create webview
    this.webviewEl = contentEl.createEl("webview" as keyof HTMLElementTagNameMap) as any;
    const webview = this.webviewEl!;
    webview.setAttribute("src", loginUrl);
    webview.setAttribute("style", "width: 100%; height: 600px; border: 1px solid var(--background-modifier-border); border-radius: 4px;");
    webview.setAttribute("partition", partitionName);
    webview.setAttribute("useragent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

    webview.addEventListener("did-navigate", (event: any) => {
      console.log(`${LOG} Navigated: ${event.url}`);
    });

    webview.addEventListener("did-fail-load", (event: any) => {
      if (event.errorCode !== -3) {
        console.error(`${LOG} Load failed: ${event.errorCode} ${event.errorDescription}`);
      }
    });
  }

  onClose(): void {
    if (!this.completed) {
      console.log(`${LOG} Modal closed without completing`);
      this.onComplete(null);
    }
    // Don't destroy the webview if login completed — it's now owned by the auth manager
    if (!this.completed && this.webviewEl) {
      this.webviewEl.remove();
      this.webviewEl = null;
    }
    this.contentEl.empty();
  }

  /** Verify login worked and pass the webview to the auth manager. */
  private async completeLogin(): Promise<void> {
    if (this.completed || !this.webviewEl) return;

    const webview = this.webviewEl as any;
    if (!webview.executeJavaScript) {
      new Notice("Error: webview not ready");
      return;
    }

    const currentUrl = await webview.executeJavaScript("window.location.href");
    console.log(`${LOG} Current webview URL: ${currentUrl}`);
    console.log(`${LOG} Navigating webview directly to API endpoint...`);

    // Navigate directly to the API endpoint — the browser will send all cookies
    // (including HttpOnly) automatically since it's a same-origin-policy navigation
    webview.setAttribute("src", "https://read.amazon.com/kindle-notebook/api/notes");

    // Wait for it to load
    await new Promise<void>((resolve) => {
      const onFinish = () => {
        webview.removeEventListener("did-finish-load", onFinish);
        resolve();
      };
      webview.addEventListener("did-finish-load", onFinish);
      setTimeout(resolve, 8000);
    });

    // Check what we got — if authenticated, the page content will be JSON
    const newUrl = await webview.executeJavaScript("window.location.href");
    console.log(`${LOG} After API navigation, URL is: ${newUrl}`);

    const pageContent = await webview.executeJavaScript("document.body.innerText || document.body.textContent");
    console.log(`${LOG} Page content (first 200): ${pageContent?.substring(0, 200)}`);

    if (pageContent && (pageContent.startsWith("{") || pageContent.startsWith("["))) {
      // We got JSON! The session works. The webview is on read.amazon.com/kindle-notebook/api/notes
      // which is perfect for making API calls via fetch.
      console.log(`${LOG} API access confirmed! Setting up webview proxy.`);
      this.completed = true;

      // Move webview to hidden container
      const oldContainer = document.getElementById("kindle-scribe-hidden-webview");
      oldContainer?.remove();
      const hiddenContainer = document.body.createDiv();
      hiddenContainer.style.display = "none";
      hiddenContainer.id = "kindle-scribe-hidden-webview";
      hiddenContainer.appendChild(this.webviewEl);

      this.onComplete(this.webviewEl);
      this.webviewEl = null;
      this.close();
    } else if (newUrl.includes("/ap/signin") || newUrl.includes("amazon.com/ap/")) {
      // Redirected to login — the session isn't valid for read.amazon.com
      console.error(`${LOG} Redirected to login page. SSO not working.`);
      new Notice("Amazon session not recognized by Kindle service. Please log in again — make sure you complete the full login flow.");
      // Navigate back to login
      webview.setAttribute("src", "https://read.amazon.com/kindle-notebook");
    } else {
      console.error(`${LOG} Unexpected response. URL: ${newUrl}, Content: ${pageContent?.substring(0, 100)}`);
      new Notice("Could not verify Kindle access. Check console for details.");
    }
  }
}

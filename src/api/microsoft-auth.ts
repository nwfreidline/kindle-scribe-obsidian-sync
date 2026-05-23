import { App, Modal, Notice, requestUrl } from "obsidian";

const LOG = "[Kindle Scribe] MS Auth:";

// Microsoft OAuth2 configuration
// Using device code flow for desktop apps (no redirect URI needed)
const MS_AUTH_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const MS_GRAPH_URL = "https://graph.microsoft.com/v1.0";

// Public client ID — Microsoft Graph PowerShell app registration
// This is a well-known multi-tenant public client that supports personal accounts,
// device code flow, and broad Graph API scopes including Notes.Read.
const DEFAULT_CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e";

/** Scopes needed for OneNote read access */
const SCOPES = [
  "Notes.Read",
  "User.Read",
  "offline_access",
];

/** Microsoft auth token */
export interface MSAuthToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

/**
 * Manages Microsoft authentication using device code flow.
 * This doesn't require a redirect URI — user enters a code on microsoft.com.
 */
export class MicrosoftAuthManager {
  private token: MSAuthToken | null = null;
  private clientId: string = "";

  constructor(private app: App) {}

  /** Set the client ID from settings. Falls back to default public client. */
  setClientId(clientId: string): void {
    this.clientId = clientId || DEFAULT_CLIENT_ID;
  }

  /** Restore token from persisted data. */
  restoreToken(token: MSAuthToken | null): void {
    this.token = token;
  }

  /** Get the current token. */
  getToken(): MSAuthToken | null {
    return this.token;
  }

  /** Check if we have a valid (non-expired) token. */
  isAuthenticated(): boolean {
    if (!this.token) return false;
    // Consider expired if within 5 minutes of expiry
    return this.token.expiresAt > Date.now() + 300000;
  }

  /**
   * Get a valid access token, refreshing if needed.
   */
  async getAccessToken(): Promise<string> {
    if (!this.token) {
      throw new Error("Not authenticated. Please log in to Microsoft.");
    }

    // Refresh if expired or about to expire
    if (this.token.expiresAt <= Date.now() + 300000) {
      console.log(`${LOG} Token expired, refreshing...`);
      await this.refreshAccessToken();
    }

    return this.token.accessToken;
  }

  /**
   * Start the device code login flow.
   * Shows a modal with the code and URL for the user to authenticate.
   */
  async login(): Promise<MSAuthToken | null> {
    if (!this.clientId) {
      this.clientId = DEFAULT_CLIENT_ID;
    }

    console.log(`${LOG} Starting device code flow...`);

    // Step 1: Request device code
    let deviceCodeResponse: any;
    try {
      deviceCodeResponse = await requestUrl({
        url: `${MS_AUTH_URL}/devicecode`,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `client_id=${encodeURIComponent(this.clientId)}&scope=${encodeURIComponent(SCOPES.join(" "))}`,
      });
    } catch (e: any) {
      console.error(`${LOG} Device code request error:`, e.message, e);
      // Try to extract response body from the error
      const errorBody = e.response?.text || e.message || "Unknown error";
      console.error(`${LOG} Error details:`, errorBody);
      new Notice(`Login failed: ${e.message}. Check console.`);
      return null;
    }

    if (deviceCodeResponse.status !== 200) {
      console.error(`${LOG} Device code request failed:`, deviceCodeResponse.status, deviceCodeResponse.text);
      new Notice(`Failed to start login (${deviceCodeResponse.status}). Check console for details.`);
      return null;
    }

    const deviceCode = deviceCodeResponse.json;
    console.log(`${LOG} Device code received. User code: ${deviceCode.user_code}`);

    // Step 2: Show modal with instructions
    return new Promise((resolve) => {
      const modal = new DeviceCodeModal(
        this.app,
        deviceCode.user_code,
        deviceCode.verification_uri,
        deviceCode.message,
        async (closeModal) => {
          // Step 3: Poll for token
          const token = await this.pollForToken(
            deviceCode.device_code,
            deviceCode.interval || 5,
            deviceCode.expires_in || 900
          );

          if (token) {
            this.token = token;
            closeModal();
            new Notice("Successfully logged in to Microsoft.");
            resolve(token);
          } else {
            closeModal();
            new Notice("Login timed out or was cancelled.");
            resolve(null);
          }
        }
      );
      modal.open();
    });
  }

  /** Logout — clear the token. */
  logout(): void {
    this.token = null;
    new Notice("Logged out of Microsoft.");
  }

  /**
   * Make an authenticated request to Microsoft Graph API.
   */
  async graphRequest(
    endpoint: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
  ): Promise<any> {
    const accessToken = await this.getAccessToken();
    const url = endpoint.startsWith("http") ? endpoint : `${MS_GRAPH_URL}${endpoint}`;

    const response = await requestUrl({
      url,
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      body: options.body,
    });

    if (response.status === 401) {
      // Token might be invalid, try refresh
      console.log(`${LOG} Got 401, attempting token refresh...`);
      await this.refreshAccessToken();
      // Retry once
      const retryResponse = await requestUrl({
        url,
        method: options.method || "GET",
        headers: {
          Authorization: `Bearer ${this.token!.accessToken}`,
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
        body: options.body,
      });
      return retryResponse.json;
    }

    if (response.status >= 400) {
      throw new Error(`Graph API error: ${response.status} ${response.text}`);
    }

    return response.json;
  }

  /**
   * Make a request that returns HTML content (for OneNote page content).
   */
  async graphRequestHtml(endpoint: string): Promise<string> {
    const accessToken = await this.getAccessToken();
    const url = endpoint.startsWith("http") ? endpoint : `${MS_GRAPH_URL}${endpoint}`;

    const response = await requestUrl({
      url,
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "text/html",
      },
    });

    if (response.status >= 400) {
      throw new Error(`Graph API error: ${response.status}`);
    }

    return response.text;
  }

  /** Poll Microsoft's token endpoint until the user completes auth. */
  private async pollForToken(
    deviceCode: string,
    interval: number,
    expiresIn: number
  ): Promise<MSAuthToken | null> {
    const deadline = Date.now() + expiresIn * 1000;
    const pollInterval = Math.max(interval, 5) * 1000;

    while (Date.now() < deadline) {
      await this.delay(pollInterval);

      try {
        const response = await requestUrl({
          url: `${MS_AUTH_URL}/token`,
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: [
            `grant_type=urn:ietf:params:oauth:grant-type:device_code`,
            `client_id=${encodeURIComponent(this.clientId)}`,
            `device_code=${encodeURIComponent(deviceCode)}`,
          ].join("&"),
          throw: false,
        });

        if (response.status === 200) {
          const data = response.json;
          console.log(`${LOG} Token received!`);
          return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || "",
            expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
            scope: data.scope || "",
          };
        }

        // Check for "authorization_pending" — keep polling
        const error = response.json;
        if (error.error === "authorization_pending") {
          console.log(`${LOG} Waiting for user approval...`);
          continue;
        }
        if (error.error === "slow_down") {
          await this.delay(5000);
          continue;
        }

        // Any other error — stop polling
        console.error(`${LOG} Token poll error:`, error.error, error.error_description);
        return null;
      } catch (e: any) {
        // requestUrl throws on non-200 — parse the error response
        try {
          // The error might contain the response body
          const errorText = e.message || "";
          if (errorText.includes("400")) {
            // Likely authorization_pending — keep polling
            console.log(`${LOG} Polling... (waiting for user approval)`);
            continue;
          }
        } catch { /* ignore */ }

        console.error(`${LOG} Token poll exception:`, e.message);
        // Don't stop on transient errors — keep polling
        continue;
      }
    }

    console.error(`${LOG} Token poll timed out`);
    return null; // Timed out
  }

  /** Refresh the access token using the refresh token. */
  private async refreshAccessToken(): Promise<void> {
    if (!this.token?.refreshToken) {
      throw new Error("No refresh token available. Please log in again.");
    }

    const response = await requestUrl({
      url: `${MS_AUTH_URL}/token`,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: [
        `grant_type=refresh_token`,
        `client_id=${encodeURIComponent(this.clientId)}`,
        `refresh_token=${encodeURIComponent(this.token.refreshToken)}`,
        `scope=${encodeURIComponent(SCOPES.join(" "))}`,
      ].join("&"),
    });

    if (response.status !== 200) {
      this.token = null;
      throw new Error("Token refresh failed. Please log in again.");
    }

    const data = response.json;
    this.token = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || this.token.refreshToken,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
      scope: data.scope || this.token.scope,
    };

    console.log(`${LOG} Token refreshed successfully`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Modal that shows the device code and instructions for Microsoft login.
 */
class DeviceCodeModal extends Modal {
  private userCode: string;
  private verificationUri: string;
  private message: string;
  private onStartPolling: (closeModal: () => void) => void;

  constructor(
    app: App,
    userCode: string,
    verificationUri: string,
    message: string,
    onStartPolling: (closeModal: () => void) => void
  ) {
    super(app);
    this.userCode = userCode;
    this.verificationUri = verificationUri;
    this.message = message;
    this.onStartPolling = onStartPolling;
  }

  onOpen(): void {
    const { contentEl } = this;

    contentEl.createEl("h3", { text: "Sign in to Microsoft" });

    contentEl.createEl("p", { text: "To connect your OneNote notebooks:" });

    const steps = contentEl.createEl("ol");
    steps.createEl("li", { text: `Go to: ${this.verificationUri}` });
    steps.createEl("li", { text: `Enter this code:` });

    // Big code display
    const codeEl = contentEl.createEl("div");
    codeEl.style.fontSize = "2em";
    codeEl.style.fontWeight = "bold";
    codeEl.style.textAlign = "center";
    codeEl.style.padding = "16px";
    codeEl.style.margin = "12px 0";
    codeEl.style.background = "var(--background-modifier-border)";
    codeEl.style.borderRadius = "8px";
    codeEl.style.fontFamily = "monospace";
    codeEl.style.letterSpacing = "0.1em";
    codeEl.textContent = this.userCode;

    // Copy button
    const copyBtn = contentEl.createEl("button", { text: "Copy code to clipboard" });
    copyBtn.style.display = "block";
    copyBtn.style.margin = "0 auto 16px";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(this.userCode);
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy code to clipboard"; }, 2000);
    });

    // Open browser button
    const openBtn = contentEl.createEl("button", {
      text: "Open Microsoft login page",
      cls: "mod-cta",
    });
    openBtn.style.display = "block";
    openBtn.style.margin = "0 auto 16px";
    openBtn.addEventListener("click", () => {
      window.open(this.verificationUri);
    });

    contentEl.createEl("p", {
      text: "After signing in and approving access, this window will close automatically.",
      cls: "setting-item-description",
    });

    // Start polling immediately
    this.onStartPolling(() => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

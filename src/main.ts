import { Notice, Plugin } from "obsidian";
import { MicrosoftAuthManager, MSAuthToken } from "./api/microsoft-auth";
import { OneNoteSyncEngine, OneNoteSyncResult } from "./sync/onenote-engine";
import { SyncState, createEmptySyncState } from "./sync/state";
import { SyncProgressModal, SyncStatusBar } from "./utils/progress";
import {
  KindleScribeSettings,
  KindleScribeSettingTab,
  DEFAULT_SETTINGS,
} from "./settings";

/** Persisted plugin data shape. */
interface PluginData {
  settings: KindleScribeSettings;
  msToken: MSAuthToken | null;
  syncState: SyncState;
}

/**
 * Kindle Scribe Sync — Obsidian Plugin
 *
 * Syncs handwritten notes from Kindle Scribe (via OneNote) into the vault.
 * Kindle Scribe → OneNote (automatic) → This plugin → Obsidian markdown
 */
export default class KindleScribePlugin extends Plugin {
  settings: KindleScribeSettings = DEFAULT_SETTINGS;
  private msAuth!: MicrosoftAuthManager;
  private syncEngine!: OneNoteSyncEngine;
  private syncIntervalId: number | null = null;
  private statusBar: SyncStatusBar | null = null;

  async onload(): Promise<void> {
    // Load persisted data
    const data = await this.loadPersistedData();
    this.settings = data.settings;

    // Initialize Microsoft auth
    this.msAuth = new MicrosoftAuthManager(this.app);
    this.msAuth.setClientId(this.settings.msClientId);
    this.msAuth.restoreToken(data.msToken);

    // Initialize sync engine
    this.syncEngine = new OneNoteSyncEngine(
      this.app,
      this.msAuth,
      this.settings,
      async () => data.syncState || createEmptySyncState(),
      async (state) => {
        const current = await this.loadPersistedData();
        current.syncState = state;
        await this.saveData(current);
      }
    );
    await this.syncEngine.initialize();

    // Register settings tab
    this.addSettingTab(new KindleScribeSettingTab(this.app, this));

    // Register commands
    this.addCommand({
      id: "sync-notes",
      name: "Sync notes",
      callback: () => this.runSync(false),
    });

    this.addCommand({
      id: "sync-all-notes",
      name: "Sync all notes (force)",
      callback: () => this.runSync(true),
    });

    this.addCommand({
      id: "login-microsoft",
      name: "Login to Microsoft",
      callback: () => this.loginToMicrosoft(),
    });

    this.addCommand({
      id: "logout-microsoft",
      name: "Logout from Microsoft",
      callback: () => this.logoutFromMicrosoft(),
    });

    // Add ribbon icon
    this.addRibbonIcon("notebook", "Sync Kindle Scribe", () => {
      this.runSync(false);
    });

    // Add status bar item
    const statusBarItemEl = this.addStatusBarItem();
    this.statusBar = new SyncStatusBar(statusBarItemEl);
    const state = this.syncEngine.getState();
    this.statusBar.setIdle(state.lastSyncTime);

    // Auto-sync on startup
    if (this.settings.autoSync) {
      this.registerInterval(
        window.setTimeout(() => this.runSync(false), 5000) as any
      );
    }

    // Set up sync interval
    this.setupSyncInterval();
  }

  onunload(): void {
    this.clearSyncInterval();
  }

  /** Save settings and update dependent components. */
  async saveSettings(): Promise<void> {
    const data = await this.loadPersistedData();
    data.settings = this.settings;
    await this.saveData(data);

    // Update auth client ID
    this.msAuth.setClientId(this.settings.msClientId);

    // Rebuild sync engine with new settings
    this.syncEngine = new OneNoteSyncEngine(
      this.app,
      this.msAuth,
      this.settings,
      async () => {
        const d = await this.loadPersistedData();
        return d.syncState || createEmptySyncState();
      },
      async (state) => {
        const d = await this.loadPersistedData();
        d.syncState = state;
        await this.saveData(d);
      }
    );
    await this.syncEngine.initialize();

    this.setupSyncInterval();
  }

  /** Start Microsoft login flow. */
  async loginToMicrosoft(): Promise<void> {
    const token = await this.msAuth.login();
    if (token) {
      const data = await this.loadPersistedData();
      data.msToken = token;
      await this.saveData(data);
    }
  }

  /** Logout from Microsoft. */
  async logoutFromMicrosoft(): Promise<void> {
    this.msAuth.logout();
    const data = await this.loadPersistedData();
    data.msToken = null;
    await this.saveData(data);
  }

  /** Run a sync operation. */
  private async runSync(forceAll: boolean): Promise<void> {
    if (!this.msAuth.isAuthenticated()) {
      new Notice("Please log in to Microsoft first (Settings → Kindle Scribe Sync).");
      return;
    }

    const progressModal = new SyncProgressModal(this.app);
    progressModal.open();
    this.statusBar?.setSyncing();

    try {
      progressModal.updateProgress(0, 1, "Syncing from OneNote...");
      const result = await this.syncEngine.sync(forceAll);

      if (result.success) {
        const msg = `Synced ${result.synced} page(s), ${result.skipped} up to date.`;
        progressModal.complete(msg);
        this.statusBar?.setIdle(Date.now());
      } else {
        const msg = `Completed with ${result.errors.length} error(s). ${result.synced} synced.`;
        progressModal.complete(msg);
        this.statusBar?.setError();
        for (const error of result.errors) {
          console.error(`[Kindle Scribe] ${error}`);
        }
      }
    } catch (e: any) {
      progressModal.complete(`Sync failed: ${e.message}`);
      this.statusBar?.setError();
      console.error("[Kindle Scribe] Sync error:", e);
    }
  }

  /** Set up the periodic sync interval. */
  private setupSyncInterval(): void {
    this.clearSyncInterval();
    if (this.settings.syncInterval > 0) {
      const intervalMs = this.settings.syncInterval * 60 * 1000;
      this.syncIntervalId = window.setInterval(() => {
        this.runSync(false);
      }, intervalMs);
      this.registerInterval(this.syncIntervalId);
    }
  }

  /** Clear the periodic sync interval. */
  private clearSyncInterval(): void {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  /** Load persisted plugin data with defaults. */
  private async loadPersistedData(): Promise<PluginData> {
    const raw = await this.loadData();
    return {
      settings: { ...DEFAULT_SETTINGS, ...(raw?.settings || {}) },
      msToken: raw?.msToken || null,
      syncState: raw?.syncState || createEmptySyncState(),
    };
  }
}

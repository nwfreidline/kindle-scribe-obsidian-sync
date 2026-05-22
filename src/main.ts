import { Notice, Plugin } from "obsidian";
import { AmazonAuthManager } from "./api/auth";
import { AmazonSession } from "./api/types";
import { OCRProvider } from "./processing/ocr";
import { OpenRouterProvider } from "./processing/providers/openrouter";
import { OpenAIProvider } from "./processing/providers/openai";
import { AnthropicProvider } from "./processing/providers/anthropic";
import { SyncEngine, SyncResult } from "./sync/engine";
import { SyncState, createEmptySyncState } from "./sync/state";
import {
  KindleScribeSettings,
  KindleScribeSettingTab,
  DEFAULT_SETTINGS,
} from "./settings";

/** Persisted plugin data shape. */
interface PluginData {
  settings: KindleScribeSettings;
  session: AmazonSession | null;
  syncState: SyncState;
}

/**
 * Kindle Scribe Sync — Obsidian Plugin
 *
 * Syncs handwritten notes from Amazon Kindle Scribe into the vault.
 * Supports incremental sync, configurable output formats, and
 * AI-powered OCR transcription.
 */
export default class KindleScribePlugin extends Plugin {
  settings: KindleScribeSettings = DEFAULT_SETTINGS;
  private auth!: AmazonAuthManager;
  private syncEngine!: SyncEngine;
  private syncIntervalId: number | null = null;

  async onload(): Promise<void> {
    // Load persisted data
    const data = await this.loadPersistedData();
    this.settings = data.settings;

    // Initialize auth manager
    this.auth = new AmazonAuthManager(this.app);
    this.auth.restoreSession(data.session);

    // Initialize sync engine
    this.syncEngine = new SyncEngine(
      this.app,
      this.auth,
      this.settings,
      this.getOCRProvider(),
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
      id: "login",
      name: "Login to Amazon",
      callback: () => this.loginToAmazon(),
    });

    this.addCommand({
      id: "logout",
      name: "Logout from Amazon",
      callback: () => this.logoutFromAmazon(),
    });

    // Add ribbon icon
    this.addRibbonIcon("notebook", "Sync Kindle Scribe", () => {
      this.runSync(false);
    });

    // Auto-sync on startup
    if (this.settings.autoSync) {
      // Delay to let Obsidian finish loading
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

    // Rebuild sync engine with new settings
    this.syncEngine = new SyncEngine(
      this.app,
      this.auth,
      this.settings,
      this.getOCRProvider(),
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

    // Update sync interval
    this.setupSyncInterval();
  }

  /** Open the Amazon login modal. */
  async loginToAmazon(): Promise<void> {
    const session = await this.auth.login(this.settings.marketplace);
    if (session) {
      const data = await this.loadPersistedData();
      data.session = session;
      await this.saveData(data);
    }
  }

  /** Clear the Amazon session. */
  async logoutFromAmazon(): Promise<void> {
    this.auth.logout();
    const data = await this.loadPersistedData();
    data.session = null;
    await this.saveData(data);
  }

  /** Run a sync operation (incremental or full). */
  private async runSync(forceAll: boolean): Promise<void> {
    if (!this.auth.isAuthenticated()) {
      new Notice("Please log in to Amazon first (Settings → Kindle Scribe Sync).");
      return;
    }

    new Notice("Kindle Scribe: Starting sync...");

    let result: SyncResult;
    try {
      if (forceAll) {
        result = await this.syncEngine.syncAll((current, total, message) => {
          // Could update a status bar here in the future
          console.log(`[Kindle Scribe] ${message} (${current}/${total})`);
        });
      } else {
        result = await this.syncEngine.syncIncremental((current, total, message) => {
          console.log(`[Kindle Scribe] ${message} (${current}/${total})`);
        });
      }

      if (result.success) {
        new Notice(
          `Kindle Scribe: Synced ${result.synced} notebook(s), ${result.skipped} up to date.`
        );
      } else {
        new Notice(
          `Kindle Scribe: Sync completed with errors. ${result.errors.length} error(s).`
        );
        for (const error of result.errors) {
          console.error(`[Kindle Scribe] ${error}`);
        }
      }
    } catch (e: any) {
      new Notice(`Kindle Scribe: Sync failed — ${e.message}`);
      console.error("[Kindle Scribe] Sync error:", e);
    }
  }

  /** Get the configured OCR provider, or null if none selected. */
  private getOCRProvider(): OCRProvider | null {
    switch (this.settings.aiProvider) {
      case "openrouter":
        if (!this.settings.apiKey) return null;
        return new OpenRouterProvider(this.settings.apiKey, this.settings.aiModel);
      case "openai":
        if (!this.settings.apiKey) return null;
        return new OpenAIProvider(this.settings.apiKey, this.settings.aiModel);
      case "anthropic":
        if (!this.settings.apiKey) return null;
        return new AnthropicProvider(this.settings.apiKey, this.settings.aiModel);
      default:
        return null;
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
      session: raw?.session || null,
      syncState: raw?.syncState || createEmptySyncState(),
    };
  }
}

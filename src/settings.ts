import { App, PluginSettingTab, Setting } from "obsidian";
import type KindleScribePlugin from "./main";
import { DEFAULT_TEMPLATE } from "./output/templates";

/** Supported output formats. */
export type OutputFormat = "pdf" | "images" | "transcribed" | "combined";

/** Supported AI providers. */
export type AIProvider = "none" | "openrouter" | "openai" | "anthropic";

/** Supported sync sources. */
export type SyncSource = "kindle-direct" | "onenote";

/** Plugin settings interface. */
export interface KindleScribeSettings {
  syncSource: SyncSource;
  outputFolder: string;
  marketplace: string;
  outputFormat: OutputFormat;
  aiProvider: AIProvider;
  apiKey: string;
  aiModel: string;
  autoSync: boolean;
  syncInterval: number;
  noteTemplate: string;
  pageDpi: number;
  /** Microsoft App Client ID for OneNote access. */
  msClientId: string;
  /** Which OneNote notebook to sync from (by name or ID). */
  onenoteNotebook: string;
}

/** Default settings values. */
export const DEFAULT_SETTINGS: KindleScribeSettings = {
  syncSource: "onenote",
  outputFolder: "Kindle Scribe",
  marketplace: "US",
  outputFormat: "combined",
  aiProvider: "none",
  apiKey: "",
  aiModel: "google/gemini-2.5-flash",
  autoSync: false,
  syncInterval: 0,
  noteTemplate: DEFAULT_TEMPLATE,
  pageDpi: 50,
  msClientId: "",
  onenoteNotebook: "",
};

/**
 * Settings tab for the Kindle Scribe Sync plugin.
 * Uses Obsidian-native UI components (no React).
 */
export class KindleScribeSettingTab extends PluginSettingTab {
  plugin: KindleScribePlugin;

  constructor(app: App, plugin: KindleScribePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("kindle-scribe-settings");

    containerEl.createEl("h2", { text: "Kindle Scribe Sync" });
    containerEl.createEl("p", {
      text: "Syncs your Kindle Scribe notes from OneNote into Obsidian as markdown.",
      cls: "setting-item-description",
    });

    // --- Microsoft Connection ---
    containerEl.createEl("h3", { text: "Microsoft Account" });

    new Setting(containerEl)
      .setName("App Client ID")
      .setDesc("Azure App Registration Client ID. Required for OneNote access. See README for setup instructions.")
      .addText((text) => {
        text.setPlaceholder("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx");
        text.setValue(this.plugin.settings.msClientId);
        text.onChange(async (value) => {
          this.plugin.settings.msClientId = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Microsoft Account")
      .setDesc("Sign in to access your OneNote notebooks.")
      .addButton((button) => {
        button.setButtonText("Login").onClick(async () => {
          await this.plugin.loginToMicrosoft();
        });
      })
      .addButton((button) => {
        button.setButtonText("Logout").setWarning().onClick(async () => {
          await this.plugin.logoutFromMicrosoft();
        });
      });

    // --- OneNote Settings ---
    containerEl.createEl("h3", { text: "OneNote" });

    new Setting(containerEl)
      .setName("Notebook name")
      .setDesc("Name of the OneNote notebook to sync from. Leave empty to sync from all notebooks.")
      .addText((text) => {
        text.setPlaceholder("My Notebook");
        text.setValue(this.plugin.settings.onenoteNotebook);
        text.onChange(async (value) => {
          this.plugin.settings.onenoteNotebook = value;
          await this.plugin.saveSettings();
        });
      });

    // --- Output Section ---
    containerEl.createEl("h3", { text: "Output" });

    new Setting(containerEl)
      .setName("Output folder")
      .setDesc("Vault folder where synced notes will be saved.")
      .addText((text) => {
        text.setPlaceholder("Kindle Scribe");
        text.setValue(this.plugin.settings.outputFolder);
        text.onChange(async (value) => {
          this.plugin.settings.outputFolder = value || "Kindle Scribe";
          await this.plugin.saveSettings();
        });
      });

    // --- Sync Section ---
    containerEl.createEl("h3", { text: "Sync" });

    new Setting(containerEl)
      .setName("Auto-sync on startup")
      .setDesc("Automatically sync when Obsidian starts.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.autoSync);
        toggle.onChange(async (value) => {
          this.plugin.settings.autoSync = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Sync interval (minutes)")
      .setDesc("Automatically sync at this interval. Set to 0 to disable.")
      .addText((text) => {
        text.setPlaceholder("0");
        text.setValue(this.plugin.settings.syncInterval.toString());
        text.onChange(async (value) => {
          const num = parseInt(value) || 0;
          this.plugin.settings.syncInterval = Math.max(0, num);
          await this.plugin.saveSettings();
        });
      });

    // --- Template Section ---
    containerEl.createEl("h3", { text: "Note Template" });

    new Setting(containerEl)
      .setName("Output template")
      .setDesc(
        "Customize the markdown output. Variables: {{title}}, {{date}}, {{modified}}, {{pages}}, {{content}}"
      )
      .addTextArea((textarea) => {
        textarea.setPlaceholder(DEFAULT_TEMPLATE);
        textarea.setValue(this.plugin.settings.noteTemplate);
        textarea.inputEl.rows = 12;
        textarea.inputEl.cols = 50;
        textarea.onChange(async (value) => {
          this.plugin.settings.noteTemplate = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).addButton((button) => {
      button.setButtonText("Reset template to default").onClick(async () => {
        this.plugin.settings.noteTemplate = DEFAULT_TEMPLATE;
        await this.plugin.saveSettings();
        this.display();
      });
    });
  }
}

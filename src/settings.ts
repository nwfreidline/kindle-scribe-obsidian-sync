import { App, PluginSettingTab, Setting } from "obsidian";
import type KindleScribePlugin from "./main";
import { MARKETPLACES } from "./api/types";
import { DEFAULT_TEMPLATE } from "./output/templates";

/** Supported output formats. */
export type OutputFormat = "pdf" | "images" | "transcribed" | "combined";

/** Supported AI providers. */
export type AIProvider = "none" | "openrouter" | "openai" | "anthropic";

/** Plugin settings interface. */
export interface KindleScribeSettings {
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
}

/** Default settings values. */
export const DEFAULT_SETTINGS: KindleScribeSettings = {
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

    // --- Connection Section ---
    containerEl.createEl("h3", { text: "Connection" });

    new Setting(containerEl)
      .setName("Amazon Marketplace")
      .setDesc("Select your Amazon region.")
      .addDropdown((dropdown) => {
        for (const key of Object.keys(MARKETPLACES)) {
          dropdown.addOption(key, key);
        }
        dropdown.setValue(this.plugin.settings.marketplace);
        dropdown.onChange(async (value) => {
          this.plugin.settings.marketplace = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Login to Amazon")
      .setDesc("Authenticate with your Amazon account to access Kindle Scribe notebooks.")
      .addButton((button) => {
        button.setButtonText("Login").onClick(async () => {
          await this.plugin.loginToAmazon();
        });
      })
      .addButton((button) => {
        button.setButtonText("Logout").setWarning().onClick(async () => {
          this.plugin.logoutFromAmazon();
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

    new Setting(containerEl)
      .setName("Output format")
      .setDesc("How to save synced notebooks.")
      .addDropdown((dropdown) => {
        dropdown.addOption("pdf", "PDF");
        dropdown.addOption("images", "Markdown with images");
        dropdown.addOption("transcribed", "Transcribed text (requires AI)");
        dropdown.addOption("combined", "Combined (text + images)");
        dropdown.setValue(this.plugin.settings.outputFormat);
        dropdown.onChange(async (value) => {
          this.plugin.settings.outputFormat = value as OutputFormat;
          await this.plugin.saveSettings();
          this.display(); // Refresh to show/hide AI settings
        });
      });

    new Setting(containerEl)
      .setName("Page DPI")
      .setDesc("Render quality for page images. Higher = better quality but slower sync.")
      .addSlider((slider) => {
        slider.setLimits(25, 150, 25);
        slider.setValue(this.plugin.settings.pageDpi);
        slider.setDynamicTooltip();
        slider.onChange(async (value) => {
          this.plugin.settings.pageDpi = value;
          await this.plugin.saveSettings();
        });
      });

    // --- AI / OCR Section ---
    const needsAI =
      this.plugin.settings.outputFormat === "transcribed" ||
      this.plugin.settings.outputFormat === "combined";

    if (needsAI) {
      containerEl.createEl("h3", { text: "AI Transcription (OCR)" });

      new Setting(containerEl)
        .setName("AI Provider")
        .setDesc("Select the AI service for handwriting transcription.")
        .addDropdown((dropdown) => {
          dropdown.addOption("none", "None (images only)");
          dropdown.addOption("openrouter", "OpenRouter");
          dropdown.addOption("openai", "OpenAI");
          dropdown.addOption("anthropic", "Anthropic");
          dropdown.setValue(this.plugin.settings.aiProvider);
          dropdown.onChange(async (value) => {
            this.plugin.settings.aiProvider = value as AIProvider;
            await this.plugin.saveSettings();
            this.display();
          });
        });

      if (this.plugin.settings.aiProvider !== "none") {
        new Setting(containerEl)
          .setName("API Key")
          .setDesc("Your API key for the selected provider.")
          .addText((text) => {
            text.setPlaceholder("sk-...");
            text.setValue(this.plugin.settings.apiKey);
            text.inputEl.type = "password";
            text.onChange(async (value) => {
              this.plugin.settings.apiKey = value;
              await this.plugin.saveSettings();
            });
          });

        new Setting(containerEl)
          .setName("AI Model")
          .setDesc("Model identifier to use for transcription.")
          .addText((text) => {
            text.setPlaceholder("google/gemini-2.5-flash");
            text.setValue(this.plugin.settings.aiModel);
            text.onChange(async (value) => {
              this.plugin.settings.aiModel = value;
              await this.plugin.saveSettings();
            });
          });
      }
    }

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
        "Customize the markdown output. Available variables: {{title}}, {{date}}, {{modified}}, {{pages}}, {{content}}"
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

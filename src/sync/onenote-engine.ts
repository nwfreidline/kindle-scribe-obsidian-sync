import { App, Notice } from "obsidian";
import { MicrosoftAuthManager } from "../api/microsoft-auth";
import { OneNoteClient, OneNotePage, htmlToMarkdown } from "../api/onenote";
import { KindleScribeSettings } from "../settings";
import { SyncState, createEmptySyncState, updateNotebookState } from "./state";
import { renderTemplate, DEFAULT_TEMPLATE } from "../output/templates";

const LOG = "[Kindle Scribe] OneNote Sync:";

export interface OneNoteSyncResult {
  success: boolean;
  synced: number;
  skipped: number;
  errors: string[];
}

/**
 * Sync engine that pulls pages from OneNote (where Kindle Scribe syncs text)
 * and writes them as Markdown notes in the Obsidian vault.
 */
export class OneNoteSyncEngine {
  private client: OneNoteClient;
  private state: SyncState;

  constructor(
    private app: App,
    private auth: MicrosoftAuthManager,
    private settings: KindleScribeSettings,
    private loadState: () => Promise<SyncState>,
    private saveState: (state: SyncState) => Promise<void>
  ) {
    this.client = new OneNoteClient(auth);
    this.state = createEmptySyncState();
  }

  async initialize(): Promise<void> {
    this.state = await this.loadState();
  }

  getState(): SyncState {
    return this.state;
  }

  /**
   * Sync all pages from the configured OneNote notebook.
   */
  async sync(forceAll: boolean = false): Promise<OneNoteSyncResult> {
    const result: OneNoteSyncResult = { success: true, synced: 0, skipped: 0, errors: [] };

    if (!this.auth.isAuthenticated()) {
      result.success = false;
      result.errors.push("Not authenticated. Please log in to Microsoft.");
      return result;
    }

    try {
      // Find the target notebook
      const notebooks = await this.client.listNotebooks();
      console.log(`${LOG} Available notebooks: ${notebooks.map(n => n.displayName).join(", ")}`);

      const targetNotebook = this.settings.onenoteNotebook
        ? notebooks.find(
            (n) =>
              n.displayName.toLowerCase() === this.settings.onenoteNotebook.toLowerCase() ||
              n.id === this.settings.onenoteNotebook
          )
        : notebooks[0]; // Default to first notebook

      if (!targetNotebook) {
        result.success = false;
        result.errors.push(
          `Notebook "${this.settings.onenoteNotebook}" not found. Available: ${notebooks.map((n) => n.displayName).join(", ")}`
        );
        return result;
      }

      console.log(`${LOG} Syncing from notebook: "${targetNotebook.displayName}"`);

      // Get all sections and pages
      const sectionsWithPages = await this.client.getAllPagesFromNotebook(targetNotebook.id);

      // Ensure output folder exists
      await this.ensureFolder(this.settings.outputFolder);

      // Process each section
      for (const { section, pages } of sectionsWithPages) {
        console.log(`${LOG} Section "${section.displayName}": ${pages.length} pages`);

        for (const page of pages) {
          try {
            // Check if page needs syncing (unless force)
            if (!forceAll && !this.needsSync(page)) {
              result.skipped++;
              continue;
            }

            // Fetch page content
            const html = await this.client.getPageContent(page.id);
            const markdown = htmlToMarkdown(html);

            // Apply template
            const output = this.applyTemplate(page, section.displayName, markdown);

            // Write to vault
            const filename = this.sanitizeFilename(page.title || "Untitled");
            const filePath = `${this.settings.outputFolder}/${filename}.md`;
            await this.writeFile(filePath, output);

            // Update state
            this.state = updateNotebookState(
              this.state,
              page.id,
              page.title,
              new Date(page.lastModifiedDateTime).getTime(),
              1
            );

            result.synced++;
            console.log(`${LOG} Synced: "${page.title}"`);
          } catch (e: any) {
            result.errors.push(`${page.title}: ${e.message}`);
            console.error(`${LOG} Failed to sync "${page.title}":`, e);
          }
        }
      }

      // Save state
      await this.saveState(this.state);
      result.success = result.errors.length === 0;

    } catch (e: any) {
      result.success = false;
      result.errors.push(e.message);
      console.error(`${LOG} Sync failed:`, e);
    }

    return result;
  }

  /** Check if a page needs syncing based on modification time. */
  private needsSync(page: OneNotePage): boolean {
    const existing = this.state.notebooks[page.id];
    if (!existing) return true;

    const pageModified = new Date(page.lastModifiedDateTime).getTime();
    return pageModified > existing.lastModified;
  }

  /** Apply the note template to page content. */
  private applyTemplate(page: OneNotePage, sectionName: string, content: string): string {
    const template = this.settings.noteTemplate || DEFAULT_TEMPLATE;

    return renderTemplate(template, {
      title: page.title || "Untitled",
      date: new Date().toISOString().split("T")[0],
      modified: page.lastModifiedDateTime.split("T")[0],
      pages: "1",
      content,
    });
  }

  /** Write or update a file in the vault. */
  private async writeFile(path: string, content: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) {
      await this.app.vault.modify(existing as any, content);
    } else {
      await this.app.vault.create(path, content);
    }
  }

  /** Ensure a folder exists. */
  private async ensureFolder(path: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (!existing) {
      await this.app.vault.createFolder(path);
    }
  }

  /** Sanitize a filename. */
  private sanitizeFilename(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, "_").trim();
  }
}

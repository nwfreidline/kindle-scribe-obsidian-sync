import { App, Notice, TFolder } from "obsidian";
import { AmazonAuthManager } from "../api/auth";
import { NotebookClient } from "../api/notebooks";
import { NotebookMetadata, PageImage } from "../api/types";
import { OCRProvider } from "../processing/ocr";
import { MarkdownGenerator } from "../output/markdown";
import { PdfGenerator } from "../output/pdf";
import { KindleScribeSettings, OutputFormat } from "../settings";
import {
  SyncState,
  createEmptySyncState,
  getNotebooksToSync,
  updateNotebookState,
} from "./state";

/** Callback for sync progress updates. */
export type SyncProgressCallback = (
  current: number,
  total: number,
  message: string
) => void;

/** Result of a sync operation. */
export interface SyncResult {
  success: boolean;
  synced: number;
  skipped: number;
  errors: string[];
}

/**
 * Orchestrates the sync process: fetches notebooks from Amazon,
 * determines what needs updating, downloads pages, processes them,
 * and writes output to the vault.
 */
export class SyncEngine {
  private state: SyncState;
  private notebookClient: NotebookClient;

  constructor(
    private app: App,
    private auth: AmazonAuthManager,
    private settings: KindleScribeSettings,
    private ocrProvider: OCRProvider | null,
    private loadState: () => Promise<SyncState>,
    private saveState: (state: SyncState) => Promise<void>
  ) {
    this.state = createEmptySyncState();
    this.notebookClient = new NotebookClient(auth);
  }

  /** Initialize the engine by loading persisted state. */
  async initialize(): Promise<void> {
    this.state = await this.loadState();
  }

  /** Get the current sync state (for display in settings). */
  getState(): SyncState {
    return this.state;
  }

  /**
   * Run an incremental sync — only downloads notebooks that have changed.
   */
  async syncIncremental(onProgress?: SyncProgressCallback): Promise<SyncResult> {
    return this.runSync(false, onProgress);
  }

  /**
   * Run a full sync — re-downloads all notebooks regardless of state.
   */
  async syncAll(onProgress?: SyncProgressCallback): Promise<SyncResult> {
    return this.runSync(true, onProgress);
  }

  private async runSync(
    forceAll: boolean,
    onProgress?: SyncProgressCallback
  ): Promise<SyncResult> {
    const result: SyncResult = { success: true, synced: 0, skipped: 0, errors: [] };

    // Validate session
    if (!this.auth.isAuthenticated()) {
      const valid = await this.auth.validateSession();
      if (!valid) {
        result.success = false;
        result.errors.push("Not authenticated. Please log in to Amazon.");
        return result;
      }
    }

    // Fetch notebook list
    onProgress?.(0, 1, "Fetching notebook list...");
    let notebooks: NotebookMetadata[];
    try {
      notebooks = await this.notebookClient.listNotebooks();
    } catch (e: any) {
      result.success = false;
      result.errors.push(`Failed to fetch notebooks: ${e.message}`);
      return result;
    }

    if (notebooks.length === 0) {
      onProgress?.(1, 1, "No notebooks found.");
      return result;
    }

    // Determine which notebooks need syncing
    const toSync: NotebookMetadata[] = forceAll
      ? notebooks
      : getNotebooksToSync(notebooks, this.state).map((n) => {
          // Find the full notebook metadata from the API response
          return notebooks.find((nb) => nb.asin === n.asin)!;
        });

    if (toSync.length === 0) {
      onProgress?.(1, 1, "All notebooks up to date.");
      return result;
    }

    // Ensure output folder exists
    await this.ensureOutputFolder();

    // Process each notebook
    for (let i = 0; i < toSync.length; i++) {
      const notebook = toSync[i];
      onProgress?.(i, toSync.length, `Syncing: ${notebook.title}`);

      try {
        await this.syncNotebook(notebook);
        this.state = updateNotebookState(
          this.state,
          notebook.asin,
          notebook.title,
          notebook.modificationTime,
          notebook.totalPages
        );
        result.synced++;
      } catch (e: any) {
        result.errors.push(`${notebook.title}: ${e.message}`);
        console.error(`Failed to sync notebook "${notebook.title}":`, e);
      }
    }

    // Persist updated state
    await this.saveState(this.state);

    result.skipped = notebooks.length - toSync.length;
    result.success = result.errors.length === 0;
    onProgress?.(toSync.length, toSync.length, "Sync complete.");

    return result;
  }

  /**
   * Sync a single notebook: open it, fetch pages, process, and write output.
   */
  private async syncNotebook(
    notebook: NotebookMetadata
  ): Promise<void> {
    // Open notebook to get rendering token
    const opened = await this.notebookClient.openNotebook(
      notebook.asin,
      this.settings.marketplace
    );

    // Fetch page images
    const pages = await this.notebookClient.fetchPages(
      opened.renderingToken,
      opened.metadata.totalPages,
      this.settings.pageDpi
    );

    // Generate output based on configured format
    await this.writeOutput(notebook, pages);
  }

  /**
   * Write the notebook output to the vault based on the configured format.
   */
  private async writeOutput(
    notebook: NotebookMetadata,
    pages: PageImage[]
  ): Promise<void> {
    const outputFolder = this.settings.outputFolder;
    const sanitizedTitle = this.sanitizeFilename(notebook.title);

    switch (this.settings.outputFormat) {
      case "pdf": {
        const pdfGenerator = new PdfGenerator();
        const pdfData = await pdfGenerator.generate(pages);
        const pdfPath = `${outputFolder}/${sanitizedTitle}.pdf`;
        await this.app.vault.adapter.writeBinary(pdfPath, pdfData);
        break;
      }

      case "images": {
        const mdGenerator = new MarkdownGenerator(this.settings);
        const { markdown, images } = await mdGenerator.generateWithImages(
          notebook,
          pages
        );
        // Save images
        const imageFolder = `${outputFolder}/${sanitizedTitle}`;
        await this.ensureFolder(imageFolder);
        for (const img of images) {
          await this.app.vault.adapter.writeBinary(
            `${imageFolder}/${img.filename}`,
            img.data
          );
        }
        // Save markdown
        await this.writeMarkdownFile(
          `${outputFolder}/${sanitizedTitle}.md`,
          markdown
        );
        break;
      }

      case "transcribed": {
        if (!this.ocrProvider) {
          throw new Error("No OCR provider configured for transcribed output.");
        }
        const transcription = await this.ocrProvider.transcribePages(pages);
        const mdGenerator = new MarkdownGenerator(this.settings);
        const markdown = mdGenerator.generateTranscribed(notebook, transcription);
        await this.writeMarkdownFile(
          `${outputFolder}/${sanitizedTitle}.md`,
          markdown
        );
        break;
      }

      case "combined":
      default: {
        const mdGenerator = new MarkdownGenerator(this.settings);
        let transcription: string | undefined;

        if (this.ocrProvider) {
          transcription = await this.ocrProvider.transcribePages(pages);
        }

        const { markdown, images } = await mdGenerator.generateCombined(
          notebook,
          pages,
          transcription
        );

        // Save images
        const imgFolder = `${outputFolder}/${sanitizedTitle}`;
        await this.ensureFolder(imgFolder);
        for (const img of images) {
          await this.app.vault.adapter.writeBinary(
            `${imgFolder}/${img.filename}`,
            img.data
          );
        }

        // Save markdown
        await this.writeMarkdownFile(
          `${outputFolder}/${sanitizedTitle}.md`,
          markdown
        );
        break;
      }
    }
  }

  /** Write or overwrite a markdown file in the vault. */
  private async writeMarkdownFile(path: string, content: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) {
      await this.app.vault.modify(existing as any, content);
    } else {
      await this.app.vault.create(path, content);
    }
  }

  /** Ensure the output folder exists in the vault. */
  private async ensureOutputFolder(): Promise<void> {
    await this.ensureFolder(this.settings.outputFolder);
  }

  /** Ensure a folder path exists, creating it if necessary. */
  private async ensureFolder(path: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (!existing) {
      await this.app.vault.createFolder(path);
    }
  }

  /** Sanitize a string for use as a filename. */
  private sanitizeFilename(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, "_").trim();
  }
}

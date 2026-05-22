import { NotebookMetadata, PageImage } from "../api/types";
import { KindleScribeSettings } from "../settings";
import { renderTemplate, DEFAULT_TEMPLATE } from "./templates";

/** Image file to be saved alongside the markdown note. */
export interface OutputImage {
  filename: string;
  data: ArrayBuffer;
}

/**
 * Generates markdown output for synced notebooks.
 * Supports images-only, transcribed-only, and combined modes.
 */
export class MarkdownGenerator {
  constructor(private settings: KindleScribeSettings) {}

  /**
   * Generate markdown with embedded image references.
   * Images are saved separately and linked via relative paths.
   */
  async generateWithImages(
    notebook: NotebookMetadata,
    pages: PageImage[]
  ): Promise<{ markdown: string; images: OutputImage[] }> {
    const images: OutputImage[] = [];
    const imageEmbeds: string[] = [];
    const sanitizedTitle = this.sanitizeFilename(notebook.title);

    for (const page of pages) {
      const ext = page.mimeType === "image/png" ? "png" : "jpg";
      const filename = `page_${page.pageNumber.toString().padStart(3, "0")}.${ext}`;
      images.push({ filename, data: page.data });
      imageEmbeds.push(`![[${sanitizedTitle}/${filename}]]`);
    }

    const content = imageEmbeds.join("\n\n");
    const markdown = this.applyTemplate(notebook, content);

    return { markdown, images };
  }

  /**
   * Generate markdown with transcribed text only (no images).
   */
  generateTranscribed(
    notebook: NotebookMetadata,
    transcription: string
  ): string {
    return this.applyTemplate(notebook, transcription);
  }

  /**
   * Generate combined output: transcribed text with original images as reference.
   */
  async generateCombined(
    notebook: NotebookMetadata,
    pages: PageImage[],
    transcription?: string
  ): Promise<{ markdown: string; images: OutputImage[] }> {
    const images: OutputImage[] = [];
    const sanitizedTitle = this.sanitizeFilename(notebook.title);
    const sections: string[] = [];

    // Add transcription if available
    if (transcription) {
      sections.push("## Transcription\n");
      sections.push(transcription);
      sections.push("\n## Original Pages\n");
    }

    // Add image embeds
    for (const page of pages) {
      const ext = page.mimeType === "image/png" ? "png" : "jpg";
      const filename = `page_${page.pageNumber.toString().padStart(3, "0")}.${ext}`;
      images.push({ filename, data: page.data });
      sections.push(`![[${sanitizedTitle}/${filename}]]`);
    }

    const content = sections.join("\n\n");
    const markdown = this.applyTemplate(notebook, content);

    return { markdown, images };
  }

  /**
   * Apply the configured template to generate the final markdown.
   */
  private applyTemplate(notebook: NotebookMetadata, content: string): string {
    const template = this.settings.noteTemplate || DEFAULT_TEMPLATE;

    return renderTemplate(template, {
      title: notebook.title,
      date: new Date().toISOString().split("T")[0],
      modified: new Date(notebook.modificationTime).toISOString().split("T")[0],
      pages: notebook.totalPages.toString(),
      content,
    });
  }

  /** Sanitize a string for use as a filename. */
  private sanitizeFilename(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, "_").trim();
  }
}

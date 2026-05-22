import { PageImage } from "../api/types";

/**
 * Options for OCR transcription.
 */
export interface OCROptions {
  /** Output format for the transcription. */
  format: "markdown" | "plain";
  /** Whether to include page break markers. */
  includePageBreaks: boolean;
  /** Language hint for the OCR model. */
  language?: string;
}

/**
 * Provider-agnostic interface for OCR transcription.
 * Each AI provider (OpenRouter, OpenAI, Anthropic) implements this.
 */
export interface OCRProvider {
  /** Display name of the provider. */
  name: string;

  /**
   * Transcribe an array of page images into text.
   * @param pages - Array of page images to transcribe
   * @param options - Transcription options
   * @returns Combined transcription text
   */
  transcribePages(pages: PageImage[], options?: Partial<OCROptions>): Promise<string>;
}

/** Default OCR options. */
export const DEFAULT_OCR_OPTIONS: OCROptions = {
  format: "markdown",
  includePageBreaks: true,
  language: undefined,
};

/**
 * Convert a page image's ArrayBuffer to a base64 data URL.
 */
export function pageImageToBase64(page: PageImage): string {
  const bytes = new Uint8Array(page.data);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return `data:${page.mimeType};base64,${base64}`;
}

/**
 * Build the system prompt for OCR transcription.
 */
export function buildOCRPrompt(options: OCROptions): string {
  const parts = [
    "You are an expert at reading handwritten notes.",
    "Transcribe the handwritten content in this image accurately.",
  ];

  if (options.format === "markdown") {
    parts.push(
      "Format the output as clean Markdown.",
      "Use headings, lists, and emphasis where appropriate based on the handwriting structure."
    );
  } else {
    parts.push("Output plain text without any formatting.");
  }

  if (options.language) {
    parts.push(`The text is written in ${options.language}.`);
  }

  parts.push(
    "If you cannot read a word clearly, indicate it with [illegible].",
    "Preserve the logical structure and flow of the notes."
  );

  return parts.join(" ");
}

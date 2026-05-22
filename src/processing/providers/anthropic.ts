import { requestUrl } from "obsidian";
import { PageImage } from "../../api/types";
import {
  OCRProvider,
  OCROptions,
  DEFAULT_OCR_OPTIONS,
  pageImageToBase64,
  buildOCRPrompt,
} from "../ocr";

/**
 * Anthropic Claude Vision OCR provider.
 * Uses Claude's vision capabilities for handwriting transcription.
 */
export class AnthropicProvider implements OCRProvider {
  name = "Anthropic";

  constructor(
    private apiKey: string,
    private model: string = "claude-sonnet-4-20250514"
  ) {}

  async transcribePages(
    pages: PageImage[],
    options?: Partial<OCROptions>
  ): Promise<string> {
    const opts: OCROptions = { ...DEFAULT_OCR_OPTIONS, ...options };
    const results: string[] = [];

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const transcription = await this.transcribeSinglePage(page, opts);
      results.push(transcription);

      if (opts.includePageBreaks && i < pages.length - 1) {
        results.push("\n---\n");
      }
    }

    return results.join("\n");
  }

  private async transcribeSinglePage(
    page: PageImage,
    options: OCROptions
  ): Promise<string> {
    const base64Image = pageImageToBase64(page);
    const systemPrompt = buildOCRPrompt(options);

    // Anthropic expects base64 data without the data URL prefix
    const base64Data = base64Image.split(",")[1];
    const mediaType = page.mimeType as "image/png" | "image/jpeg" | "image/gif" | "image/webp";

    const response = await requestUrl({
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: base64Data,
                },
              },
              {
                type: "text",
                text: "Transcribe the handwritten content in this page.",
              },
            ],
          },
        ],
      }),
    });

    if (response.status !== 200) {
      throw new Error(
        `Anthropic API error: ${response.status} ${response.text}`
      );
    }

    const data = response.json;
    const textBlock = data.content?.find((block: any) => block.type === "text");
    return textBlock?.text || "";
  }
}

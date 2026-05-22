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
 * OpenAI Vision OCR provider.
 * Uses GPT-4 Vision or similar models for handwriting transcription.
 */
export class OpenAIProvider implements OCRProvider {
  name = "OpenAI";

  constructor(
    private apiKey: string,
    private model: string = "gpt-4o"
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

    const response = await requestUrl({
      url: "https://api.openai.com/v1/chat/completions",
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: base64Image, detail: "high" },
              },
              {
                type: "text",
                text: "Transcribe the handwritten content in this page.",
              },
            ],
          },
        ],
        max_tokens: 4096,
      }),
    });

    if (response.status !== 200) {
      throw new Error(
        `OpenAI API error: ${response.status} ${response.text}`
      );
    }

    const data = response.json;
    return data.choices?.[0]?.message?.content || "";
  }
}

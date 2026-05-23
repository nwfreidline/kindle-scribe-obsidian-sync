import { AmazonAuthManager } from "./auth";
import {
  KINDLE_API_BASE,
  MARKETPLACES,
  NotebookListResponse,
  NotebookMetadata,
  OpenNotebookResponse,
  PageImage,
  RawNotebookItem,
  RenderPageOptions,
} from "./types";
import { withRetry } from "../utils/retry";

/** Batch size for page rendering requests. */
const PAGE_BATCH_SIZE = 3;

/** Default render dimensions. */
const DEFAULT_WIDTH = 1404;
const DEFAULT_HEIGHT = 1872;

/**
 * Client for the Amazon Kindle Notebook API.
 * Handles listing notebooks, opening them, and fetching page images.
 */
export class NotebookClient {
  constructor(private auth: AmazonAuthManager) {}

  /**
   * Fetch all notebooks from the user's Kindle account.
   */
  async listNotebooks(): Promise<NotebookMetadata[]> {
    return withRetry(async () => {
      const response = await this.auth.makeAuthenticatedRequest(
        `${KINDLE_API_BASE}/kindle-notebook/api/notes`
      );

      if (!response.ok) {
        const error: any = new Error(
          `Failed to fetch notebooks: ${response.status} ${response.statusText}`
        );
        error.status = response.status;
        throw error;
      }

      const data: NotebookListResponse = await response.json();
      console.log("[Kindle Scribe] Notebook list API response:", JSON.stringify(data).substring(0, 500));
      console.log(`[Kindle Scribe] Found ${data.itemsList?.length || 0} notebooks`);
      if (data.itemsList && data.itemsList.length > 0) {
        console.log("[Kindle Scribe] First notebook:", JSON.stringify(data.itemsList[0]));
      }

      // Map raw items to NotebookMetadata
      // We'll get totalPages and modificationTime from openNotebook later
      return (data.itemsList || [])
        .filter((item: RawNotebookItem) => item.type === "notebook")
        .map((item: RawNotebookItem) => ({
          asin: item.id,
          title: item.title,
          modificationTime: 0, // Will be populated by openNotebook
          totalPages: 0, // Will be populated by openNotebook
          marketplaceId: "",
        }));
    });
  }

  /**
   * Open a notebook to get its rendering token and metadata.
   */
  async openNotebook(
    notebookId: string,
    marketplace: string
  ): Promise<OpenNotebookResponse> {
    return withRetry(async () => {
      const marketplaceId = MARKETPLACES[marketplace] || marketplace;
      const url = `${KINDLE_API_BASE}/openNotebook?notebookId=${encodeURIComponent(notebookId)}&marketplaceId=${encodeURIComponent(marketplaceId)}`;

      const response = await this.auth.makeAuthenticatedRequest(url);

      if (!response.ok) {
        const error: any = new Error(
          `Failed to open notebook ${notebookId}: ${response.status} ${response.statusText}`
        );
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      console.log("[Kindle Scribe] openNotebook response:", JSON.stringify(data).substring(0, 500));

      // The response structure may vary — handle flexibly
      return {
        metadata: {
          currentPage: data.metadata?.currentPage || data.currentPage || 1,
          modificationTime: data.metadata?.modificationTime || data.modificationTime || Date.now(),
          title: data.metadata?.title || data.title || "",
          totalPages: data.metadata?.totalPages || data.totalPages || data.pageCount || 0,
        },
        readingSessionId: data.readingSessionId || "",
        renderingToken: data.renderingToken || data.metadata?.renderingToken || "",
      };
    });
  }

  /**
   * Fetch all pages from a notebook as images.
   * Pages are fetched in batches to avoid rate limiting.
   */
  async fetchPages(
    renderingToken: string,
    totalPages: number,
    dpi: number = 50
  ): Promise<PageImage[]> {
    const allPages: PageImage[] = [];

    for (let startPage = 1; startPage <= totalPages; startPage += PAGE_BATCH_SIZE) {
      const endPage = Math.min(startPage + PAGE_BATCH_SIZE - 1, totalPages);

      const options: RenderPageOptions = {
        startPage,
        endPage,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        dpi,
      };

      const batchPages = await this.fetchPageBatch(renderingToken, options);
      allPages.push(...batchPages);

      // Small delay between batches to avoid rate limiting
      if (endPage < totalPages) {
        await this.delay(500);
      }
    }

    return allPages;
  }

  /**
   * Fetch a batch of pages and extract images from the tar response.
   */
  private async fetchPageBatch(
    renderingToken: string,
    options: RenderPageOptions
  ): Promise<PageImage[]> {
    return withRetry(async () => {
      const url = new URL(`${KINDLE_API_BASE}/renderPage`);
      url.searchParams.set("startPage", options.startPage.toString());
      url.searchParams.set("endPage", options.endPage.toString());
      url.searchParams.set("width", (options.width || DEFAULT_WIDTH).toString());
      url.searchParams.set("height", (options.height || DEFAULT_HEIGHT).toString());
      url.searchParams.set("dpi", (options.dpi || 50).toString());

      const tarBuffer = await this.auth.makeAuthenticatedBinaryRequest(url.toString(), {
        headers: {
          "x-amzn-karamel-notebook-rendering-token": renderingToken,
        },
      });

      return this.extractImagesFromTar(tarBuffer, options.startPage);
    });
  }

  /**
   * Extract individual page images from a tar archive buffer.
   * Also extracts and logs JSON metadata which may contain recognized text.
   */
  extractImagesFromTar(tarBuffer: ArrayBuffer, startPage: number): PageImage[] {
    const pages: PageImage[] = [];
    let offset = 0;

    console.log(`[Kindle Scribe] Extracting from tar buffer: ${tarBuffer.byteLength} bytes`);

    while (offset < tarBuffer.byteLength - 512) {
      // Read tar header (512 bytes)
      const header = new Uint8Array(tarBuffer, offset, 512);

      // Check for empty header (end of archive)
      if (header.every((b) => b === 0)) break;

      // Extract file size from header (octal string at offset 124, 12 bytes)
      const sizeStr = this.readTarString(header, 124, 12).trim();
      const fileSize = parseInt(sizeStr, 8) || 0;

      // Extract filename from header (offset 0, 100 bytes)
      const filename = this.readTarString(header, 0, 100);

      offset += 512; // Move past header

      if (fileSize > 0 && filename) {
        const isPaxHeader = filename.includes("PaxHeaders");
        const isImage = filename.endsWith(".png") || filename.endsWith(".jpg") || filename.endsWith(".jpeg");
        const isJson = filename.endsWith(".json") && !isPaxHeader;

        // Log every non-PaxHeader entry
        if (!isPaxHeader) {
          console.log(`[Kindle Scribe] Tar file: "${filename}" (${fileSize} bytes)`);
        }

        if (isImage && !isPaxHeader) {
          const imageData = tarBuffer.slice(offset, offset + fileSize);
          const mimeType = filename.endsWith(".png") ? "image/png" : "image/jpeg";
          pages.push({
            pageNumber: startPage + pages.length,
            data: imageData,
            mimeType,
          });
          console.log(`[Kindle Scribe] Image: "${filename}" ${fileSize} bytes`);
        }

        // Log JSON file contents to see if Amazon includes recognized text
        if (isJson) {
          const jsonData = tarBuffer.slice(offset, offset + fileSize);
          const jsonStr = new TextDecoder().decode(new Uint8Array(jsonData));
          console.log(`[Kindle Scribe] JSON "${filename}": ${jsonStr}`);
        }
      }

      // Move to next header (file data is padded to 512-byte boundary)
      offset += Math.ceil(fileSize / 512) * 512;
    }

    console.log(`[Kindle Scribe] Extracted ${pages.length} image(s) from tar`);
    return pages;
  }

  /** Read a null-terminated string from a tar header. */
  private readTarString(header: Uint8Array, offset: number, length: number): string {
    const bytes = header.slice(offset, offset + length);
    const nullIndex = bytes.indexOf(0);
    const end = nullIndex === -1 ? length : nullIndex;
    return new TextDecoder().decode(bytes.slice(0, end));
  }

  /** Simple delay utility. */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Amazon Kindle Notebook API type definitions.
 */

/** Marketplace identifiers for Amazon regional endpoints. */
export const MARKETPLACES: Record<string, string> = {
  US: "ATVPDKIKX0DER",
  UK: "A1F83G8C2ARO7P",
  DE: "A1PA6795UKMFR9",
  FR: "A13V1IB3VIYBER",
  ES: "A1RKKUPIHCS9HS",
  IT: "APJ6JRA9NG5V4",
  JP: "A1VC38T7YXB528",
  CA: "A2EUQ1WTGCTBG2",
  AU: "A39IBJ37TRP1C6",
  IN: "A21TJRUUN4KGV",
};

/** Base URL for the Kindle notebook API. */
export const KINDLE_API_BASE = "https://read.amazon.com";

/** Notebook metadata (normalized from the API response). */
export interface NotebookMetadata {
  /** Notebook UUID from the API. Also used as 'asin' for sync state compatibility. */
  asin: string;
  title: string;
  modificationTime: number;
  totalPages: number;
  marketplaceId: string;
}

/** Raw item from the notebook list API. */
export interface RawNotebookItem {
  id: string;
  title: string;
  type: string;
  parentFolder: string;
  items?: any[];
}

/** Response from the notebook list API. */
export interface NotebookListResponse {
  itemsList: RawNotebookItem[];
  responseStatus: string;
}

/** Response from the openNotebook endpoint. */
export interface OpenNotebookResponse {
  metadata: {
    currentPage: number;
    modificationTime: number;
    title: string;
    totalPages: number;
  };
  readingSessionId: string;
  renderingToken: string;
}

/** Configuration for page rendering requests. */
export interface RenderPageOptions {
  startPage: number;
  endPage: number;
  width?: number;
  height?: number;
  dpi?: number;
}

/** Represents a single extracted page image. */
export interface PageImage {
  pageNumber: number;
  data: ArrayBuffer;
  mimeType: string;
}

/** Amazon session cookies needed for API access. */
export interface AmazonSession {
  cookies: string;
  marketplace: string;
  isValid: boolean;
  lastValidated?: number;
}

import { MicrosoftAuthManager } from "./microsoft-auth";

const LOG = "[Kindle Scribe] OneNote:";

/** OneNote notebook from the Graph API. */
export interface OneNoteNotebook {
  id: string;
  displayName: string;
  lastModifiedDateTime: string;
  createdDateTime: string;
  isDefault: boolean;
  sectionsUrl: string;
}

/** OneNote section within a notebook. */
export interface OneNoteSection {
  id: string;
  displayName: string;
  lastModifiedDateTime: string;
  pagesUrl: string;
}

/** OneNote page metadata. */
export interface OneNotePage {
  id: string;
  title: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  contentUrl: string;
  level: number;
  order: number;
}

/**
 * Client for Microsoft Graph OneNote API.
 * Fetches notebooks, sections, pages, and page content.
 */
export class OneNoteClient {
  constructor(private auth: MicrosoftAuthManager) {}

  /** List all OneNote notebooks for the user. */
  async listNotebooks(): Promise<OneNoteNotebook[]> {
    console.log(`${LOG} Listing notebooks...`);
    const data = await this.auth.graphRequest("/me/onenote/notebooks");
    console.log(`${LOG} Found ${data.value?.length || 0} notebooks`);
    return data.value || [];
  }

  /** List sections in a notebook. */
  async listSections(notebookId: string): Promise<OneNoteSection[]> {
    console.log(`${LOG} Listing sections for notebook ${notebookId}...`);
    const data = await this.auth.graphRequest(
      `/me/onenote/notebooks/${notebookId}/sections`
    );
    return data.value || [];
  }

  /** List pages in a section. */
  async listPages(sectionId: string): Promise<OneNotePage[]> {
    console.log(`${LOG} Listing pages for section ${sectionId}...`);
    const data = await this.auth.graphRequest(
      `/me/onenote/sections/${sectionId}/pages`
    );
    return data.value || [];
  }

  /** Get the HTML content of a page. */
  async getPageContent(pageId: string): Promise<string> {
    console.log(`${LOG} Fetching content for page ${pageId}...`);
    const html = await this.auth.graphRequestHtml(
      `/me/onenote/pages/${pageId}/content`
    );
    return html;
  }

  /**
   * Get all pages from a specific notebook, organized by section.
   */
  async getAllPagesFromNotebook(
    notebookId: string
  ): Promise<Array<{ section: OneNoteSection; pages: OneNotePage[] }>> {
    const sections = await this.listSections(notebookId);
    const results: Array<{ section: OneNoteSection; pages: OneNotePage[] }> = [];

    for (const section of sections) {
      const pages = await this.listPages(section.id);
      results.push({ section, pages });
    }

    return results;
  }
}

/**
 * Convert OneNote HTML content to clean Markdown.
 * OneNote returns HTML with specific patterns we can handle.
 */
export function htmlToMarkdown(html: string): string {
  let md = html;

  // Remove XML declaration and head section
  md = md.replace(/<\?xml[^>]*\?>/gi, "");
  md = md.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "");
  md = md.replace(/<\/?html[^>]*>/gi, "");
  md = md.replace(/<\/?body[^>]*>/gi, "");

  // Convert headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "# $1\n\n");
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "## $1\n\n");
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "### $1\n\n");
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "#### $1\n\n");

  // Convert bold and italic
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, "**$2**");
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/(em|i)>/gi, "*$2*");
  md = md.replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, "$1");

  // Convert lists
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  md = md.replace(/<\/?[ou]l[^>]*>/gi, "\n");

  // Convert links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

  // Convert line breaks and paragraphs
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n");
  md = md.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, "$1\n");

  // Convert images (OneNote embeds)
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, "![$2]($1)");
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, "![]($1)");

  // Remove remaining HTML tags
  md = md.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  md = md.replace(/&amp;/g, "&");
  md = md.replace(/&lt;/g, "<");
  md = md.replace(/&gt;/g, ">");
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&nbsp;/g, " ");

  // Clean up whitespace
  md = md.replace(/\n{3,}/g, "\n\n");
  md = md.trim();

  return md;
}

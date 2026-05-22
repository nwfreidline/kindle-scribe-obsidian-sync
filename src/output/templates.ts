/**
 * Template system for configurable note output.
 * Supports simple variable substitution with {{variable}} syntax.
 */

/** Template variables available for substitution. */
export interface TemplateVariables {
  /** Notebook title. */
  title: string;
  /** Current sync date (YYYY-MM-DD). */
  date: string;
  /** Last modified date on Kindle (YYYY-MM-DD). */
  modified: string;
  /** Total page count. */
  pages: string;
  /** Main content (transcription, images, or combined). */
  content: string;
}

/** Default note template. */
export const DEFAULT_TEMPLATE = `---
title: "{{title}}"
synced: {{date}}
modified: {{modified}}
pages: {{pages}}
source: kindle-scribe
---

# {{title}}

{{content}}
`;

/**
 * Render a template by replacing {{variable}} placeholders with values.
 */
export function renderTemplate(
  template: string,
  variables: TemplateVariables
): string {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    result = result.replace(pattern, value);
  }

  return result;
}

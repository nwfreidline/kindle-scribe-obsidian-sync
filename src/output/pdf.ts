import { PageImage } from "../api/types";

/**
 * Generates a PDF from page images using jsPDF.
 * Each page image becomes a full page in the PDF.
 */
export class PdfGenerator {
  /**
   * Generate a PDF buffer from an array of page images.
   */
  async generate(pages: PageImage[]): Promise<ArrayBuffer> {
    // Dynamic import to keep jspdf out of the initial bundle if not needed
    const { jsPDF } = await import("jspdf");

    // Kindle Scribe page dimensions (approximate A5 in mm)
    const pageWidth = 148;
    const pageHeight = 210;

    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: [pageWidth, pageHeight],
    });

    for (let i = 0; i < pages.length; i++) {
      if (i > 0) {
        doc.addPage([pageWidth, pageHeight]);
      }

      const page = pages[i];
      const base64 = this.arrayBufferToBase64(page.data);
      const format = page.mimeType === "image/png" ? "PNG" : "JPEG";

      doc.addImage(base64, format, 0, 0, pageWidth, pageHeight);
    }

    // Get the PDF as an ArrayBuffer
    const pdfOutput = doc.output("arraybuffer");
    return pdfOutput;
  }

  /** Convert an ArrayBuffer to a base64 string. */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}

import { App, Modal, Setting } from "obsidian";
import { NotebookMetadata } from "../api/types";

/**
 * Modal that displays available notebooks and lets the user
 * select which ones to sync.
 */
export class NotebookPickerModal extends Modal {
  private notebooks: NotebookMetadata[];
  private selected: Set<string>;
  private onConfirm: (selectedIds: string[]) => void;

  constructor(
    app: App,
    notebooks: NotebookMetadata[],
    previouslySelected: string[],
    onConfirm: (selectedIds: string[]) => void
  ) {
    super(app);
    this.notebooks = notebooks;
    this.selected = new Set(
      previouslySelected.length > 0
        ? previouslySelected
        : notebooks.map((n) => n.asin)
    );
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Select Notebooks to Sync" });
    contentEl.createEl("p", {
      text: `Found ${this.notebooks.length} notebook(s) in your Kindle Scribe account.`,
      cls: "setting-item-description",
    });

    // Select all / none buttons
    const buttonRow = contentEl.createDiv({ cls: "kindle-scribe-button-row" });
    buttonRow.style.display = "flex";
    buttonRow.style.gap = "8px";
    buttonRow.style.marginBottom = "12px";

    const selectAllBtn = buttonRow.createEl("button", { text: "Select All" });
    selectAllBtn.addEventListener("click", () => {
      this.notebooks.forEach((n) => this.selected.add(n.asin));
      this.renderList(contentEl);
    });

    const selectNoneBtn = buttonRow.createEl("button", { text: "Select None" });
    selectNoneBtn.addEventListener("click", () => {
      this.selected.clear();
      this.renderList(contentEl);
    });

    // Notebook list
    this.renderList(contentEl);

    // Confirm button
    const footer = contentEl.createDiv({ cls: "kindle-scribe-modal-footer" });
    footer.style.marginTop = "16px";
    footer.style.textAlign = "right";

    const confirmBtn = footer.createEl("button", {
      text: `Sync ${this.selected.size} notebook(s)`,
      cls: "mod-cta",
    });
    confirmBtn.addEventListener("click", () => {
      this.onConfirm(Array.from(this.selected));
      this.close();
    });

    const cancelBtn = footer.createEl("button", { text: "Cancel" });
    cancelBtn.style.marginRight = "8px";
    cancelBtn.addEventListener("click", () => {
      this.close();
    });
    footer.insertBefore(cancelBtn, confirmBtn);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderList(containerEl: HTMLElement): void {
    // Remove existing list if re-rendering
    const existingList = containerEl.querySelector(".kindle-scribe-notebook-list");
    if (existingList) existingList.remove();

    const listEl = containerEl.createDiv({ cls: "kindle-scribe-notebook-list" });
    listEl.style.maxHeight = "400px";
    listEl.style.overflowY = "auto";
    listEl.style.border = "1px solid var(--background-modifier-border)";
    listEl.style.borderRadius = "4px";
    listEl.style.padding = "8px";

    for (const notebook of this.notebooks) {
      const isSelected = this.selected.has(notebook.asin);
      const modDate = new Date(notebook.modificationTime).toLocaleDateString();

      new Setting(listEl)
        .setName(notebook.title)
        .setDesc(`${notebook.totalPages} pages · Modified: ${modDate}`)
        .addToggle((toggle) => {
          toggle.setValue(isSelected);
          toggle.onChange((value) => {
            if (value) {
              this.selected.add(notebook.asin);
            } else {
              this.selected.delete(notebook.asin);
            }
            // Update confirm button text
            const confirmBtn = containerEl.querySelector(".mod-cta");
            if (confirmBtn) {
              confirmBtn.textContent = `Sync ${this.selected.size} notebook(s)`;
            }
          });
        });
    }

    // Insert before the footer
    const footer = containerEl.querySelector(".kindle-scribe-modal-footer");
    if (footer) {
      containerEl.insertBefore(listEl, footer);
    }
  }
}

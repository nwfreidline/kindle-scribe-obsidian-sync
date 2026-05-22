import { Modal, App, Notice } from "obsidian";

/**
 * A modal that displays sync progress with a progress bar and status messages.
 */
export class SyncProgressModal extends Modal {
  private progressBarFill: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private detailEl: HTMLElement | null = null;
  private cancelButton: HTMLElement | null = null;
  private cancelled = false;

  /** Callback invoked when the user cancels the sync. */
  onCancel: (() => void) | null = null;

  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("kindle-scribe-sync-progress");

    contentEl.createEl("h3", { text: "Syncing Kindle Scribe Notes" });

    this.statusEl = contentEl.createEl("p", {
      text: "Starting sync...",
      cls: "sync-status",
    });

    // Progress bar
    const progressBar = contentEl.createDiv({ cls: "progress-bar" });
    this.progressBarFill = progressBar.createDiv({ cls: "progress-bar-fill" });
    this.progressBarFill.style.width = "0%";

    this.detailEl = contentEl.createEl("p", {
      text: "",
      cls: "sync-detail",
    });
    this.detailEl.style.fontSize = "0.85em";
    this.detailEl.style.color = "var(--text-muted)";

    // Cancel button
    const buttonContainer = contentEl.createDiv({ cls: "sync-buttons" });
    buttonContainer.style.marginTop = "12px";
    buttonContainer.style.textAlign = "right";

    this.cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
    this.cancelButton.addEventListener("click", () => {
      this.cancelled = true;
      this.onCancel?.();
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** Update the progress display. */
  updateProgress(current: number, total: number, message: string): void {
    if (this.cancelled) return;

    const percent = total > 0 ? Math.round((current / total) * 100) : 0;

    if (this.progressBarFill) {
      this.progressBarFill.style.width = `${percent}%`;
    }

    if (this.statusEl) {
      this.statusEl.textContent = message;
    }

    if (this.detailEl) {
      this.detailEl.textContent = `${current} of ${total} (${percent}%)`;
    }
  }

  /** Mark the sync as complete and auto-close after a delay. */
  complete(message: string): void {
    if (this.statusEl) {
      this.statusEl.textContent = message;
    }
    if (this.progressBarFill) {
      this.progressBarFill.style.width = "100%";
    }
    if (this.cancelButton) {
      this.cancelButton.textContent = "Close";
    }
    if (this.detailEl) {
      this.detailEl.textContent = "";
    }

    // Auto-close after 2 seconds
    setTimeout(() => {
      if (!this.cancelled) this.close();
    }, 2000);
  }

  /** Check if the user has cancelled. */
  isCancelled(): boolean {
    return this.cancelled;
  }
}

/**
 * Lightweight status bar component for showing last sync time.
 */
export class SyncStatusBar {
  private statusBarEl: HTMLElement;

  constructor(statusBarEl: HTMLElement) {
    this.statusBarEl = statusBarEl;
    this.statusBarEl.addClass("kindle-scribe-status");
    this.setIdle();
  }

  /** Show idle state with last sync time. */
  setIdle(lastSyncTime?: number): void {
    if (lastSyncTime && lastSyncTime > 0) {
      const timeStr = this.formatRelativeTime(lastSyncTime);
      this.statusBarEl.textContent = `Kindle: synced ${timeStr}`;
    } else {
      this.statusBarEl.textContent = "Kindle: not synced";
    }
  }

  /** Show syncing state. */
  setSyncing(): void {
    this.statusBarEl.textContent = "Kindle: syncing...";
  }

  /** Show error state. */
  setError(): void {
    this.statusBarEl.textContent = "Kindle: sync error";
  }

  /** Format a timestamp as a relative time string. */
  private formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }
}

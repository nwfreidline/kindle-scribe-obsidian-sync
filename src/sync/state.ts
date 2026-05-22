/**
 * Sync state persistence — tracks which notebooks have been synced
 * and their last known modification times for incremental sync.
 */

/** State for a single synced notebook. */
export interface NotebookSyncRecord {
  id: string;
  title: string;
  lastModified: number;
  pageCount: number;
  hash?: string;
  lastSynced: number;
}

/** Full sync state persisted via plugin data. */
export interface SyncState {
  lastSyncTime: number;
  notebooks: Record<string, NotebookSyncRecord>;
}

/** Creates a fresh empty sync state. */
export function createEmptySyncState(): SyncState {
  return {
    lastSyncTime: 0,
    notebooks: {},
  };
}

/**
 * Determines which notebooks need syncing by comparing API metadata
 * against stored state.
 */
export function getNotebooksToSync(
  apiNotebooks: Array<{ asin: string; title: string; modificationTime: number; totalPages: number }>,
  state: SyncState
): Array<{ asin: string; title: string; modificationTime: number; totalPages: number; reason: "new" | "modified" }> {
  const toSync: Array<{
    asin: string;
    title: string;
    modificationTime: number;
    totalPages: number;
    reason: "new" | "modified";
  }> = [];

  for (const notebook of apiNotebooks) {
    const existing = state.notebooks[notebook.asin];

    if (!existing) {
      toSync.push({ ...notebook, reason: "new" });
    } else if (notebook.modificationTime > existing.lastModified) {
      toSync.push({ ...notebook, reason: "modified" });
    }
  }

  return toSync;
}

/**
 * Updates the sync state after a successful notebook sync.
 */
export function updateNotebookState(
  state: SyncState,
  notebookId: string,
  title: string,
  modificationTime: number,
  pageCount: number
): SyncState {
  return {
    ...state,
    lastSyncTime: Date.now(),
    notebooks: {
      ...state.notebooks,
      [notebookId]: {
        id: notebookId,
        title,
        lastModified: modificationTime,
        pageCount,
        lastSynced: Date.now(),
      },
    },
  };
}

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

/** Tracks a failed sync attempt for recovery. */
export interface FailedSyncRecord {
  notebookId: string;
  title: string;
  error: string;
  failedAt: number;
  attempts: number;
}

/** Full sync state persisted via plugin data. */
export interface SyncState {
  lastSyncTime: number;
  notebooks: Record<string, NotebookSyncRecord>;
  /** Notebooks that failed during the last sync (for retry on next run). */
  failedNotebooks: FailedSyncRecord[];
}

/** Creates a fresh empty sync state. */
export function createEmptySyncState(): SyncState {
  return {
    lastSyncTime: 0,
    notebooks: {},
    failedNotebooks: [],
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
    } else if (notebook.modificationTime === 0) {
      // modificationTime unknown from list API — always re-check
      toSync.push({ ...notebook, reason: "modified" });
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


/**
 * Record a failed notebook sync for retry on the next run.
 */
export function recordFailedSync(
  state: SyncState,
  notebookId: string,
  title: string,
  error: string
): SyncState {
  const existing = state.failedNotebooks.find((f) => f.notebookId === notebookId);
  const attempts = existing ? existing.attempts + 1 : 1;

  const updatedFailed = state.failedNotebooks.filter(
    (f) => f.notebookId !== notebookId
  );

  // Only keep retrying up to 5 times
  if (attempts <= 5) {
    updatedFailed.push({
      notebookId,
      title,
      error,
      failedAt: Date.now(),
      attempts,
    });
  }

  return {
    ...state,
    failedNotebooks: updatedFailed,
  };
}

/**
 * Remove a notebook from the failed list after successful sync.
 */
export function clearFailedSync(state: SyncState, notebookId: string): SyncState {
  return {
    ...state,
    failedNotebooks: state.failedNotebooks.filter(
      (f) => f.notebookId !== notebookId
    ),
  };
}

/**
 * Get notebook IDs that previously failed and should be retried.
 */
export function getFailedNotebookIds(state: SyncState): string[] {
  return state.failedNotebooks.map((f) => f.notebookId);
}

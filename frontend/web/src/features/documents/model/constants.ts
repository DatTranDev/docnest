export const DOCUMENT_TIMING = {
  draftIdleMs: 2000,
  draftChangeCount: 50,
  tickMs: 1000,
  autosaveIntervalMs: 15000,
  autosaveIdleMs: 5000,
  autosaveMaxDirtyMs: 60000,
  accessPollMs: 30000,
} as const;
export const SAVE_COMMIT_ATTEMPTS = 3;

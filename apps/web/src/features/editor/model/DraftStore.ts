import { ChangeSet } from '@codemirror/state';
import { decodeNative, decodeStyles, encodeNative, type Snapshot } from '@ted/editor-core';
export interface DraftDelta {
  changes: unknown;
  ranges: { from: number; to: number; styles: Uint8Array }[];
  revision: number;
  token: string;
  checkpoint?: boolean;
}
export interface DraftMeta {
  key: string;
  userId: string;
  documentId: string;
  baseHeadRevision: number;
  updatedAt: number;
  token: string;
  native: Uint8Array;
  journal?: DraftDelta[];
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('ted-drafts-v1', 2);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains('snapshots'))
        r.result.createObjectStore('snapshots', { keyPath: 'key' });
      if (!r.result.objectStoreNames.contains('pointers')) r.result.createObjectStore('pointers');
      if (!r.result.objectStoreNames.contains('journals')) r.result.createObjectStore('journals');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function checkpoint(
  userId: string,
  documentId: string,
  baseHeadRevision: number,
  s: Snapshot,
): Promise<void> {
  const native = await encodeNative(s),
    db = await database(),
    key = `${userId}/${documentId}/${baseHeadRevision}/${s.contentToken}`;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['snapshots', 'pointers'], 'readwrite');
    tx.objectStore('snapshots').put({
      key,
      userId,
      documentId,
      baseHeadRevision,
      updatedAt: Date.now(),
      token: s.contentToken,
      native,
    } satisfies DraftMeta);
    tx.objectStore('pointers').put(key, `${userId}/${documentId}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}
export async function recover(userId: string, documentId: string): Promise<DraftMeta | null> {
  const db = await database();
  const result = await new Promise<DraftMeta | null>((resolve, reject) => {
    const tx = db.transaction(['snapshots', 'pointers', 'journals']);
    const p = tx.objectStore('pointers').get(`${userId}/${documentId}`);
    p.onsuccess = () => {
      if (!p.result) {
        resolve(null);
        return;
      }
      const s = tx.objectStore('snapshots').get(p.result as string);
      s.onsuccess = () => {
        if (!s.result) {
          resolve(null);
          return;
        }
        const j = tx.objectStore('journals').get(p.result as string);
        j.onsuccess = () =>
          resolve({ ...(s.result as DraftMeta), ...(j.result as Partial<DraftMeta>) });
        j.onerror = () => reject(j.error);
      };
      s.onerror = () => reject(s.error);
    };
    p.onerror = () => reject(p.error);
  });
  db.close();
  return result;
}
export async function clearDraft(userId: string, documentId: string): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['snapshots', 'pointers', 'journals'], 'readwrite'),
      store = tx.objectStore('snapshots'),
      cursor = store.openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (c) {
        const v = c.value as DraftMeta;
        if (v.userId === userId && v.documentId === documentId) {
          c.delete();
          tx.objectStore('journals').delete(v.key);
        }
        c.continue();
      }
    };
    tx.objectStore('pointers').delete(`${userId}/${documentId}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
export async function restoreDraft(meta: DraftMeta): Promise<Snapshot> {
  let s = await decodeNative(meta.native);
  for (const delta of meta.journal ?? []) {
    const changes = ChangeSet.fromJSON(delta.changes);
    let styles = s.styles;
    for (const r of delta.ranges) styles = styles.replace(r.from, r.to, decodeStyles(r.styles));
    s = {
      ...s,
      text: s.text.apply(changes),
      styles,
      localRevision: delta.revision,
      contentToken: delta.token,
    };
  }
  return s;
}
export class DraftWriter {
  private base: Snapshot;
  private journal: DraftDelta[] = [];
  private bytes = 0;
  private latest: Snapshot;
  private persistedRevision = -1;
  private writtenBaseKey = '';
  private writing: Promise<void> = Promise.resolve();
  constructor(
    readonly userId: string,
    readonly documentId: string,
    readonly head: () => number,
    snapshot: Snapshot,
  ) {
    this.base = snapshot;
    this.latest = snapshot;
  }
  reset(snapshot: Snapshot): void {
    this.base = snapshot;
    this.latest = snapshot;
    this.journal = [];
    this.bytes = 0;
    this.writtenBaseKey = '';
    this.persistedRevision = -1;
  }
  track(delta: DraftDelta, snapshot: Snapshot): void {
    this.latest = snapshot;
    if (delta.checkpoint) {
      this.base = snapshot;
      this.journal = [];
      this.bytes = 0;
      return;
    }
    this.journal.push(delta);
    this.bytes +=
      JSON.stringify(delta.changes).length * 2 +
      delta.ranges.reduce((n, r) => n + r.styles.length, 0);
    if (this.journal.length >= 100 || this.bytes >= 1024 * 1024) {
      this.base = snapshot;
      this.journal = [];
      this.bytes = 0;
    }
  }
  flush(): Promise<void> {
    if (this.persistedRevision === this.latest.localRevision) return this.writing;
    const base = this.base,
      journal = [...this.journal],
      latest = this.latest,
      head = this.head(),
      key = `${this.userId}/${this.documentId}/${head}/${base.contentToken}`;
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        const native = this.writtenBaseKey === key ? null : await encodeNative(base),
          db = await database();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(['snapshots', 'pointers', 'journals'], 'readwrite');
          if (native)
            tx.objectStore('snapshots').put({
              key,
              userId: this.userId,
              documentId: this.documentId,
              baseHeadRevision: head,
              updatedAt: Date.now(),
              token: base.contentToken,
              native,
            } satisfies DraftMeta);
          tx.objectStore('journals').put(
            { journal, updatedAt: Date.now(), token: latest.contentToken },
            key,
          );
          tx.objectStore('pointers').put(key, `${this.userId}/${this.documentId}`);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
        db.close();
        this.writtenBaseKey = key;
        this.persistedRevision = latest.localRevision;
      });
    return this.writing;
  }
}

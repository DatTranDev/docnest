export interface PendingUpdate {
  id: string;
  payload: Uint8Array;
}

/** Only unacknowledged updates persist here. Server owns the durable room log. */
export class CollaborationJournal {
  private db: IDBDatabase | null = null;
  constructor(private readonly key: string) {}

  async open(): Promise<PendingUpdate[]> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ted-collaboration', 2);
      request.onupgradeneeded = () => {
        const updates = request.result.createObjectStore('updates', { keyPath: ['room', 'id'] });
        updates.createIndex('room', 'room');
        if (request.result.objectStoreNames.contains('pending')) {
          const cursor = request.transaction!.objectStore('pending').openCursor();
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (!row) {
              request.result.deleteObjectStore('pending');
              return;
            }
            for (const item of row.value as PendingUpdate[])
              updates.put({ ...item, room: String(row.key) });
            row.continue();
          };
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    this.db = db;
    return new Promise((resolve, reject) => {
      const request = db
        .transaction('updates')
        .objectStore('updates')
        .index('room')
        .getAll(this.key);
      request.onsuccess = () => resolve((request.result as PendingUpdate[]) ?? []);
      request.onerror = () => reject(request.error);
    });
  }

  put(update: PendingUpdate): Promise<void> {
    return this.mutate((store) => store.put({ ...update, room: this.key }));
  }

  remove(id: string): Promise<void> {
    return this.mutate((store) => store.delete([this.key, id]));
  }

  private mutate(action: (store: IDBObjectStore) => void): Promise<void> {
    const db = this.db;
    if (!db) return Promise.reject(new Error('COLLABORATION_JOURNAL_CLOSED'));
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('updates', 'readwrite');
      action(transaction.objectStore('updates'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}

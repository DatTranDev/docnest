import { COLLABORATION_LIMITS } from './constants';
import { MESSAGE } from '@/lib/i18n/messages';
import { SharedDocument, type Snapshot } from '@ted/editor-core';
import { ApiError, binaryRequest, request } from '@/lib/http';
import { CollaborationJournal, type PendingUpdate } from './CollaborationJournal';

type Page = {
  headRevision: number;
  sequence: number;
  updates: { sequence: number; payload: string }[];
};
export class CollaborationClient {
  readonly shared = new SharedDocument();
  private pending: PendingUpdate[] = [];
  private cursor = 0;
  private stopped = false;
  private active: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe: (() => void) | undefined;
  private persistence = Promise.resolve();
  private checkpointing = false;
  private remoteChanged = false;
  private hydrated = false;
  private journal: CollaborationJournal;
  private readonly path: string;
  headRevision: number;
  status: string = MESSAGE.connecting;
  get available(): boolean {
    return !this.stopped;
  }

  constructor(
    documentId: string,
    userId: string,
    revision: number,
    private readonly project: () => void,
    private readonly changed: () => void,
    private readonly failed: (error: unknown) => void,
  ) {
    this.path = `/api/v1/collaboration/${documentId}`;
    this.journal = new CollaborationJournal(`${userId}:${documentId}`);
    this.headRevision = revision;
  }

  async start(snapshot: Snapshot): Promise<void> {
    const seed = new SharedDocument();
    try {
      seed.seed(snapshot);
      this.pending = await this.journal.open();
      if (this.stopped) {
        this.journal.close();
        return;
      }
      const page = await binaryRequest<Page>(
        `${this.path}/join?headRevision=${this.headRevision}`,
        seed.encode(),
      );
      if (this.stopped) return;
      this.receive(page);
      while (this.cursor < page.sequence) {
        const next = await request<Page>(`${this.path}/updates?after=${this.cursor}`);
        if (this.stopped) return;
        this.receive(next);
      }
      for (const update of this.pending) this.shared.apply(update.payload);
      if (this.stopped) return;
      this.hydrated = true;
      this.project();
      this.remoteChanged = false;
      this.unsubscribe = this.shared.onUpdate((payload) => {
        if (
          payload.length > COLLABORATION_LIMITS.updateBytes ||
          this.pending.reduce((size, item) => size + item.payload.length, payload.length) >
            COLLABORATION_LIMITS.pendingBytes
        ) {
          this.fail(new Error('COLLABORATION_PENDING_LIMIT'));
          return;
        }
        const item = { id: crypto.randomUUID(), payload };
        this.pending.push(item);
        this.persistence = this.persistence.then(() => this.journal.put(item));
        void this.persistence.catch((error) => this.fail(error));
        this.setStatus(MESSAGE.syncing);
      });
      this.schedule();
    } finally {
      seed.destroy();
    }
  }

  private receive(page: Page): void {
    this.headRevision = page.headRevision;
    for (const update of page.updates) {
      const raw = atob(update.payload);
      this.remoteChanged =
        this.shared.apply(Uint8Array.from(raw, (c) => c.charCodeAt(0))) || this.remoteChanged;
      this.cursor = update.sequence;
    }
    // Keep CRDT and editor bases in sync before yielding to another local keystroke.
    if (this.hydrated && this.remoteChanged && !this.stopped) {
      this.project();
      this.remoteChanged = false;
    }
  }

  async sync(): Promise<void> {
    if (this.stopped) throw new Error('COLLABORATION_UNAVAILABLE');
    if (this.active) return this.active;
    const work = async () => {
      const previousHead = this.headRevision;
      await this.persistence;
      if (this.stopped) return;
      while (this.pending.length && !this.stopped) {
        const item = this.pending[0]!;
        await binaryRequest(`${this.path}/updates/${item.id}`, item.payload);
        if (this.stopped) return;
        this.pending.shift();
        this.persistence = this.persistence.then(() => this.journal.remove(item.id));
        await this.persistence;
      }
      let count = 0;
      for (;;) {
        const page = await request<Page>(`${this.path}/updates?after=${this.cursor}`);
        if (this.stopped) return;
        this.receive(page);
        if (this.cursor >= page.sequence) break;
        if (++count >= COLLABORATION_LIMITS.catchupPages)
          throw new Error('COLLABORATION_CATCHING_UP');
      }
      if (!this.stopped && this.remoteChanged) {
        this.project();
        this.remoteChanged = false;
      }
      this.setStatus(
        this.pending.length ? MESSAGE.syncing : MESSAGE.collaborationSynced,
        previousHead !== this.headRevision,
      );
    };
    this.active = work();
    try {
      await this.active;
    } finally {
      this.active = null;
    }
  }

  async save(
    snapshot: () => Snapshot,
    encode: (value: Snapshot) => Promise<Uint8Array>,
  ): Promise<{ revision: number; snapshot: Snapshot }> {
    if (this.stopped || this.checkpointing) throw new Error('COLLABORATION_UNAVAILABLE');
    this.checkpointing = true;
    try {
      await this.sync();
      if (this.stopped) throw new Error('COLLABORATION_UNAVAILABLE');
      const pinned = snapshot(),
        sequence = this.cursor;
      const native = await encode(pinned);
      if (this.stopped) throw new Error('COLLABORATION_UNAVAILABLE');
      const result = await binaryRequest<{ revision: number }>(
        `${this.path}/checkpoint?sequence=${sequence}`,
        native,
      );
      this.headRevision = result.revision;
      return { ...result, snapshot: pinned };
    } finally {
      this.checkpointing = false;
    }
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      if (this.stopped) return;
      if (this.checkpointing) {
        this.schedule();
        return;
      }
      void this.sync()
        .catch((error) => {
          if (
            (error instanceof ApiError && [400, 401, 403, 404, 409, 413].includes(error.status)) ||
            (error instanceof Error &&
              !(error instanceof TypeError) &&
              !(error instanceof ApiError) &&
              error.message !== 'COLLABORATION_CATCHING_UP')
          )
            this.fail(error);
          else {
            this.setStatus(MESSAGE.waitingForConnectionDraftRetained);
          }
        })
        .finally(() => {
          if (!this.stopped) this.schedule();
        });
    }, COLLABORATION_LIMITS.pollMs);
  }

  private fail(error: unknown): void {
    this.stopped = true;
    this.failed(error);
  }

  private setStatus(value: string, headChanged = false): void {
    if (this.status === value && !headChanged) return;
    this.status = value;
    this.changed();
  }

  destroy(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.unsubscribe?.();
    void this.persistence.then(
      () => this.journal.close(),
      () => this.journal.close(),
    );
    this.shared.destroy();
  }
}

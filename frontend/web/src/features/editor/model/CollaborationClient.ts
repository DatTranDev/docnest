import { COLLABORATION_LIMITS } from './constants';
import { MESSAGE } from '@/lib/i18n/messages';
import { SharedDocument, type Snapshot } from '@ted/editor-core';
import { ApiError, binaryRequest, request } from '@/lib/http';
import { CollaborationJournal, type PendingUpdate } from './CollaborationJournal';
import { currentSession } from '@/features/auth';

type Page = {
  headRevision: number;
  sequence: number;
  updates: { sequence: number; payload: string }[];
};
export type Collaborator = {
  userId: string;
  sessionId: string;
  anchor: number | null;
  head: number | null;
  displayName: string;
  avatarUrl: string | null;
};
type PresenceMember = Pick<Collaborator, 'userId' | 'sessionId' | 'anchor' | 'head'>;
type PublicProfile = { displayName: string; avatarUrl: string | null };
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
  private readonly sessionId = crypto.randomUUID();
  private nextPresenceAt = 0;
  private socket: WebSocket | null = null;
  private socketReady = false;
  private nextSocketAt = 0;
  private profiles = new Map<string, PublicProfile>();
  members: Collaborator[] = [];
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
    private readonly selection: () => { anchor: number; head: number },
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
      // The first room update is the native document seed. Reprojecting that
      // unchanged snapshot would mark a freshly opened document as unsaved.
      if (this.cursor > 1 || this.pending.length) this.project();
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
      await this.refreshPresence();
      this.openSocket();
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
      if (Date.now() >= this.nextPresenceAt) await this.refreshPresence();
    };
    this.active = work();
    try {
      await this.active;
    } finally {
      this.active = null;
    }
  }

  private async refreshPresence(): Promise<void> {
    const cursor = this.selection();
    await request<void>(`${this.path}/presence/${this.sessionId}`, 'POST', cursor);
    const members = await request<PresenceMember[]>(`${this.path}/presence`);
    for (const member of members) {
      if (!this.profiles.has(member.userId)) {
        const profile = await request<PublicProfile>(
          `/api/v1/users/${member.userId}/profile`,
        ).catch(() => ({ displayName: member.userId.slice(0, 8), avatarUrl: null }));
        this.profiles.set(member.userId, profile);
      }
    }
    if (this.stopped) return;
    this.members = members.map((member) => ({
      ...member,
      ...this.profiles.get(member.userId)!,
    }));
    this.nextPresenceAt = Date.now() + 2500;
    this.changed();
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
    this.timer = setTimeout(
      () => {
        if (this.stopped) return;
        if (!this.socket && Date.now() >= this.nextSocketAt) this.openSocket();
        if (this.checkpointing) {
          this.schedule();
          return;
        }
        void this.sync()
          .catch((error) => {
            if (
              (error instanceof ApiError &&
                [400, 401, 403, 404, 409, 413].includes(error.status)) ||
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
      },
      this.socketReady ? 2500 : COLLABORATION_LIMITS.pollMs,
    );
  }

  private openSocket(): void {
    if (this.stopped || this.socket || typeof WebSocket === 'undefined') return;
    const address = new URL(`${this.path}/socket`, window.location.href);
    address.protocol = address.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(address);
    this.socket = socket;
    this.nextSocketAt = Date.now() + 5000;
    socket.onopen = () => {
      const token = currentSession()?.accessToken;
      if (token && !this.stopped) socket.send(token);
      else socket.close();
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string' || this.stopped) return;
      if (event.data.startsWith('READY:')) this.socketReady = true;
      if (event.data.startsWith('UPDATE:')) void this.sync().catch(() => {});
    };
    socket.onclose = () => {
      if (this.socket === socket) {
        this.socket = null;
        this.socketReady = false;
      }
    };
    socket.onerror = () => socket.close();
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
    this.socket?.close();
    this.socket = null;
    clearTimeout(this.timer);
    void request<void>(`${this.path}/presence/${this.sessionId}`, 'DELETE').catch(() => {});
    this.unsubscribe?.();
    void this.persistence.then(
      () => this.journal.close(),
      () => this.journal.close(),
    );
    this.shared.destroy();
  }
}

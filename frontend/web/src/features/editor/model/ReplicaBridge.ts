import { ChangeSet } from '@codemirror/state';
import {
  encodeStyles,
  type EditorModel,
  type FormattingData,
  type SearchResult,
  type Snapshot,
} from '@ted/editor-core';
export class ReplicaBridge {
  readonly worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  generation = 0;
  revision = 0;
  ackRevision = -1;
  requestId = 0;
  queueBytes = 0;
  queueCount = 0;
  model: EditorModel | null = null;
  private readonly pending = new Map<
    number,
    {
      type: string;
      generation: number;
      resolve: (v: Record<string, unknown>) => void;
      reject: (reason: unknown) => void;
    }
  >();
  private readonly waiters: (() => void)[] = [];
  private searchEpoch = 0;
  private closed = false;
  constructor() {
    this.worker.onmessage = (e) => {
      const m = e.data as Record<string, unknown>,
        requestId = m.requestId as number,
        p = this.pending.get(requestId);
      if (
        p &&
        m.generationId === p.generation &&
        ['search', 'snapshot', 'error'].includes(m.type as string)
      ) {
        this.pending.delete(requestId);
        if (m.type === 'error') p.reject(new Error(String(m.error)));
        else p.resolve(m);
        return;
      }
      if (m.generationId !== this.generation) return;
      if (m.type === 'ack') {
        this.ackRevision = m.revision as number;
        if (this.ackRevision === this.revision) {
          this.queueBytes = 0;
          this.queueCount = 0;
          for (const r of this.waiters.splice(0)) r();
        }
      } else if (m.type === 'resync') {
        if (p) {
          this.pending.delete(requestId);
          p.reject(new Error('RESYNC'));
        }
        if (this.model) this.init(this.model);
      }
    };
  }
  private cancelSearches(): void {
    for (const [id, p] of this.pending) {
      if (p.type !== 'search') continue;
      this.worker.postMessage({ type: 'cancel', requestId: id });
      this.pending.delete(id);
      p.resolve({ revision: -1, count: 0, matches: [], truncated: false });
    }
  }
  init(model: EditorModel): void {
    if (this.closed) throw new Error('CLOSED');
    this.cancelSearches();
    this.model = model;
    this.generation++;
    this.revision = model.localRevision;
    this.ackRevision = -1;
    this.worker.postMessage({
      type: 'init',
      generationId: this.generation,
      revision: model.localRevision,
      text: model.text.slice(),
      styles: encodeStyles(model.styles),
      formatting: model.formatting.toJSON(),
    });
  }
  update(
    model: EditorModel,
    changes: ChangeSet,
    ranges: { from: number; to: number; newFrom: number; newTo: number }[],
  ): void {
    if (
      ranges.length > 100 ||
      ranges.some((r) => r.to - r.from + r.newTo - r.newFrom > 256 * 1024) ||
      this.queueCount >= 100
    ) {
      this.init(model);
      return;
    }
    const encoded = ranges
        .sort((a, b) => b.from - a.from)
        .map((r) => ({
          from: r.from,
          to: r.to,
          styles: encodeStyles(model.styles.slice(r.newFrom, r.newTo)),
        })),
      size = encoded.reduce(
        (n, r) => n + r.styles.length,
        JSON.stringify(changes.toJSON()).length * 2,
      );
    if (this.queueBytes + size > 4 * 1024 * 1024) {
      this.init(model);
      return;
    }
    this.worker.postMessage({
      type: 'delta',
      generationId: this.generation,
      baseRevision: this.revision,
      revision: model.localRevision,
      changes: changes.toJSON(),
      ranges: encoded,
      formatting: model.formatting.toJSON() satisfies FormattingData,
    });
    this.queueBytes += size;
    this.queueCount++;
    this.revision = model.localRevision;
  }
  private async ready(): Promise<void> {
    if (this.closed) throw new Error('CLOSED');
    if (this.ackRevision === this.revision) return;
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    if (this.closed) throw new Error('CLOSED');
  }
  async search(query: string, ignoreCase = false): Promise<SearchResult & { revision: number }> {
    const epoch = ++this.searchEpoch;
    this.cancelSearches();
    await this.ready();
    if (this.closed) throw new Error('CLOSED');
    if (epoch !== this.searchEpoch)
      return { revision: -1, count: 0, matches: [], truncated: false };
    const requestId = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, {
        type: 'search',
        generation: this.generation,
        resolve: (m) => resolve(m as unknown as SearchResult & { revision: number }),
        reject,
      });
      this.worker.postMessage({
        type: 'search',
        generationId: this.generation,
        requestId,
        revision: this.revision,
        query,
        ignoreCase,
      });
    });
  }
  snapshotFor(s: Snapshot): Promise<Uint8Array> {
    if (this.closed) return Promise.reject(new Error('CLOSED'));
    const requestId = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, {
        type: 'snapshot',
        generation: this.generation,
        resolve: (m) => resolve(m.bytes as Uint8Array),
        reject,
      });
      this.worker.postMessage({
        type: 'snapshot',
        generationId: this.generation,
        requestId,
        revision: s.localRevision,
        contentToken: s.contentToken,
        preferredExportEol: s.preferredExportEol,
        exportBom: s.exportBom,
        images: s.images?.toJSON(),
      });
    });
  }
  snapshot(model: EditorModel): Promise<Uint8Array> {
    if (this.revision !== model.localRevision) this.init(model);
    return this.snapshotFor(model.snapshot());
  }
  destroy(): void {
    this.closed = true;
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('CLOSED'));
    this.pending.clear();
    for (const r of this.waiters.splice(0)) r();
  }
}

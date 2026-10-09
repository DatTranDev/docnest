import { ChangeSet } from '@codemirror/state';
import {
  decodeStyles,
  encodeNative,
  RichFormatting,
  ImageStore,
  TextAdapter,
  type FormattingData,
  type ImageData,
  type Snapshot,
} from '@ted/editor-core';
type Range = { from: number; to: number; styles: Uint8Array };
type Message =
  | {
      type: 'init';
      generationId: number;
      revision: number;
      text: string;
      styles: Uint8Array;
      formatting: FormattingData;
    }
  | {
      type: 'delta';
      generationId: number;
      baseRevision: number;
      revision: number;
      changes: unknown;
      ranges: Range[];
      formatting: FormattingData;
    }
  | {
      type: 'search';
      generationId: number;
      requestId: number;
      revision: number;
      query: string;
      ignoreCase: boolean;
    }
  | {
      type: 'snapshot';
      generationId: number;
      requestId: number;
      revision: number;
      contentToken: string;
      preferredExportEol: 'LF' | 'CRLF';
      exportBom: boolean;
      images?: ImageData;
    }
  | { type: 'cancel'; requestId: number };
let replica: Snapshot | null = null,
  generation = 0;
const cancelled = new Set<number>();
const taskChannel = new MessageChannel(),
  yielders: (() => void)[] = [];
taskChannel.port1.onmessage = () => yielders.shift()?.();
const yieldTask = () =>
  new Promise<void>((resolve) => {
    yielders.push(resolve);
    taskChannel.port2.postMessage(null);
  });
self.onmessage = (event: MessageEvent<Message>) => {
  const m = event.data;
  if (m.type === 'cancel') {
    cancelled.add(m.requestId);
    return;
  }
  if (m.type === 'init') {
    generation = m.generationId;
    const text = TextAdapter.from(m.text);
    replica = {
      text,
      styles: decodeStyles(m.styles),
      formatting: RichFormatting.parse(m.formatting, text),
      localRevision: m.revision,
      contentToken: 'replica',
      preferredExportEol: 'LF',
      exportBom: false,
    };
    self.postMessage({ type: 'ack', generationId: generation, revision: m.revision });
    return;
  }
  if (!replica || m.generationId !== generation) return;
  if (m.type === 'delta') {
    if (m.baseRevision !== replica.localRevision) {
      self.postMessage({ type: 'resync', generationId: generation });
      return;
    }
    const changes = ChangeSet.fromJSON(m.changes);
    let styles = replica.styles;
    for (const r of m.ranges) styles = styles.replace(r.from, r.to, decodeStyles(r.styles));
    const text = replica.text.apply(changes);
    replica = {
      ...replica,
      text,
      styles,
      formatting: RichFormatting.parse(m.formatting, text),
      localRevision: m.revision,
    };
    self.postMessage({ type: 'ack', generationId: generation, revision: m.revision });
    return;
  }
  const pinned = replica;
  if (m.revision !== pinned.localRevision) {
    self.postMessage({ type: 'resync', generationId: generation, requestId: m.requestId });
    return;
  }
  if (m.type === 'snapshot') {
    void encodeNative({
      ...pinned,
      images: m.images ? ImageStore.parse(m.images, pinned.text) : new ImageStore(),
      contentToken: m.contentToken,
      preferredExportEol: m.preferredExportEol,
      exportBom: m.exportBom,
    })
      .then((bytes) =>
        self.postMessage(
          {
            type: 'snapshot',
            generationId: m.generationId,
            requestId: m.requestId,
            revision: m.revision,
            bytes,
          },
          [bytes.buffer],
        ),
      )
      .catch((error) =>
        self.postMessage({
          type: 'error',
          generationId: m.generationId,
          requestId: m.requestId,
          error: String(error),
        }),
      );
    return;
  }
  void literal(pinned.text, m.query, m.ignoreCase, m.requestId)
    .then((result) => {
      if (!cancelled.has(m.requestId))
        self.postMessage({
          type: 'search',
          generationId: m.generationId,
          requestId: m.requestId,
          revision: m.revision,
          ...result,
        });
    })
    .catch((error) => {
      if (!cancelled.has(m.requestId))
        self.postMessage({
          type: 'error',
          generationId: m.generationId,
          requestId: m.requestId,
          error: String(error),
        });
    })
    .finally(() => cancelled.delete(m.requestId));
};
async function literal(
  text: TextAdapter,
  query: string,
  ignoreCase: boolean,
  id: number,
): Promise<{ count: number; matches: number[]; truncated: boolean }> {
  const fold = (c: number) => (ignoreCase && c >= 65 && c <= 90 ? c + 32 : c),
    p = Array.from({ length: query.length }, (_, i) => fold(query.charCodeAt(i))),
    table = new Uint32Array(p.length);
  if (!p.length) return { count: 0, matches: [], truncated: false };
  for (let i = 1, j = 0; i < p.length; i++) {
    while (j && p[i] !== p[j]) j = table[j - 1]!;
    if (p[i] === p[j]) j++;
    table[i] = j;
  }
  let matched = 0,
    pos = 0,
    count = 0,
    nextYield = 262144;
  const matches: number[] = [];
  for (const chunk of text.chunks()) {
    for (let i = 0; i < chunk.length; i++, pos++) {
      if (pos === nextYield) {
        nextYield += 262144;
        await yieldTask();
        if (cancelled.has(id)) throw new Error('CANCELLED');
      }
      const c = fold(chunk.charCodeAt(i));
      while (matched && c !== p[matched]) matched = table[matched - 1]!;
      if (c === p[matched]) matched++;
      if (matched === p.length) {
        count++;
        if (matches.length < 10000) matches.push(pos - p.length + 1);
        matched = 0;
      }
    }
  }
  return { count, matches, truncated: count > matches.length };
}

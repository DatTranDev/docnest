import { PARAGRAPH_KEYS, PAGE_KEYS, type ParagraphStyle, type PageSettings } from './structure';
import * as Y from 'yjs';
import { ChangeSet, EditorSelection } from '@codemirror/state';
import { EditorModel, type Snapshot } from './model';
import { StyleTree } from './style';
import { RichFormatting, type FormatRun, type ParagraphFormat } from './formatting';
import { ImageStore, type ImageAsset, type PlacedImage } from './images';
import { graphemes, TextAdapter } from './text';

/** Collaboration is deliberately bounded separately from the large-file editor. */
export const COLLABORATION_TEXT_LIMIT = 200_000;
type Attributes = Record<string, unknown>;
type Delta = { insert?: string; retain?: number; delete?: number; attributes?: Attributes };

/** CRDT owns concurrent identity; native snapshots remain the interchange format. */
export class SharedDocument {
  readonly document = new Y.Doc();
  readonly text = this.document.getText('text');
  private readonly assets = this.document.getMap<ImageAsset>('assets');
  private readonly settings = this.document.getMap<string>('settings');
  private readonly localOrigin = {};
  readonly undoManager = new Y.UndoManager([this.text, this.assets, this.settings], {
    trackedOrigins: new Set([this.localOrigin]),
    captureTimeout: 500,
  });

  seed(snapshot: Snapshot): void {
    if (this.text.length || this.assets.size) throw new Error('COLLABORATION_ALREADY_SEEDED');
    this.checkSize(snapshot);
    this.document.transact(() => {
      this.text.insert(0, snapshot.text.slice());
      this.writeAttributes(snapshot, 0, snapshot.text.length);
      this.writeEmptyParagraph(snapshot);
      this.writePage(snapshot);
    }, 'seed');
  }

  private checkSize(snapshot: Snapshot): void {
    if (snapshot.text.length > COLLABORATION_TEXT_LIMIT)
      throw new Error('COLLABORATION_TEXT_LIMIT');
  }

  /** Call after a validated local editor transaction, with its original ChangeSet. */
  publish(
    snapshot: Snapshot,
    changes: ChangeSet,
    ranges: { newFrom: number; newTo: number }[],
  ): void {
    this.checkSize(snapshot);
    if (changes.length !== this.text.length) throw new Error('COLLABORATION_BASE_MISMATCH');
    this.document.transact(() => {
      let offset = 0;
      changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
        if (to > from) this.text.delete(from + offset, to - from);
        if (inserted.length) this.text.insert(from + offset, inserted.toString());
        offset += inserted.length - (to - from);
      });
      for (const range of ranges) this.writeAttributes(snapshot, range.newFrom, range.newTo);
      this.writeEmptyParagraph(snapshot);
      this.writePage(snapshot);
      // Alignment belongs to the paragraph, including its terminator. Empty final
      // paragraphs acquire alignment when text is inserted there.
      for (const paragraph of snapshot.formatting?.paragraphs ?? []) {
        const line = snapshot.text.text.lineAt(paragraph.from);
        const end = Math.min(snapshot.text.length, line.to + 1);
        if (end > line.from)
          this.text.format(line.from, end - line.from, this.paragraphAttributes(paragraph));
      }
    }, this.localOrigin);
  }

  private writeAttributes(snapshot: Snapshot, from: number, to: number): void {
    if (from >= to) return;
    const points = new Set([from, to]);
    for (
      let line = snapshot.text.text.lineAt(from).number + 1;
      line <= snapshot.text.text.lineAt(to).number;
      line++
    )
      points.add(snapshot.text.text.line(line).from);
    for (const run of snapshot.formatting?.query(from, to) ?? []) {
      points.add(run.from);
      points.add(run.to);
    }
    for (const image of snapshot.images?.query(from, to) ?? []) {
      points.add(image.from);
      points.add(image.from + 1);
      if (!this.assets.has(image.id)) {
        const { from: _position, ...asset } = image;
        this.assets.set(image.id, asset);
      }
    }
    // Masks are compact runs, never one CRDT record per character.
    let at = from;
    for (const run of snapshot.styles.queryRuns(from, to)) {
      at = run.to;
      points.add(at);
    }
    const sorted = [...points].sort((a, b) => a - b);
    for (let index = 0; index + 1 < sorted.length; index++) {
      const start = sorted[index]!,
        end = sorted[index + 1]!;
      const rich = snapshot.formatting?.at(start);
      this.text.format(start, end - start, {
        bold: !!(snapshot.styles.maskAt(start) & 1),
        italic: !!(snapshot.styles.maskAt(start) & 2),
        underline: !!(snapshot.styles.maskAt(start) & 4),
        font: rich?.font ?? null,
        size: rich?.size ?? null,
        color: rich?.color ?? null,
        background: rich?.background ?? null,
        strike: rich?.strike ?? null,
        script: rich?.script ?? null,
        link: rich?.link ?? null,
        image: snapshot.images?.at(start)?.id ?? null,
        ...this.paragraphAttributes(
          snapshot.formatting?.paragraphAt(snapshot.text.text.lineAt(start).from) ?? {
            align: 'left',
          },
        ),
      });
    }
  }

  private paragraphAttributes(paragraph: ParagraphStyle & { align: string }): Attributes {
    return {
      align: paragraph.align,
      ...Object.fromEntries(
        PARAGRAPH_KEYS.map((key) => [
          key,
          key === 'table' && paragraph.table
            ? JSON.stringify(paragraph.table)
            : (paragraph[key] ?? null),
        ]),
      ),
    };
  }
  private writePage(snapshot: Snapshot): void {
    for (const key of PAGE_KEYS) {
      const value = snapshot.formatting?.page[key];
      const name = `page-${key}`;
      if (value === undefined) this.settings.delete(name);
      else this.settings.set(name, JSON.stringify(value));
    }
  }
  private writeEmptyParagraph(snapshot: Snapshot): void {
    const last = snapshot.text.text.line(snapshot.text.lines);
    if (last.from === snapshot.text.length)
      this.settings.set('emptyLastAlignment', snapshot.formatting?.alignAt(last.from) ?? 'left');
    else this.settings.delete('emptyLastAlignment');
    if (last.from === snapshot.text.length)
      this.settings.set(
        'emptyLastParagraph',
        JSON.stringify(
          snapshot.formatting?.paragraphAt(last.from) ?? { from: last.from, align: 'left' },
        ),
      );
    else this.settings.delete('emptyLastParagraph');
  }

  apply(update: Uint8Array): boolean {
    let changed = false;
    const listener = () => {
      changed = true;
    };
    this.document.on('update', listener);
    try {
      Y.applyUpdate(this.document, update, 'remote');
    } finally {
      this.document.off('update', listener);
    }
    if (this.text.length > COLLABORATION_TEXT_LIMIT) throw new Error('COLLABORATION_TEXT_LIMIT');
    return changed;
  }

  encode(): Uint8Array {
    return Y.encodeStateAsUpdate(this.document);
  }

  onUpdate(listener: (update: Uint8Array) => void): () => void {
    const handler = (update: Uint8Array, origin: unknown) => {
      if (origin === this.localOrigin || origin === this.undoManager) listener(update);
    };
    this.document.on('update', handler);
    return () => this.document.off('update', handler);
  }

  snapshot(base: Snapshot): Snapshot {
    const value = this.text.toString();
    const text = TextAdapter.from(value);
    let styles = StyleTree.uniform(0),
      position = 0;
    let runs: FormatRun[] = [];
    const paragraphs: ParagraphFormat[] = [],
      images: PlacedImage[] = [];
    for (const delta of this.text.toDelta() as Delta[]) {
      if (typeof delta.insert !== 'string') throw new Error('COLLABORATION_INVALID_CONTENT');
      const attrs = delta.attributes ?? {},
        end = position + delta.insert.length;
      const mask = (attrs.bold ? 1 : 0) | (attrs.italic ? 2 : 0) | (attrs.underline ? 4 : 0);
      styles = styles.concat(StyleTree.uniform(delta.insert.length, mask));
      if (
        attrs.font ||
        attrs.size ||
        attrs.color ||
        attrs.background ||
        attrs.strike ||
        attrs.script ||
        attrs.link
      )
        runs.push({
          from: position,
          to: end,
          ...(attrs.link ? { link: attrs.link as string } : {}),
          ...(attrs.font ? { font: attrs.font as FormatRun['font'] } : {}),
          ...(attrs.size ? { size: attrs.size as number } : {}),
          ...(attrs.color ? { color: attrs.color as string } : {}),
          ...(attrs.background ? { background: attrs.background as string } : {}),
          ...(attrs.strike ? { strike: attrs.strike as boolean } : {}),
          ...(attrs.script ? { script: attrs.script as FormatRun['script'] } : {}),
        });
      if (attrs.image) {
        const asset = this.assets.get(String(attrs.image));
        if (!asset || delta.insert !== '\ufffc') throw new Error('COLLABORATION_INVALID_IMAGE');
        images.push({ ...asset, from: position });
      }
      if (
        (attrs.align && attrs.align !== 'left') ||
        PARAGRAPH_KEYS.some((key) => attrs[key] !== undefined && attrs[key] !== null)
      ) {
        for (
          let line = text.text.lineAt(position).number;
          line <= text.text.lineAt(end).number;
          line++
        ) {
          const start = text.text.line(line).from;
          if (start >= position && start < end)
            paragraphs.push({
              from: start,
              align: (attrs.align ?? 'left') as ParagraphFormat['align'],
              ...Object.fromEntries(
                PARAGRAPH_KEYS.filter((key) => attrs[key] !== undefined && attrs[key] !== null).map(
                  (key) => [key, key === 'table' ? JSON.parse(String(attrs.table)) : attrs[key]],
                ),
              ),
            });
        }
      }
      position = end;
    }
    if (text.text.line(text.lines).from === text.length) {
      const raw = this.settings.get('emptyLastParagraph'),
        align = this.settings.get('emptyLastAlignment');
      if (raw) {
        const p = JSON.parse(raw) as ParagraphFormat;
        if (p.align !== 'left' || PARAGRAPH_KEYS.some((k) => p[k] !== undefined))
          paragraphs.push({ ...p, from: text.length });
      } else if (align && align !== 'left')
        paragraphs.push({ from: text.length, align: align as ParagraphFormat['align'] });
    }
    const page: PageSettings = Object.fromEntries(
      PAGE_KEYS.filter((key) => this.settings.has(`page-${key}`)).map((key) => [
        key,
        JSON.parse(this.settings.get(`page-${key}`)!),
      ]),
    );
    if (/[^\x00-\x7f]/.test(value)) {
      // Concurrent insertion can create a new grapheme across two CRDT items.
      // The native model assigns the first UTF-16 unit's resolved attributes to
      // the whole cluster, deterministically on every replica.
      const rawFormatting = new RichFormatting(runs, paragraphs);
      const normalized: FormatRun[] = [],
        masks: { length: number; mask: number }[] = [];
      for (const cluster of graphemes(value)) {
        const mask = styles.maskAt(cluster.from),
          previousMask = masks.at(-1);
        if (previousMask?.mask === mask) previousMask.length += cluster.to - cluster.from;
        else masks.push({ length: cluster.to - cluster.from, mask });
        const format = rawFormatting.at(cluster.from);
        if (
          !format.font &&
          !format.size &&
          !format.color &&
          !format.background &&
          !format.strike &&
          !format.script &&
          !format.link
        )
          continue;
        const previous = normalized.at(-1);
        if (
          previous?.to === cluster.from &&
          previous.font === format.font &&
          previous.size === format.size &&
          previous.color === format.color &&
          previous.background === format.background &&
          previous.strike === format.strike &&
          previous.script === format.script &&
          previous.link === format.link
        )
          previous.to = cluster.to;
        else
          normalized.push({
            from: cluster.from,
            to: cluster.to,
            ...(format.link ? { link: format.link } : {}),
            ...(format.font ? { font: format.font } : {}),
            ...(format.size ? { size: format.size } : {}),
            ...(format.color ? { color: format.color } : {}),
            ...(format.background ? { background: format.background } : {}),
            ...(format.strike ? { strike: format.strike } : {}),
            ...(format.script ? { script: format.script } : {}),
          });
      }
      styles = StyleTree.fromRuns(masks);
      runs = normalized;
    }
    return {
      ...base,
      text,
      styles,
      formatting: RichFormatting.parse(
        { runs, paragraphs, ...(Object.keys(page).length ? { page } : {}) },
        text,
      ),
      images: ImageStore.parse({ images }, text),
      contentToken: crypto.randomUUID(),
      localRevision: base.localRevision + 1,
    };
  }

  destroy(): void {
    this.undoManager.destroy();
    this.document.destroy();
  }
}

/** Restore a validated projection without importing another user's undo history. */
export function applySharedSnapshot(model: EditorModel, snapshot: Snapshot): ChangeSet {
  const before = model.text.slice(),
    after = snapshot.text.slice();
  let from = 0,
    oldEnd = before.length,
    newEnd = after.length;
  while (from < oldEnd && from < newEnd && before[from] === after[from]) from++;
  while (oldEnd > from && newEnd > from && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const changes = ChangeSet.of(
    { from, to: oldEnd, insert: after.slice(from, newEnd) },
    before.length,
  );
  const selection = model.selection.map(changes);
  model.text = snapshot.text;
  model.styles = snapshot.styles;
  model.formatting = snapshot.formatting ?? new RichFormatting();
  model.images = snapshot.images ?? new ImageStore();
  model.localRevision++;
  model.contentToken = snapshot.contentToken;
  model.selection = EditorSelection.create(selection.ranges, selection.mainIndex);
  model.clearHistory();
  return changes;
}

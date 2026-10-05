import { ChangeSet, EditorSelection, Text } from '@codemirror/state';
import { StyleTree } from './style';
import {
  graphemes,
  MAX_BYTES,
  MAX_LINES,
  snapRange,
  TextAdapter,
  utf8Length,
  validUnicode,
} from './text';
import { literalMatches, search } from './search';
export interface Snapshot {
  text: TextAdapter;
  styles: StyleTree;
  contentToken: string;
  localRevision: number;
  preferredExportEol: 'LF' | 'CRLF';
  exportBom: boolean;
}
type Entry = {
  before: Snapshot;
  after: Snapshot;
  forward: ChangeSet;
  inverse: ChangeSet;
  beforeSelection: EditorSelection;
  afterSelection: EditorSelection;
  beforeMask: number;
  afterMask: number;
  bytes: number;
  time: number;
  group: string;
};
export class EditorModel {
  text: TextAdapter;
  styles: StyleTree;
  contentToken: string = crypto.randomUUID();
  savedContentToken: string = this.contentToken;
  localRevision = 0;
  pendingMask = 0;
  selection = EditorSelection.single(0);
  preferredExportEol: 'LF' | 'CRLF' = 'LF';
  exportBom = false;
  readonly history: Entry[] = [];
  readonly redoHistory: Entry[] = [];
  historyBytes = 0;
  readonly historyCap = 64 * 1024 * 1024;
  private compositionGroup: string | null = null;
  private compositionSequence = 0;
  constructor(text = TextAdapter.from(''), styles = StyleTree.uniform(text.length)) {
    if (styles.length !== text.length) throw new Error('STYLE_LENGTH');
    this.text = text;
    this.styles = styles;
  }
  get dirty(): boolean {
    return this.savedContentToken !== this.contentToken;
  }
  snapshot(): Snapshot {
    return {
      text: this.text,
      styles: this.styles,
      contentToken: this.contentToken,
      localRevision: this.localRevision,
      preferredExportEol: this.preferredExportEol,
      exportBom: this.exportBom,
    };
  }
  static loaded(s: Snapshot): EditorModel {
    const m = new EditorModel(s.text, s.styles);
    m.contentToken = s.contentToken;
    m.savedContentToken = s.contentToken;
    m.preferredExportEol = s.preferredExportEol;
    m.exportBom = s.exportBom;
    return m;
  }
  moveSelection(selection: EditorSelection, composing = false): void {
    this.selection = selection;
    const p = selection.main.head,
      line = this.text.text.lineAt(p);
    this.pendingMask =
      p > line.from ? this.styles.maskAt(p - 1) : p < this.text.length ? this.styles.maskAt(p) : 0;
    if (!composing) {
      this.endComposition();
      this.endGroup();
    }
  }
  endGroup(): void {
    const e = this.history.at(-1);
    if (e) e.group = 'closed';
  }
  beginComposition(): void {
    this.endComposition();
    this.endGroup();
    this.compositionGroup = `composition-${++this.compositionSequence}`;
  }
  endComposition(): void {
    if (this.compositionGroup) {
      this.endGroup();
      this.compositionGroup = null;
    }
  }
  replace(
    from: number,
    to: number,
    insert: string,
    mask = this.pendingMask,
    group = 'replace',
    now = performance.now(),
  ): void {
    const [a, b] = snapRange(this.text, from, to);
    if (!validUnicode(insert) || insert.includes('\r')) throw new Error('INVALID_TEXT');
    this.change(
      ChangeSet.of({ from: a, to: b, insert }, this.text.length),
      EditorSelection.single(a + insert.length),
      mask,
      group,
      now,
    );
  }
  change(
    changes: ChangeSet,
    selection: EditorSelection,
    mask = this.pendingMask,
    group = 'typing',
    now = performance.now(),
    insertedStyles?: StyleTree,
  ): void {
    const nextText = this.text.apply(changes);
    let nextStyles = this.styles;
    const edits: { a: number; b: number; insert: Text }[] = [];
    changes.iterChanges((a, b, _c, _d, insert) => {
      const [x, y] = snapRange(this.text, a, b);
      if (x !== a || y !== b) throw new Error('GRAPHEME_BOUNDARY');
      if (!validUnicode(insert.toString())) throw new Error('INVALID_TEXT');
      edits.push({ a, b, insert });
    });
    if (insertedStyles) {
      if (edits.length !== 1 || insertedStyles.length !== edits[0]!.insert.length)
        throw new Error('STYLE_LENGTH');
      if (insertedStyles.node?.andMask !== insertedStyles.node?.orMask)
        for (const g of graphemes(edits[0]!.insert.toString())) {
          const part = insertedStyles.slice(g.from, g.to);
          if (part.node?.andMask !== part.node?.orMask) throw new Error('GRAPHEME_STYLE_MISMATCH');
        }
    }
    for (const e of edits.reverse())
      nextStyles = nextStyles.replace(
        e.a,
        e.b,
        insertedStyles ?? StyleTree.uniform(e.insert.length, mask),
      );
    // Reconcile new graphemes only in the changed neighborhoods, including combining/ZWJ input.
    changes.iterChanges((_a, _b, c, d) => {
      const [a, b] = snapRange(nextText, Math.max(0, c - 2), Math.min(nextText.length, d + 2));
      for (const g of graphemes(nextText.slice(a, b))) {
        const start = a + g.from,
          end = a + g.to;
        if (end > start) {
          const m = nextStyles.maskAt(start);
          const piece = nextStyles.slice(start, end);
          if (piece.node?.andMask !== m || piece.node.orMask !== m)
            nextStyles = nextStyles.replace(start, end, StyleTree.uniform(end - start, m));
        }
      }
    });
    if (group === 'composition') {
      if (!this.compositionGroup) this.beginComposition();
      group = this.compositionGroup!;
    } else this.endComposition();
    this.commit(nextText, nextStyles, changes, selection, mask, group, now);
  }
  format(bit: number): void {
    this.endComposition();
    let { from, to } = this.selection.main;
    if (from === to) {
      this.pendingMask ^= bit;
      this.endGroup();
      return;
    }
    [from, to] = snapRange(this.text, from, to);
    this.commit(
      this.text,
      this.styles.applyBit(from, to, bit, 'toggle'),
      ChangeSet.empty(this.text.length),
      this.selection,
      this.pendingMask,
      'format',
      performance.now(),
    );
  }
  replaceLiteralAll(query: string, replacement: string, ignoreAsciiCase = false): void {
    if (!query) return;
    if (!validUnicode(replacement) || replacement.includes('\r')) throw new Error('INVALID_TEXT');
    const found = search(this.text.chunks(), query, ignoreAsciiCase);
    if (!found.count) return;
    if (!found.truncated) {
      this.replaceAll(found.matches, query.length, replacement);
      return;
    }
    // Two streaming passes, bounded pieces, one whole-document ChangeSet for bounded undo metadata.
    const length = this.text.length + found.count * (replacement.length - query.length),
      bytes = this.text.utf8Bytes + found.count * (utf8Length(replacement) - utf8Length(query)),
      lines =
        this.text.lines +
        found.count * ((replacement.match(/\n/g)?.length ?? 0) - (query.match(/\n/g)?.length ?? 0));
    if (bytes > MAX_BYTES || lines > MAX_LINES) throw new RangeError('FILE_TOO_LARGE');
    if (
      128 + (this.text.length + length) * 2 + this.historyBytes > this.historyCap ||
      this.history.length >= 2000
    )
      throw new Error(
        'HISTORY_LIMIT: Save/download a checkpoint, explicitly clear history or cancel.',
      );
    const chunks: string[] = [],
      pieces: string[] = [];
    let styles = new StyleTree(),
      runs: { length: number; mask: number }[] = [],
      runLength = 0,
      last = 0;
    const uniform = this.styles.node?.andMask === this.styles.node?.orMask;
    const pushText = (value: string) => {
      if (!value) return;
      pieces.push(value);
      if (pieces.length >= 4096) {
        chunks.push(pieces.join(''));
        pieces.length = 0;
      }
    };
    const pushStyle = (size: number, mask: number) => {
      while (size) {
        const take = Math.min(size, 4096 - runLength),
          previous = runs.at(-1);
        if (previous?.mask === mask) previous.length += take;
        else runs.push({ length: take, mask });
        runLength += take;
        size -= take;
        if (runLength === 4096) {
          styles = styles.concat(StyleTree.fromRuns(runs));
          runs = [];
          runLength = 0;
        }
      }
    };
    for (const from of literalMatches(this.text.chunks(), query, ignoreAsciiCase)) {
      const to = from + query.length,
        [a, b] = snapRange(this.text, from, to);
      if (a !== from || b !== to) throw new Error('GRAPHEME_BOUNDARY');
      pushText(this.text.slice(last, from));
      pushText(replacement);
      if (!uniform) {
        for (const r of this.styles.queryRuns(last, from)) pushStyle(r.to - r.from, r.mask);
        pushStyle(replacement.length, this.styles.maskAt(from));
      }
      last = to;
    }
    pushText(this.text.slice(last));
    chunks.push(pieces.join(''));
    const value = chunks.join(''),
      text = TextAdapter.from(value);
    if (uniform) styles = StyleTree.uniform(text.length, this.styles.node?.orMask ?? 0);
    else {
      for (const r of this.styles.queryRuns(last)) pushStyle(r.to - r.from, r.mask);
      if (runLength) styles = styles.concat(StyleTree.fromRuns(runs));
      // Rejoining after deletion/insertion may form new Unicode graphemes. Use their start mask.
      if (/[^\x00-\x7f]/.test(value)) {
        const rawStyles = styles;
        styles = new StyleTree();
        runs = [];
        runLength = 0;
        for (const g of graphemes(value)) pushStyle(g.to - g.from, rawStyles.maskAt(g.from));
        if (runLength) styles = styles.concat(StyleTree.fromRuns(runs));
      }
    }
    this.commit(
      text,
      styles,
      ChangeSet.of({ from: 0, to: this.text.length, insert: text.text }, this.text.length),
      EditorSelection.single(0),
      this.pendingMask,
      'replace-all',
      performance.now(),
    );
  }
  replaceAll(matches: Iterable<number>, queryLength: number, replacement: string): void {
    if (queryLength <= 0) return;
    if (!validUnicode(replacement) || replacement.includes('\r')) throw new Error('INVALID_TEXT');
    let text = this.text,
      styles = this.styles;
    const specs: { from: number; to: number; insert: string }[] = [];
    for (const from of matches) {
      const to = from + queryLength;
      const [a, b] = snapRange(this.text, from, to);
      if (a !== from || b !== to) throw new Error('GRAPHEME_BOUNDARY');
      specs.push({ from, to, insert: replacement });
    }
    if (!specs.length) return;
    const changes = ChangeSet.of(specs, this.text.length);
    text = text.apply(changes);
    if (this.styles.node?.andMask === this.styles.node?.orMask)
      styles = StyleTree.uniform(text.length, this.styles.node?.orMask ?? 0);
    else {
      for (let i = specs.length - 1; i >= 0; i--) {
        const e = specs[i]!;
        styles = styles.replace(
          e.from,
          e.to,
          StyleTree.uniform(replacement.length, this.styles.maskAt(e.from)),
        );
      }
      changes.iterChanges((_a, _b, c, d) => {
        const [a, b] = snapRange(text, Math.max(0, c - 2), Math.min(text.length, d + 2));
        for (const g of graphemes(text.slice(a, b))) {
          const start = a + g.from,
            end = a + g.to;
          if (end > start) {
            const mask = styles.maskAt(start),
              piece = styles.slice(start, end);
            if (piece.node?.andMask !== mask || piece.node.orMask !== mask)
              styles = styles.replace(start, end, StyleTree.uniform(end - start, mask));
          }
        }
      });
    }
    this.commit(
      text,
      styles,
      changes,
      EditorSelection.single(0),
      this.pendingMask,
      'replace-all',
      performance.now(),
    );
  }
  undo(): boolean {
    this.endComposition();
    const e = this.history.pop();
    if (!e) return false;
    this.redoHistory.push(e);
    this.historyBytes -= e.bytes;
    this.restore(e.before, e.beforeSelection, e.beforeMask);
    return true;
  }
  redo(): boolean {
    this.endComposition();
    const e = this.redoHistory.pop();
    if (!e) return false;
    this.history.push(e);
    this.historyBytes += e.bytes;
    this.restore(e.after, e.afterSelection, e.afterMask);
    return true;
  }
  private restore(s: Snapshot, selection: EditorSelection, mask: number): void {
    this.text = s.text;
    this.styles = s.styles;
    this.contentToken = s.contentToken;
    this.selection = selection;
    this.pendingMask = mask;
    this.localRevision++;
  }
  private commit(
    text: TextAdapter,
    styles: StyleTree,
    forward: ChangeSet,
    selection: EditorSelection,
    mask: number,
    group: string,
    time: number,
  ): void {
    const before = this.snapshot(),
      beforeSelection = this.selection,
      beforeMask = this.pendingMask,
      token = crypto.randomUUID();
    let bytes = 128;
    forward.iterChanges((a, b, _c, _d, insert) => {
      bytes += (b - a + insert.length) * 2;
    });
    if (forward.empty) bytes += Math.min(this.text.length, 4096) * 2;
    if (bytes + this.historyBytes > this.historyCap || this.history.length >= 2000)
      throw new Error(
        'HISTORY_LIMIT: Download/save a checkpoint, then explicitly clear history or cancel.',
      );
    const inverse = forward.invert(this.text.text);
    this.text = text;
    this.styles = styles;
    this.contentToken = token;
    this.localRevision++;
    this.selection = selection;
    this.pendingMask = mask;
    const after = this.snapshot();
    const last = this.history.at(-1);
    if (
      last?.group === group &&
      (group.startsWith('composition-') || (group === 'typing' && time - last.time <= 500))
    ) {
      last.forward = last.forward.compose(forward);
      last.inverse = inverse.compose(last.inverse);
      last.after = after;
      last.afterSelection = selection;
      last.afterMask = mask;
      last.time = time;
      last.bytes += bytes;
    } else
      this.history.push({
        before,
        after,
        forward,
        inverse,
        beforeSelection,
        afterSelection: selection,
        beforeMask,
        afterMask: mask,
        bytes,
        time,
        group,
      });
    this.historyBytes += bytes;
    this.redoHistory.length = 0;
  }
  clearHistory(): void {
    this.endComposition();
    this.history.length = 0;
    this.redoHistory.length = 0;
    this.historyBytes = 0;
  }
}

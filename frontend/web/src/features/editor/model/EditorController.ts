import { ChangeSet, EditorSelection, EditorState, StateEffect } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import {
  decodeStyles,
  EditorModel,
  encodeStyles,
  graphemes,
  MAX_BYTES,
  snapRange,
  StyleTree,
  TextAdapter,
} from '@ted/editor-core';
import { ReplicaBridge } from './ReplicaBridge';
import type { DraftDelta } from './DraftStore';
import { viewportStylePlugin } from './viewportStyles';
const refresh = StateEffect.define<void>();
const pasteStyles = StateEffect.define<StyleTree>();
const clipboardMime = 'application/x-ted-text-style-v1',
  clipboardCap = 32 * 1024 * 1024;
function base64(bytes: Uint8Array): string {
  let value = '';
  for (let at = 0; at < bytes.length; at += 32768)
    value += String.fromCharCode(...bytes.subarray(at, at + 32768));
  return btoa(value);
}
function unbase64(value: string, cap: number): Uint8Array {
  if (value.length % 4 || value.length > Math.ceil(cap / 3) * 4 || /[^A-Za-z0-9+/=]/.test(value))
    throw new Error('INVALID_CLIPBOARD');
  const raw = atob(value);
  if (raw.length > cap || btoa(raw) !== value) throw new Error('INVALID_CLIPBOARD');
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
function clipboardStyles(raw: string, plain: string): StyleTree | undefined {
  try {
    if (!raw || raw.length > clipboardCap) return;
    const payload = JSON.parse(raw) as Record<string, unknown>;
    if (
      !payload ||
      Object.keys(payload).sort().join(',') !== 'styles,text,version' ||
      payload.version !== 1 ||
      typeof payload.text !== 'string' ||
      typeof payload.styles !== 'string'
    )
      return;
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      unbase64(payload.text, MAX_BYTES),
    );
    if (text !== plain) return;
    const adapter = TextAdapter.from(text),
      styles = decodeStyles(unbase64(payload.styles, 8 * 1024 * 1024));
    if (styles.length !== adapter.length) return;
    if (styles.node?.andMask !== styles.node?.orMask && /[^\x00-\x7f]/.test(text))
      for (const g of graphemes(text)) {
        const part = styles.slice(g.from, g.to);
        if (part.node?.andMask !== part.node?.orMask) return;
      }
    return styles;
  } catch {
    return;
  }
}
export class EditorController {
  readonly view: EditorView;
  readonly replica: ReplicaBridge;
  matches: number[] = [];
  queryLength = 0;
  private syncing = false;
  private domComposition = false;
  constructor(
    readonly model: EditorModel,
    parent: HTMLElement,
    readonly changed: (delta?: DraftDelta) => void,
    readonly readOnly = false,
  ) {
    this.replica = new ReplicaBridge();
    this.replica.init(model);
    const styles = viewportStylePlugin(this, refresh);
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: model.text.text,
        selection: model.selection,
        extensions: [
          styles,
          EditorView.editable.of(!readOnly),
          EditorState.readOnly.of(readOnly),
          EditorView.theme({
            '&': { height: '100%', fontSize: '14px' },
            '.cm-scroller': {
              overflow: 'auto',
              fontFamily: 'Consolas, monospace',
              lineHeight: '20px',
            },
            '.cm-content': { padding: '12px' },
          }),
          keymap.of([
            { key: 'Mod-z', run: () => this.undo() },
            { key: 'Mod-Shift-z', run: () => this.redo() },
            { key: 'Mod-y', run: () => this.redo() },
            {
              key: 'Mod-b',
              run: () => {
                this.format(1);
                return true;
              },
            },
            {
              key: 'Mod-i',
              run: () => {
                this.format(2);
                return true;
              },
            },
            {
              key: 'Mod-u',
              run: () => {
                this.format(4);
                return true;
              },
            },
            ...defaultKeymap,
          ]),
          EditorView.domEventObservers({
            compositionstart: () => {
              this.domComposition = true;
              model.beginComposition();
            },
            compositionend: () => {
              this.domComposition = false;
            },
          }),
          EditorView.domEventHandlers({
            copy: (event) => this.copy(event),
            cut: (event) => this.copy(event, true),
            paste: (event, view) => this.paste(event, view),
          }),
        ],
      }),
      dispatchTransactions: (transactions) => {
        if (this.syncing) {
          this.view.update(transactions);
          return;
        }
        for (const t of transactions) {
          try {
            if (t.docChanged) {
              if (t.isUserEvent('input.type.compose.start') && !this.domComposition)
                model.beginComposition();
              const composing = this.domComposition || t.isUserEvent('input.type.compose');
              model.change(
                t.changes,
                t.newSelection,
                model.pendingMask,
                composing ? 'composition' : t.isUserEvent('input.type') ? 'typing' : 'paste',
                performance.now(),
                t.effects.find((e) => e.is(pasteStyles))?.value as StyleTree | undefined,
              );
              const ranges: { from: number; to: number; newFrom: number; newTo: number }[] = [];
              t.changes.iterChanges((a, b, c, d) =>
                ranges.push({ from: a, to: b, newFrom: c, newTo: d }),
              );
              this.replica.update(model, t.changes, ranges);
              this.matches = [];
            } else if (t.selection)
              model.moveSelection(t.newSelection, this.domComposition || this.view.composing);
            this.view.update([t]);
            if (t.docChanged) {
              const ranges: { from: number; to: number; newFrom: number; newTo: number }[] = [];
              t.changes.iterChanges((a, b, c, d) =>
                ranges.push({ from: a, to: b, newFrom: c, newTo: d }),
              );
              this.notify(t.changes, ranges);
            }
          } catch (e) {
            this.changed();
            window.dispatchEvent(
              new CustomEvent('editor-error', {
                detail: e instanceof Error ? e.message : String(e),
              }),
            );
          }
        }
      },
    });
  }
  private copy(event: ClipboardEvent, cut = false): boolean {
    const data = event.clipboardData,
      { from, to } = this.model.selection.main;
    if (!data || from === to) return false;
    const [a, b] = snapRange(this.model.text, from, to),
      text = this.model.text.slice(a, b),
      styles = this.model.styles.slice(a, b);
    try {
      data.setData('text/plain', text);
      const payload = JSON.stringify({
        version: 1,
        text: base64(new TextEncoder().encode(text)),
        styles: base64(encodeStyles(styles)),
      });
      if (payload.length <= clipboardCap) data.setData(clipboardMime, payload);
    } catch {
      return false;
    }
    event.preventDefault();
    if (cut && !this.readOnly)
      this.view.dispatch({
        changes: { from: a, to: b },
        selection: EditorSelection.single(a),
        userEvent: 'delete.cut',
      });
    return true;
  }
  private paste(event: ClipboardEvent, view: EditorView): boolean {
    if (this.readOnly) {
      event.preventDefault();
      return true;
    }
    const data = event.clipboardData;
    if (!data) return false;
    event.preventDefault();
    const text = data.getData('text/plain').replace(/\r\n?/g, '\n'),
      styles = clipboardStyles(data.getData(clipboardMime), text),
      { from, to } = view.state.selection.main,
      [a, b] = snapRange(this.model.text, from, to);
    view.dispatch({
      changes: { from: a, to: b, insert: text },
      selection: EditorSelection.single(a + text.length),
      effects: styles ? pasteStyles.of(styles) : [],
      userEvent: 'input.paste',
    });
    return true;
  }
  format(bit: number): void {
    if (this.readOnly) return;
    let { from, to } = this.model.selection.main;
    [from, to] = snapRange(this.model.text, from, to);
    this.model.format(bit);
    if (from !== to) {
      const changes = ChangeSet.empty(this.model.text.length),
        ranges = [{ from, to, newFrom: from, newTo: to }];
      this.replica.update(this.model, changes, ranges);
      this.draw();
      this.notify(changes, ranges);
    }
    this.view.focus();
  }
  undo(): boolean {
    if (this.readOnly) return false;
    const entry = this.model.history.at(-1);
    if (!entry) return false;
    this.model.undo();
    const c = entry.inverse;
    this.restore(c);
    return true;
  }
  redo(): boolean {
    if (this.readOnly) return false;
    const entry = this.model.redoHistory.at(-1);
    if (!entry) return false;
    this.model.redo();
    this.restore(entry.forward);
    return true;
  }
  private restore(changes: ChangeSet): void {
    const ranges: { from: number; to: number; newFrom: number; newTo: number }[] = [];
    changes.iterChanges((a, b, c, d) => ranges.push({ from: a, to: b, newFrom: c, newTo: d }));
    if (!ranges.length) {
      const [from, to] = snapRange(
        this.model.text,
        this.model.selection.main.from,
        this.model.selection.main.to,
      );
      ranges.push({ from, to, newFrom: from, newTo: to });
    }
    this.replica.update(this.model, changes, ranges);
    this.syncing = true;
    this.view.dispatch({ changes, selection: this.model.selection, effects: refresh.of() });
    this.syncing = false;
    this.notify(changes, ranges);
  }
  private notify(
    changes: ChangeSet,
    ranges: { from: number; to: number; newFrom: number; newTo: number }[],
  ): void {
    if (
      ranges.length > 100 ||
      ranges.some((r) => r.to - r.from + r.newTo - r.newFrom > 256 * 1024)
    ) {
      this.changed({
        changes: null,
        ranges: [],
        revision: this.model.localRevision,
        token: this.model.contentToken,
        checkpoint: true,
      });
      return;
    }
    this.changed({
      changes: changes.toJSON(),
      ranges: ranges
        .slice()
        .sort((a, b) => b.from - a.from)
        .map((r) => ({
          from: r.from,
          to: r.to,
          styles: encodeStyles(this.model.styles.slice(r.newFrom, r.newTo)),
        })),
      revision: this.model.localRevision,
      token: this.model.contentToken,
    });
  }
  draw(): void {
    this.syncing = true;
    this.view.dispatch({ effects: refresh.of() });
    this.syncing = false;
  }
  async find(query: string, ignoreCase = false): Promise<number | null> {
    const r = await this.replica.search(query, ignoreCase);
    if (r.revision !== this.model.localRevision) return null;
    this.matches = r.matches;
    this.queryLength = query.length;
    this.draw();
    if (r.matches.length)
      this.view.dispatch({
        selection: EditorSelection.single(r.matches[0]!, r.matches[0]! + query.length),
        effects: EditorView.scrollIntoView(r.matches[0]!, { y: 'center' }),
      });
    return r.count;
  }
  replaceAll(query: string, replacement: string, ignoreCase = false): void {
    if (this.readOnly || !query) return;
    const before = this.model.localRevision;
    this.model.replaceLiteralAll(query, replacement, ignoreCase);
    if (this.model.localRevision === before) return;
    const changes = this.model.history.at(-1)!.forward;
    const ranges: { from: number; to: number; newFrom: number; newTo: number }[] = [];
    changes.iterChanges((a, b, c, d) => {
      if (ranges.length <= 100) ranges.push({ from: a, to: b, newFrom: c, newTo: d });
    });
    this.replica.update(this.model, changes, ranges);
    this.matches = [];
    this.syncing = true;
    this.view.dispatch({ changes, selection: this.model.selection, effects: refresh.of() });
    this.syncing = false;
    this.notify(changes, ranges);
  }
  destroy(): void {
    this.replica.destroy();
    this.view.destroy();
  }
}

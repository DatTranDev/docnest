import { MESSAGE } from '@/lib/i18n/messages';
import {
  ChangeSet,
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
  Prec,
  type Extension,
} from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import {
  decodeStyles,
  EditorModel,
  encodeStyles,
  graphemes,
  MAX_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION_PX,
  IMAGE_PLACEHOLDER,
  type ImageAsset,
  type PlacedImage,
  snapRange,
  StyleTree,
  TextAdapter,
  type ParagraphStyle,
  type PageSettings,
  type Alignment,
  type CharacterFormat,
  type TextStylePreset,
  applySharedSnapshot,
  COLLABORATION_TEXT_LIMIT,
} from '@ted/editor-core';
import { ReplicaBridge } from './ReplicaBridge';
import { ImageUrlCache } from './ImageUrlCache';
import type { DraftDelta } from './DraftStore';
import { tableWidgetField, focusTableCell } from './tableWidgets';
import { viewportStylePlugin } from './viewportStyles';
import { CollaborationClient } from './CollaborationClient';
import { CLIPBOARD, STYLE_BITS } from './constants';
import { DEFAULT_LOCALE, type Locale } from '@/config/locale';
import { translate } from '@/lib/i18n/translate';
const refresh = StateEffect.define<void>();
const pasteStyles = StateEffect.define<StyleTree>();
const insertImage = StateEffect.define<ImageAsset>();
const clipboardMime = CLIPBOARD.mime,
  clipboardCap = CLIPBOARD.maxPayloadBytes;
function base64(bytes: Uint8Array): string {
  let value = '';
  for (let at = 0; at < bytes.length; at += CLIPBOARD.base64ChunkBytes)
    value += String.fromCharCode(...bytes.subarray(at, at + CLIPBOARD.base64ChunkBytes));
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
      styles = decodeStyles(unbase64(payload.styles, CLIPBOARD.maxStyleBytes));
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
  readonly imageUrls = new ImageUrlCache();
  matches: number[] = [];
  queryLength = 0;
  private syncing = false;
  private domComposition = false;
  private draftImageIds: string;
  collaboration: CollaborationClient | null = null;
  private sharedProjection = false;
  private collaborationBlocked = false;
  private readonly editability = new Compartment();
  private readonly language = new Compartment();
  private readonly sourceSyntax = new Compartment();
  imageAlt = translate(DEFAULT_LOCALE, MESSAGE.imageInDocument);
  private locale: Locale | null = null;
  private destroyed = false;
  private sourceMode = false;
  constructor(
    readonly model: EditorModel,
    parent: HTMLElement,
    readonly changed: (delta?: DraftDelta) => void,
    readonly readOnly = false,
    readonly selectionChanged: () => void = () => {},
  ) {
    this.draftImageIds = model.images.ids();
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
          tableWidgetField(this, refresh),
          this.language.of([]),
          this.sourceSyntax.of([]),
          this.editability.of([
            EditorView.editable.of(!readOnly),
            EditorState.readOnly.of(readOnly),
          ]),
          EditorView.theme({
            '&': { height: '100%', fontSize: '14px', containerType: 'inline-size' },
            '.cm-scroller': {
              overflow: 'auto',
              fontFamily: 'Arial, sans-serif',
              lineHeight: '1.15',
            },
            '.cm-content': { padding: '12px' },
          }),
          keymap.of([
            { key: 'Tab', run: () => this.tableTab(1) },
            { key: 'Shift-Tab', run: () => this.tableTab(-1) },
            { key: 'Enter', run: () => this.paragraphEnter() },
            { key: 'Mod-z', run: () => this.undo() },
            { key: 'Mod-Shift-z', run: () => this.redo() },
            { key: 'Mod-y', run: () => this.redo() },
            {
              key: 'Mod-\\',
              run: () => {
                this.clearFormatting();
                return true;
              },
            },
            {
              key: 'Mod-b',
              run: () => {
                this.format(STYLE_BITS.bold);
                return true;
              },
            },
            {
              key: 'Mod-i',
              run: () => {
                this.format(STYLE_BITS.italic);
                return true;
              },
            },
            {
              key: 'Mod-u',
              run: () => {
                this.format(STYLE_BITS.underline);
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
            click: (event) => {
              const anchor = (event.target as HTMLElement).closest('a.editor-link');
              if (anchor && !this.readOnly && !event.ctrlKey && !event.metaKey) {
                event.preventDefault();
                return true;
              }
              return false;
            },
            copy: (event) => (this.sourceMode ? false : this.copy(event)),
            cut: (event) => (this.sourceMode ? false : this.copy(event, true)),
            paste: (event, view) => (this.sourceMode ? false : this.paste(event, view)),
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
              if (this.readOnly) throw new Error('FORBIDDEN');
              if (this.collaborationBlocked) throw new Error('COLLABORATION_UNAVAILABLE');
              if (this.collaboration && t.newDoc.length > COLLABORATION_TEXT_LIMIT)
                throw new Error('COLLABORATION_TEXT_LIMIT');
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
                t.effects.find((e) => e.is(insertImage))?.value as ImageAsset | undefined,
              );
              const ranges: { from: number; to: number; newFrom: number; newTo: number }[] = [];
              t.changes.iterChanges((a, b, c, d) =>
                ranges.push({ from: a, to: b, newFrom: c, newTo: d }),
              );
              this.replica.update(model, t.changes, ranges);
              this.matches = [];
            } else if (t.selection) {
              model.moveSelection(t.newSelection, this.domComposition || this.view.composing);
              this.selectionChanged();
            }
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
  private focusEditor(): void {
    if (
      !focusTableCell(this.view, this.model.text.text.lineAt(this.model.selection.main.head).from)
    )
      this.view.focus();
  }
  get tableEditable(): boolean {
    return !this.readOnly && !this.collaborationBlocked;
  }
  setLanguage(locale: Locale): void {
    if (this.destroyed || this.locale === locale) return;
    this.locale = locale;
    this.imageAlt = translate(locale, MESSAGE.imageInDocument);
    this.view.dispatch({
      effects: [
        this.language.reconfigure([
          EditorView.contentAttributes.of({ 'aria-label': translate(locale, MESSAGE.textEditor) }),
          EditorState.phrases.of(
            locale === 'vi'
              ? {
                  'Control character': translate(locale, MESSAGE.controlCharacter),
                  close: translate(locale, MESSAGE.close),
                }
              : {},
          ),
        ]),
        refresh.of(),
      ],
    });
  }
  setSourceSyntax(extension: Extension): void {
    this.sourceMode = true;
    this.view.dispatch({
      effects: this.sourceSyntax.reconfigure([
        extension,
        Prec.highest(
          keymap.of([
            indentWithTab,
            ...['Mod-b', 'Mod-i', 'Mod-u', 'Mod-\\'].map((key) => ({ key, run: () => true })),
          ]),
        ),
      ]),
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
  async addImage(file: File): Promise<void> {
    if (this.readOnly) return;
    if (
      !['image/png', 'image/jpeg'].includes(file.type) ||
      file.size > MAX_IMAGE_BYTES ||
      !file.size
    )
      throw new Error(MESSAGE.useAPngOrJpegImageUpTo);
    const bitmap = await createImageBitmap(file);
    const width = bitmap.width,
      height = bitmap.height;
    bitmap.close();
    if (width > MAX_IMAGE_DIMENSION_PX || height > MAX_IMAGE_DIMENSION_PX)
      throw new Error(MESSAGE.imageDimensionsExceed4096Px);
    const asset: ImageAsset = {
      id: crypto.randomUUID(),
      mime: file.type as ImageAsset['mime'],
      width,
      height,
      data: base64(new Uint8Array(await file.arrayBuffer())),
    };
    const { from, to } = this.model.selection.main;
    this.view.dispatch({
      changes: { from, to, insert: IMAGE_PLACEHOLDER },
      selection: EditorSelection.single(from + 1),
      effects: insertImage.of(asset),
      userEvent: 'input.image',
    });
    this.focusEditor();
  }
  imageUrl(image: PlacedImage): string {
    return this.imageUrls.get(image);
  }
  format(bit: number): void {
    if (this.readOnly || this.collaborationBlocked) return;
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
    this.focusEditor();
  }
  formatCharacter(patch: CharacterFormat): void {
    if (this.readOnly || this.collaborationBlocked) return;
    const revision = this.model.localRevision;
    this.model.formatCharacter(patch);
    if (this.model.localRevision !== revision) this.formattingChanged();
    else this.selectionChanged();
  }
  applyTextStyle(style: TextStylePreset): void {
    if (this.readOnly || this.collaborationBlocked) return;
    const revision = this.model.localRevision;
    this.model.applyTextStyle(style);
    if (revision !== this.model.localRevision) this.formattingChanged(true);
    else this.selectionChanged();
    this.focusEditor();
  }
  clearFormatting(): void {
    if (this.readOnly || this.collaborationBlocked) return;
    const revision = this.model.localRevision;
    this.model.clearFormatting();
    if (revision !== this.model.localRevision) this.formattingChanged();
    else this.selectionChanged();
    this.focusEditor();
  }
  formatParagraph(patch: ParagraphStyle): void {
    if (this.readOnly || this.collaborationBlocked) return;
    this.model.formatParagraph(patch);
    this.formattingChanged(true);
  }
  setPage(page: PageSettings): void {
    if (this.readOnly || this.collaborationBlocked) return;
    this.model.setPage(page);
    this.formattingChanged(true);
  }
  insertTable(rows: number, columns: number): void {
    if (this.readOnly || this.collaborationBlocked) return;
    const before = this.model.text,
      { from, to } = this.model.selection.main;
    this.model.insertTable(rows, columns);
    const size = this.model.text.length - before.length + to - from;
    this.restore(
      ChangeSet.of({ from, to, insert: this.model.text.slice(from, from + size) }, before.length),
    );
    const id = this.model.formatting.paragraphAt(
      this.model.text.text.lineAt(this.model.selection.main.head).from,
    ).table?.id;
    queueMicrotask(() => {
      if (!this.destroyed && id)
        this.view.dom.querySelector<HTMLElement>(`td[data-table="${id}"][data-cell="0"]`)?.focus();
    });
  }
  insertPageBreak(): void {
    if (this.readOnly || this.collaborationBlocked) return;
    const before = this.model.text,
      { from, to } = this.model.selection.main;
    this.model.insertPageBreak();
    if (before === this.model.text) this.formattingChanged(true);
    else this.restore(ChangeSet.of({ from, to, insert: '\n' }, before.length));
  }
  private tableTab(direction: number): boolean {
    const line = this.model.text.text.lineAt(this.model.selection.main.head),
      p = this.model.formatting.paragraphAt(line.from);
    if (!p.table) return false;
    const n = line.number + direction;
    if (n < 1 || n > this.model.text.lines) return true;
    const next = this.model.text.text.line(n);
    this.view.dispatch({
      selection: EditorSelection.single(next.from, next.to),
      scrollIntoView: true,
    });
    return true;
  }
  private paragraphEnter(): boolean {
    if (this.readOnly || this.collaborationBlocked) return false;
    const line = this.model.text.text.lineAt(this.model.selection.main.head),
      p = this.model.formatting.paragraphAt(line.from);
    if (p.table) return this.tableTab(1);
    if (p.list && !line.length) {
      this.formatParagraph({ list: undefined, indent: 0 });
      return true;
    }
    return false;
  }
  alignParagraph(align: Alignment): void {
    if (this.readOnly || this.collaborationBlocked) return;
    this.model.alignParagraph(align);
    this.formattingChanged(true);
  }
  private formattingChanged(paragraph = false): void {
    let { from, to } = this.model.selection.main;
    if (paragraph) {
      from = this.model.text.text.lineAt(from).from;
      to = Math.min(
        this.model.text.length,
        this.model.text.text.lineAt(to > from ? to - 1 : to).to + 1,
      );
    }
    const changes = ChangeSet.empty(this.model.text.length);
    const ranges = [{ from, to, newFrom: from, newTo: to }];
    this.replica.update(this.model, changes, ranges);
    this.draw();
    this.notify(changes, ranges);
    this.focusEditor();
    this.selectionChanged();
  }
  undo(): boolean {
    if (this.readOnly || this.collaborationBlocked) return false;
    if (this.collaboration) {
      this.collaboration.shared.undoManager.undo();
      this.projectShared();
      return true;
    }
    const entry = this.model.history.at(-1);
    if (!entry) return false;
    this.model.undo();
    const c = entry.inverse;
    this.restore(c);
    this.focusEditor();
    return true;
  }
  redo(): boolean {
    if (this.readOnly || this.collaborationBlocked) return false;
    if (this.collaboration) {
      this.collaboration.shared.undoManager.redo();
      this.projectShared();
      return true;
    }
    const entry = this.model.redoHistory.at(-1);
    if (!entry) return false;
    this.model.redo();
    this.restore(entry.forward);
    this.focusEditor();
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
    if (this.collaboration && !this.sharedProjection) {
      this.collaboration.shared.publish(this.model.snapshot(), changes, ranges);
      this.model.clearHistory();
    }
    const ids = this.model.images.ids();
    const images = ids === this.draftImageIds ? undefined : this.model.images.toJSON();
    this.draftImageIds = ids;
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
      formatting: this.model.formatting.toJSON(),
      images,
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
    if (this.readOnly || this.collaborationBlocked || !query) return;
    if (this.collaboration) {
      const trial = EditorModel.loaded(this.model.snapshot());
      trial.replaceLiteralAll(query, replacement, ignoreCase);
      if (trial.text.length > COLLABORATION_TEXT_LIMIT) throw new Error('COLLABORATION_TEXT_LIMIT');
    }
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
    this.destroyed = true;
    this.collaboration?.destroy();
    this.replica.destroy();
    this.view.destroy();
    this.imageUrls.destroy();
  }

  async startCollaboration(
    documentId: string,
    userId: string,
    headRevision: number,
  ): Promise<void> {
    if (this.readOnly || this.collaboration) return;
    this.blockCollaboration(true);
    const connection = new CollaborationClient(
      documentId,
      userId,
      headRevision,
      () => this.projectShared(),
      () => this.selectionChanged(),
      (error) => {
        this.blockCollaboration(true);
        window.dispatchEvent(
          new CustomEvent('editor-error', {
            detail:
              error instanceof Error
                ? error.message
                : MESSAGE.collaborationWasInterruptedYourDraftIsRetained,
          }),
        );
      },
    );
    this.collaboration = connection;
    try {
      await connection.start(this.model.snapshot());
      this.blockCollaboration(false);
    } catch (error) {
      connection.destroy();
      this.collaboration = null;
      this.blockCollaboration(false);
      throw error;
    }
  }

  async saveCollaboration() {
    if (!this.collaboration || this.collaborationBlocked)
      throw new Error('COLLABORATION_UNAVAILABLE');
    this.blockCollaboration(true);
    try {
      return await this.collaboration.save(
        () => {
          this.projectShared();
          return this.model.snapshot();
        },
        (value) => this.replica.snapshotFor(value),
      );
    } finally {
      this.blockCollaboration(!this.collaboration?.available);
    }
  }

  private blockCollaboration(blocked: boolean): void {
    this.collaborationBlocked = blocked;
    if (this.destroyed) return;
    this.view.dispatch({
      effects: [
        refresh.of(),
        this.editability.reconfigure([
          EditorView.editable.of(!blocked && !this.readOnly),
          EditorState.readOnly.of(blocked || this.readOnly),
        ]),
      ],
    });
  }

  private projectShared(): void {
    if (!this.collaboration || this.destroyed) return;
    const snapshot = this.collaboration.shared.snapshot(this.model.snapshot());
    const changes = applySharedSnapshot(this.model, snapshot);
    this.sharedProjection = true;
    try {
      const ranges = [{ from: 0, to: changes.length, newFrom: 0, newTo: this.model.text.length }];
      this.replica.update(this.model, changes, ranges);
      this.syncing = true;
      try {
        this.view.dispatch({ changes, selection: this.model.selection, effects: refresh.of() });
      } finally {
        this.syncing = false;
      }
      this.notify(changes, ranges);
    } finally {
      this.sharedProjection = false;
    }
  }
}

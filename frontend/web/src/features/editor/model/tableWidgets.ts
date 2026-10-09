import { EditorSelection, StateField, type StateEffectType } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { listOrdinal, snapRange, type EditorModel, type ParagraphFormat } from '@ted/editor-core';
import type { ImageUrlCache } from './ImageUrlCache';

interface TableSource {
  model: EditorModel;
  imageUrls: ImageUrlCache;
  imageAlt: string;
  readOnly: boolean;
  tableEditable: boolean;
  undo(): boolean;
  redo(): boolean;
  format(bit: number): void;
}
type EditableCell = HTMLTableCellElement & { restoreEditorSelection?: () => void };
export function focusTableCell(view: EditorView, from: number): boolean {
  const cell = view.dom.querySelector<EditableCell>(`td[data-from="${from}"]`);
  if (!cell?.restoreEditorSelection) return false;
  cell.restoreEditorSelection();
  return true;
}

/** Cells reference canonical LF paragraphs; widget DOM is never authoritative storage. */
class TableWidget extends WidgetType {
  readonly token: string;
  readonly editable: boolean;
  readonly alt: string;
  constructor(
    readonly source: TableSource,
    readonly id: string,
    readonly from: number,
    readonly to: number,
  ) {
    super();
    this.token = source.model.contentToken;
    this.editable = source.tableEditable;
    this.alt = source.imageAlt;
  }
  eq(other: TableWidget) {
    return (
      this.id === other.id &&
      this.token === other.token &&
      this.editable === other.editable &&
      this.alt === other.alt &&
      this.from === other.from &&
      this.to === other.to
    );
  }
  private cells(): readonly ParagraphFormat[] {
    return this.source.model.formatting.paragraphs.filter(
      (p) => p.table?.id === this.id && p.from >= this.from && p.from <= this.to,
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'editor-table';
    wrapper.contentEditable = 'false';
    wrapper.dataset.pageBreak = String(this.cells()[0]?.pageBreak ?? false);
    const table = document.createElement('table');
    table.setAttribute('aria-label', this.id);
    const body = document.createElement('tbody');
    table.append(body);
    wrapper.append(table);
    this.render(body, view);
    return wrapper;
  }
  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const body = dom.querySelector('tbody');
    if (!body) return false;
    dom.dataset.pageBreak = String(this.cells()[0]?.pageBreak ?? false);
    this.render(body, view);
    return true;
  }
  private render(body: HTMLTableSectionElement, view: EditorView): void {
    const cells = this.cells(),
      columns = cells[0]?.table?.columns ?? 1;
    const rowCount = Math.ceil(cells.length / columns);
    while (body.rows.length > rowCount) body.deleteRow(body.rows.length - 1);
    for (let index = 0; index < cells.length; index++) {
      const rowNumber = Math.floor(index / columns),
        column = index % columns;
      const row = body.rows[rowNumber] ?? body.insertRow();
      while (row.cells.length < columns) row.insertCell();
      const cell = row.cells[column]! as EditableCell;
      cell.tabIndex = 0;
      const p = cells[index]!;
      cell.dataset.cell = String(index);
      cell.dataset.table = this.id;
      cell.dataset.from = String(p.from);
      cell.restoreEditorSelection = () => this.restoreFocus(cell);
      cell.contentEditable = String(this.source.tableEditable);
      cell.setAttribute('role', 'textbox');
      cell.setAttribute('aria-multiline', 'false');
      cell.style.textAlign = p.align;
      cell.style.lineHeight = String(p.lineSpacing ?? 1.15);
      cell.style.paddingLeft = `${8 + (p.indent ?? 0) * 24}px`;
      cell.style.paddingTop = `${8 + ((p.spaceBefore ?? 0) * 4) / 3}px`;
      cell.style.paddingBottom = `${8 + ((p.spaceAfter ?? 0) * 4) / 3}px`;
      if (p.list)
        cell.dataset.marker =
          p.list === 'bullet'
            ? '•'
            : `${listOrdinal(this.source.model.formatting.paragraphs, this.source.model.text, p.from)}.`;
      else delete cell.dataset.marker;
      const line = this.source.model.text.text.lineAt(p.from);
      // Keep the input node/caret while its own transaction updates the view.
      if (cell.dataset.input !== 'true' || this.plainText(cell) !== line.text)
        this.content(cell, p.from, line.to);
      cell.onfocus = () =>
        queueMicrotask(() => {
          if (cell.isConnected) this.selection(cell, view, true);
        });
      cell.onkeyup = () => this.selection(cell, view);
      cell.onmouseup = () => this.selection(cell, view);
      cell.oninput = () => this.input(cell, view);
      cell.onkeydown = (event) => this.key(event, cell, view);
      cell.onclick = (event) => {
        if (
          !this.source.readOnly &&
          !event.ctrlKey &&
          !event.metaKey &&
          (event.target as HTMLElement).closest('a.editor-link')
        )
          event.preventDefault();
      };
      cell.onpaste = (event) => {
        event.preventDefault();
        if (!this.source.tableEditable) return;
        const text = event.clipboardData?.getData('text/plain');
        if (text === undefined) return;
        this.selection(cell, view);
        const selection = view.state.selection.main;
        view.dispatch({
          changes: {
            from: selection.from,
            to: selection.to,
            insert: text.replace(/\r\n?|\n/g, ' '),
          },
          selection: EditorSelection.single(selection.from + text.replace(/\r\n?|\n/g, ' ').length),
          userEvent: 'input.paste',
        });
      };
    }
    const last = body.rows[rowCount - 1];
    if (last)
      for (let n = cells.length % columns || columns; n < columns; n++) {
        const cell = last.cells[n]!;
        cell.textContent = '';
        cell.contentEditable = 'false';
      }
  }
  private content(cell: HTMLElement, from: number, to: number): void {
    const { model, imageUrls } = this.source;
    cell.replaceChildren();
    const points = new Set([from, to]);
    for (const run of model.styles.queryRuns(from, to)) {
      points.add(run.from);
      points.add(run.to);
    }
    for (const run of model.formatting.query(from, to)) {
      points.add(run.from);
      points.add(run.to);
    }
    for (const image of model.images.query(from, to)) {
      points.add(image.from);
      points.add(image.from + 1);
    }
    const sorted = [...points].sort((a, b) => a - b);
    for (let n = 0; n + 1 < sorted.length; n++) {
      const start = sorted[n]!,
        end = sorted[n + 1]!,
        image = model.images.at(start);
      if (image) {
        const node = document.createElement('img');
        node.src = imageUrls.get(image);
        node.loading = 'lazy';
        node.decoding = 'async';
        node.alt = this.source.imageAlt;
        node.width = image.width;
        node.height = image.height;
        cell.append(node);
        continue;
      }
      const format = model.formatting.at(start),
        mask = model.styles.maskAt(start);
      const span = document.createElement('span');
      span.textContent = model.text.slice(start, end);
      span.style.fontFamily = format.font ?? '';
      span.style.fontSize = format.size ? `${format.size}pt` : '';
      span.style.color = format.color ?? '';
      span.style.backgroundColor = format.background ?? '';
      span.style.fontWeight = mask & 1 ? 'bold' : '';
      span.style.fontStyle = mask & 2 ? 'italic' : '';
      span.style.textDecoration = [mask & 4 ? 'underline' : '', format.strike ? 'line-through' : '']
        .filter(Boolean)
        .join(' ');
      if (format.script && format.script !== 'normal') {
        span.style.verticalAlign = format.script;
        span.style.fontSize = format.size ? `${format.size * 0.75}pt` : '0.75em';
      }
      if (format.link) {
        const anchor = document.createElement('a');
        anchor.href = format.link;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.className = 'editor-link';
        anchor.append(span);
        cell.append(anchor);
      } else cell.append(span);
    }
    if (from === to) cell.append(document.createElement('br'));
  }
  private position(cell: HTMLElement): { from: number; to: number } | undefined {
    const p = this.cells()[Number(cell.dataset.cell)];
    return p ? this.source.model.text.text.lineAt(p.from) : undefined;
  }
  private selection(cell: HTMLElement, view: EditorView, selectAll = false): void {
    const line = this.position(cell);
    if (!line) return;
    if (selectAll && cell.textContent === '\u00a0') {
      const range = document.createRange();
      range.selectNodeContents(cell);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    const selection = window.getSelection();
    if (!selection || !cell.contains(selection.anchorNode) || !cell.contains(selection.focusNode))
      return;
    const offset = (node: Node | null, at: number) => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      range.setEnd(node!, at);
      return Math.min(line.to - line.from, this.plainText(range.cloneContents()).length);
    };
    const anchor = line.from + offset(selection.anchorNode, selection.anchorOffset);
    const head = line.from + offset(selection.focusNode, selection.focusOffset);
    if (view.state.selection.main.anchor === anchor && view.state.selection.main.head === head)
      return;
    const range = selection.getRangeAt(0).cloneRange();
    view.dispatch({ selection: EditorSelection.single(anchor, head) });
    if (cell.isConnected) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  private input(cell: HTMLElement, view: EditorView): void {
    if (!this.source.tableEditable) return;
    const line = this.position(cell);
    if (!line) return;
    const text = this.plainText(cell).replace(/\r\n?|\n/g, ' ');
    const selection = window.getSelection();
    let caret = text.length;
    if (selection && cell.contains(selection.focusNode)) {
      const range = document.createRange();
      range.selectNodeContents(cell);
      range.setEnd(selection.focusNode!, selection.focusOffset);
      caret = this.plainText(range.cloneContents()).length;
    }
    const old = this.source.model.text.slice(line.from, line.to);
    const domRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    let start = 0,
      endOld = old.length,
      endNew = text.length;
    while (start < endOld && start < endNew && old[start] === text[start]) start++;
    while (endOld > start && endNew > start && old[endOld - 1] === text[endNew - 1]) {
      endOld--;
      endNew--;
    }
    // Let core grapheme validation reject unsafe edits, then redraw canonical data.
    const [a, b] = snapRange(this.source.model.text, line.from + start, line.from + endOld);
    cell.dataset.input = 'true';
    view.dispatch({
      changes: {
        from: a,
        to: b,
        insert: text.slice(a - line.from, endNew + b - line.from - endOld),
      },
      selection: EditorSelection.single(line.from + Math.min(caret, text.length)),
      userEvent: 'input.type',
    });
    delete cell.dataset.input;
    const next = this.position(cell);
    if (next && this.source.model.text.slice(next.from, next.to) !== text)
      this.content(cell, next.from, next.to);
    else if (domRange && cell.isConnected && selection) {
      selection.removeAllRanges();
      selection.addRange(domRange);
    }
  }
  private plainText(node: Node): string {
    if (node instanceof HTMLImageElement) return '\ufffc';
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    return Array.from(node.childNodes)
      .map((child) => this.plainText(child))
      .join('');
  }
  private key(event: KeyboardEvent, cell: HTMLElement, view: EditorView): void {
    const bit = ({ b: 1, i: 2, u: 4 } as Record<string, number>)[event.key.toLowerCase()];
    if ((event.ctrlKey || event.metaKey) && bit) {
      event.preventDefault();
      this.selection(cell, view);
      this.source.format(bit);
      if (cell.isConnected) this.restoreFocus(cell);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.source.redo();
      else this.source.undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      const range = document.createRange();
      range.selectNodeContents(cell);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      this.selection(cell, view);
      return;
    }
    if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault();
      const index = Number(cell.dataset.cell) + (event.key === 'Tab' && event.shiftKey ? -1 : 1);
      const next = cell.closest('table')?.querySelector<HTMLElement>(`td[data-cell="${index}"]`);
      if (next) next.focus();
      else {
        const line = this.position(cell);
        if (line) {
          const target = Math.min(this.source.model.text.length, line.to + 1);
          view.dispatch({ selection: EditorSelection.single(target), scrollIntoView: true });
          view.focus();
        }
      }
    }
  }
  private restoreFocus(cell: HTMLElement): void {
    const line = this.position(cell);
    if (!line) return;
    const selection = this.source.model.selection.main;
    const point = (offset: number): { node: Node; offset: number } => {
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_ALL);
      let node;
      while ((node = walker.nextNode())) {
        if (node.nodeType === Node.TEXT_NODE) {
          const length = node.textContent?.length ?? 0;
          if (offset <= length) return { node, offset };
          offset -= length;
        } else if (node instanceof HTMLImageElement) {
          if (offset <= 1) {
            const parent = node.parentNode!,
              index = Array.from(parent.childNodes).indexOf(node);
            return { node: parent, offset: index + (offset === 1 ? 1 : 0) };
          }
          offset--;
        }
      }
      return { node: cell, offset: cell.childNodes.length };
    };
    const from = point(Math.max(0, Math.min(line.to - line.from, selection.from - line.from))),
      to = point(Math.max(0, Math.min(line.to - line.from, selection.to - line.from)));
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    cell.focus({ preventScroll: true });
    const dom = window.getSelection();
    dom?.removeAllRanges();
    dom?.addRange(range);
  }
  ignoreEvent(): boolean {
    return true;
  }
}

export function tableWidgetField(source: TableSource, refresh: StateEffectType<void>) {
  const build = () => {
    const ranges = [];
    const paragraphs = source.model.formatting.paragraphs;
    for (let index = 0; index < paragraphs.length;) {
      const first = paragraphs[index++]!;
      if (!first.table) continue;
      let last = first;
      while (
        index < paragraphs.length &&
        paragraphs[index]!.table?.id === first.table.id &&
        !paragraphs[index]!.pageBreak &&
        source.model.text.text.lineAt(paragraphs[index]!.from).number ===
          source.model.text.text.lineAt(last.from).number + 1
      )
        last = paragraphs[index++]!;
      const end = source.model.text.text.lineAt(last.from).to;
      ranges.push(
        Decoration.replace({
          widget: new TableWidget(source, first.table.id, first.from, end),
          block: true,
        }).range(first.from, end),
      );
    }
    return Decoration.set(ranges, true);
  };
  return StateField.define({
    create: build,
    update: (value, transaction) =>
      transaction.docChanged || transaction.effects.some((e) => e.is(refresh)) ? build() : value,
    provide: (field) => EditorView.decorations.from(field),
  });
}

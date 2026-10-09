import type { TextAdapter } from './text';

export interface TableCell {
  id: string;
  columns: number;
}
export interface ParagraphStyle {
  list?: 'bullet' | 'number';
  indent?: number;
  lineSpacing?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  pageBreak?: boolean;
  table?: TableCell | null;
}
export interface PageSettings {
  header?: string;
  footer?: string;
  pageNumbers?: boolean;
}
export const TABLE_LIMITS = Object.freeze({ cells: 1000, textUnits: 20000 });
export function validateTables(
  paragraphs: readonly ({ from: number } & ParagraphStyle)[],
  text: TextAdapter,
): void {
  let id: string | undefined,
    columns = 0,
    count = 0,
    start = 0,
    previousLine = -2;
  for (const p of paragraphs) {
    if (!p.table) {
      id = undefined;
      continue;
    }
    const line = text.text.lineAt(p.from);
    if (p.table.id !== id || line.number !== previousLine + 1) {
      id = p.table.id;
      columns = p.table.columns;
      count = 0;
      start = p.from;
    }
    if (
      columns !== p.table.columns ||
      ++count > TABLE_LIMITS.cells ||
      line.to - start > TABLE_LIMITS.textUnits
    )
      throw new Error('TABLE_LIMIT');
    previousLine = line.number;
  }
}
export const PARAGRAPH_KEYS = [
  'list',
  'indent',
  'lineSpacing',
  'spaceBefore',
  'spaceAfter',
  'pageBreak',
  'table',
] as const;
export const PAGE_KEYS = ['header', 'footer', 'pageNumbers'] as const;
export function safeLink(value: string): boolean {
  if (value.length > 2048 || /[\s\u0000-\u001f\u007f<>"\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.href.length <= 2048 &&
      ['https:', 'http:', 'mailto:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !!(url.hostname || url.pathname)
    );
  } catch {
    return false;
  }
}
export function validParagraph(value: ParagraphStyle): boolean {
  return (
    (value.list === undefined || ['bullet', 'number'].includes(value.list)) &&
    (value.indent === undefined ||
      (Number.isInteger(value.indent) && value.indent >= 0 && value.indent <= 8)) &&
    (value.lineSpacing === undefined || [1, 1.15, 1.5, 2, 2.5, 3].includes(value.lineSpacing)) &&
    ['spaceBefore', 'spaceAfter'].every((key) => {
      const n = value[key as 'spaceBefore'];
      return n === undefined || (Number.isInteger(n) && n >= 0 && n <= 72);
    }) &&
    (value.pageBreak === undefined || typeof value.pageBreak === 'boolean') &&
    (value.table === undefined ||
      value.table === null ||
      (typeof value.table === 'object' &&
        !Array.isArray(value.table) &&
        Object.keys(value.table).sort().join(',') === 'columns,id' &&
        typeof value.table.id === 'string' &&
        /^[a-zA-Z0-9-]{1,64}$/.test(value.table.id) &&
        Number.isInteger(value.table.columns) &&
        value.table.columns >= 1 &&
        value.table.columns <= 8))
  );
}
export function cleanParagraph(value: ParagraphStyle): ParagraphStyle {
  return {
    ...(value.list ? { list: value.list } : {}),
    ...(value.indent ? { indent: value.indent } : {}),
    ...(value.lineSpacing && value.lineSpacing !== 1.15 ? { lineSpacing: value.lineSpacing } : {}),
    ...(value.spaceBefore ? { spaceBefore: value.spaceBefore } : {}),
    ...(value.spaceAfter ? { spaceAfter: value.spaceAfter } : {}),
    ...(value.pageBreak ? { pageBreak: true } : {}),
    ...(value.table ? { table: { ...value.table } } : {}),
  };
}
export function parsePage(value: unknown): PageSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_FORMATTING');
  const page = value as PageSettings;
  if (
    Object.keys(page).some((key) => !PAGE_KEYS.includes(key as (typeof PAGE_KEYS)[number])) ||
    ['header', 'footer'].some((key) => {
      const text = page[key as 'header'];
      return (
        text !== undefined &&
        (typeof text !== 'string' ||
          text.length > 500 ||
          /[\u0000-\u001f\u007f]/.test(text) ||
          /[\ud800-\udfff]/.test(text.replace(/[\ud800-\udbff][\udc00-\udfff]/g, '')))
      );
    }) ||
    (page.pageNumbers !== undefined && typeof page.pageNumbers !== 'boolean')
  )
    throw new Error('INVALID_FORMATTING');
  return {
    ...(page.header ? { header: page.header } : {}),
    ...(page.footer ? { footer: page.footer } : {}),
    ...(page.pageNumbers ? { pageNumbers: true } : {}),
  };
}
/** Sparse paragraph context, scanned only over formatted records, never the document text. */
type NumberedParagraph = { from: number; align: string } & ParagraphStyle;
const ordinalCache = new WeakMap<
  readonly NumberedParagraph[],
  { text: TextAdapter; ordinals: Map<number, number> }
>();
export function listOrdinal(
  paragraphs: readonly NumberedParagraph[],
  text: TextAdapter,
  from: number,
): number {
  let cache = ordinalCache.get(paragraphs);
  if (!cache || cache.text !== text) {
    const ordinals = new Map<number, number>();
    let ordinal = 0,
      previousLine = -2,
      previousIndent = -1;
    for (const p of paragraphs) {
      const line = text.text.lineAt(p.from).number;
      if (p.list === 'number') {
        ordinal = line === previousLine + 1 && (p.indent ?? 0) === previousIndent ? ordinal + 1 : 1;
        ordinals.set(p.from, ordinal);
        previousLine = line;
        previousIndent = p.indent ?? 0;
      } else {
        ordinal = 0;
        previousLine = -2;
      }
    }
    cache = { text, ordinals };
    ordinalCache.set(paragraphs, cache);
  }
  return cache.ordinals.get(from) ?? 1;
}

import type { ChangeSet } from '@codemirror/state';
import {
  cleanParagraph,
  validateTables,
  validParagraph,
  parsePage,
  PARAGRAPH_KEYS,
  safeLink,
  type ParagraphStyle,
  type PageSettings,
} from './structure';
import { snapRange, type TextAdapter } from './text';

export const FONT_FAMILIES = [
  'Arial',
  'Times New Roman',
  'Georgia',
  'Verdana',
  'Courier New',
] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];
export type Alignment = 'left' | 'center' | 'right' | 'justify';
export const TEXT_STYLE_PRESETS = {
  normal: { font: 'Arial', size: 11, color: '#202124', mask: 0 },
  title: { font: 'Arial', size: 26, color: '#202124', mask: 0 },
  subtitle: { font: 'Arial', size: 15, color: '#666666', mask: 0 },
  heading1: { font: 'Arial', size: 20, color: '#202124', mask: 1 },
  heading2: { font: 'Arial', size: 16, color: '#202124', mask: 1 },
  heading3: { font: 'Arial', size: 14, color: '#202124', mask: 1 },
  heading4: { font: 'Arial', size: 12, color: '#202124', mask: 1 },
  heading5: { font: 'Arial', size: 11, color: '#202124', mask: 1 },
  heading6: { font: 'Arial', size: 11, color: '#202124', mask: 2 },
} as const;
export type TextStylePreset = keyof typeof TEXT_STYLE_PRESETS;
export interface CharacterFormat {
  link?: string | null;
  font?: FontFamily;
  size?: number;
  color?: string;
  background?: string | null;
  strike?: boolean;
  script?: 'normal' | 'super' | 'sub';
}
export interface FormatRun extends CharacterFormat {
  from: number;
  to: number;
}
export interface ParagraphFormat extends ParagraphStyle {
  from: number;
  align: Alignment;
}
export interface FormattingData {
  page?: PageSettings;
  runs: FormatRun[];
  paragraphs: ParagraphFormat[];
}
const MAX_RUNS = 100000;
const defaults: Readonly<CharacterFormat> = Object.freeze({});

export function validCharacterFormat(value: CharacterFormat): boolean {
  return (
    (value.link === undefined ||
      value.link === null ||
      (typeof value.link === 'string' && safeLink(value.link))) &&
    (value.font === undefined || FONT_FAMILIES.includes(value.font)) &&
    (value.size === undefined ||
      (Number.isInteger(value.size) && value.size >= 8 && value.size <= 72)) &&
    (value.color === undefined || /^#[0-9a-fA-F]{6}$/.test(value.color)) &&
    (value.background === undefined ||
      value.background === null ||
      /^#[0-9a-fA-F]{6}$/.test(value.background)) &&
    (value.strike === undefined || typeof value.strike === 'boolean') &&
    (value.script === undefined || ['normal', 'super', 'sub'].includes(value.script))
  );
}
function same(a: CharacterFormat, b: CharacterFormat): boolean {
  return (
    a.link === b.link &&
    a.font === b.font &&
    a.size === b.size &&
    a.color === b.color &&
    a.background === b.background &&
    a.strike === b.strike &&
    a.script === b.script
  );
}
function clean(value: CharacterFormat): CharacterFormat {
  return {
    ...(value.link ? { link: new URL(value.link).href } : {}),
    ...(value.font ? { font: value.font } : {}),
    ...(value.size ? { size: value.size } : {}),
    ...(value.color ? { color: value.color.toLowerCase() } : {}),
    ...(value.background ? { background: value.background.toLowerCase() } : {}),
    ...(value.strike ? { strike: true } : {}),
    ...(value.script && value.script !== 'normal' ? { script: value.script } : {}),
  };
}
export class RichFormatting {
  readonly runs: readonly FormatRun[];
  readonly paragraphs: readonly ParagraphFormat[];
  constructor(
    runs: readonly FormatRun[] = [],
    paragraphs: readonly ParagraphFormat[] = [],
    readonly page: Readonly<PageSettings> = {},
  ) {
    this.runs = runs;
    this.paragraphs = paragraphs;
  }
  get empty(): boolean {
    return !this.runs.length && !this.paragraphs.length && !Object.keys(this.page).length;
  }
  get extended(): boolean {
    return this.runs.some((run) => Boolean(run.background || run.strike || run.script));
  }
  get structured(): boolean {
    return (
      !!Object.keys(this.page).length ||
      this.runs.some((r) => !!r.link) ||
      this.paragraphs.some((p) => PARAGRAPH_KEYS.some((k) => p[k] !== undefined))
    );
  }
  paragraphAt(lineFrom: number): Readonly<ParagraphFormat> {
    let low = 0,
      high = this.paragraphs.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.paragraphs[mid]!.from < lineFrom) low = mid + 1;
      else high = mid;
    }
    return this.paragraphs[low]?.from === lineFrom
      ? this.paragraphs[low]!
      : { from: lineFrom, align: 'left' };
  }
  withPage(page: PageSettings): RichFormatting {
    return new RichFormatting(this.runs, this.paragraphs, parsePage(page));
  }
  paragraph(
    text: TextAdapter,
    from: number,
    to: number,
    patch: ParagraphStyle & { align?: Alignment; list?: 'bullet' | 'number' | undefined },
  ): RichFormatting {
    if (
      !validParagraph(patch) ||
      (patch.align !== undefined && !['left', 'center', 'right', 'justify'].includes(patch.align))
    )
      throw new Error('INVALID_FORMAT');
    const first = text.text.lineAt(from).number,
      last = text.text.lineAt(to > from ? to - 1 : to).number;
    if (last - first + 1 > MAX_RUNS) throw new Error('FORMAT_LIMIT');
    const updates = new Map(this.paragraphs.map((p) => [p.from, p]));
    for (let n = first; n <= last; n++) {
      const start = text.text.line(n).from,
        old = this.paragraphAt(start),
        next = {
          from: start,
          align: patch.align ?? old.align,
          ...cleanParagraph({ ...old, ...patch }),
        };
      if (next.align === 'left' && Object.keys(next).length === 2) updates.delete(start);
      else updates.set(start, next);
    }
    if (updates.size > MAX_RUNS) throw new Error('FORMAT_LIMIT');
    validateTables(
      [...updates.values()].sort((a, b) => a.from - b.from),
      text,
    );
    return new RichFormatting(
      this.runs,
      [...updates.values()].sort((a, b) => a.from - b.from),
      this.page,
    );
  }
  at(pos: number): Readonly<CharacterFormat> {
    let lo = 0,
      hi = this.runs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.runs[mid]!.to <= pos) lo = mid + 1;
      else hi = mid;
    }
    const run = this.runs[lo];
    return run && run.from <= pos ? run : defaults;
  }
  alignAt(lineFrom: number): Alignment {
    let low = 0,
      high = this.paragraphs.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.paragraphs[mid]!.from < lineFrom) low = mid + 1;
      else high = mid;
    }
    return this.paragraphs[low]?.from === lineFrom ? this.paragraphs[low]!.align : 'left';
  }
  query(from: number, to: number): FormatRun[] {
    let low = 0,
      high = this.runs.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.runs[mid]!.to <= from) low = mid + 1;
      else high = mid;
    }
    const result: FormatRun[] = [];
    for (let index = low; index < this.runs.length && this.runs[index]!.from < to; index++) {
      const run = this.runs[index]!;
      result.push({ ...run, from: Math.max(from, run.from), to: Math.min(to, run.to) });
    }
    return result;
  }
  clear(from: number, to: number): RichFormatting {
    if (from >= to) return this;
    const runs: FormatRun[] = [];
    for (const run of this.runs) {
      if (run.to <= from || run.from >= to) runs.push({ ...run });
      else {
        if (run.from < from) runs.push({ ...run, to: from });
        if (run.to > to) runs.push({ ...run, from: to });
      }
    }
    return new RichFormatting(normalize(runs), this.paragraphs, this.page);
  }
  apply(from: number, to: number, patch: CharacterFormat): RichFormatting {
    if (from >= to || !validCharacterFormat(patch)) throw new Error('INVALID_FORMAT');
    const boundaries = new Set([from, to]);
    for (const r of this.runs) {
      if (r.to <= from || r.from >= to) continue;
      boundaries.add(Math.max(from, r.from));
      boundaries.add(Math.min(to, r.to));
    }
    const points = [...boundaries].sort((a, b) => a - b);
    const next: FormatRun[] = this.runs
      .filter((r) => r.to <= from || r.from >= to)
      .map((r) => ({ ...r }));
    for (const r of this.runs) {
      if (r.from < from && r.to > from) next.push({ ...r, to: from });
      if (r.from < to && r.to > to) next.push({ ...r, from: to });
    }
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!,
        b = points[i + 1]!;
      const value = clean({ ...this.at(a), ...patch });
      if (Object.keys(value).length) next.push({ from: a, to: b, ...value });
    }
    return new RichFormatting(normalize(next), this.paragraphs, this.page);
  }
  align(text: TextAdapter, from: number, to: number, align: Alignment): RichFormatting {
    return this.paragraph(text, from, to, { align });
  }
  map(
    changes: ChangeSet,
    nextText: TextAdapter,
    inserted: CharacterFormat | ((from: number) => CharacterFormat),
    oldText?: TextAdapter,
  ): RichFormatting {
    if (this.empty && typeof inserted !== 'function' && !Object.keys(inserted).length) return this;
    const runs: FormatRun[] = [];
    let runIndex = 0;
    const copy = (from: number, to: number, shift: number) => {
      while (runIndex < this.runs.length && this.runs[runIndex]!.to <= from) runIndex++;
      for (let index = runIndex; index < this.runs.length && this.runs[index]!.from < to; index++) {
        const run = this.runs[index]!;
        runs.push({
          ...run,
          from: Math.max(from, run.from) + shift,
          to: Math.min(to, run.to) + shift,
        });
      }
    };
    let cursor = 0,
      shift = 0;
    changes.iterChanges((from, to, newFrom, newTo) => {
      copy(cursor, from, shift);
      const value = clean(typeof inserted === 'function' ? inserted(from) : inserted);
      if (newTo > newFrom && Object.keys(value).length)
        runs.push({ from: newFrom, to: newTo, ...value });
      cursor = to;
      shift = newTo - to;
    });
    copy(cursor, changes.length, shift);
    const paragraphs = new Map<number, ParagraphFormat>();
    for (const p of this.paragraphs) {
      const mapped = Math.min(nextText.length, changes.mapPos(p.from, 1));
      const from = nextText.text.lineAt(mapped).from;
      if (!paragraphs.has(from)) paragraphs.set(from, { ...p, from });
    }
    if (oldText && this.paragraphs.length)
      changes.iterChanges((from, _to, newFrom, _newTo, text) => {
        const old = this.paragraphAt(oldText.text.lineAt(from).from);
        if (Object.keys(old).length === 2 && old.align === 'left') return;
        const first = nextText.text.lineAt(newFrom).from;
        if (!paragraphs.has(first)) {
          const inherited = { ...old, from: first };
          if (changes.mapPos(old.from, 1) > newFrom) delete inherited.pageBreak;
          paragraphs.set(first, inherited);
        }
        const insertedText = text.toString();
        for (
          let index = insertedText.indexOf('\n');
          index !== -1;
          index = insertedText.indexOf('\n', index + 1)
        ) {
          const start = newFrom + index + 1;
          if (!paragraphs.has(start)) {
            const next = { ...old, from: start };
            delete next.pageBreak;
            paragraphs.set(start, next);
          }
        }
      });
    const sortedParagraphs = [...paragraphs.values()].sort((a, b) => a.from - b.from);
    validateTables(sortedParagraphs, nextText);
    return new RichFormatting(normalize(runs), sortedParagraphs, this.page);
  }
  toJSON(): FormattingData {
    return {
      ...(Object.keys(this.page).length ? { page: { ...this.page } } : {}),
      runs: this.runs.map((r) => ({ ...r })),
      paragraphs: this.paragraphs.map((p) => ({ ...p })),
    };
  }
  static parse(
    data: unknown,
    text: TextAdapter,
    extended = true,
    structured = true,
  ): RichFormatting {
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new Error('INVALID_FORMATTING');
    const object = data as Record<string, unknown>;
    if (
      Object.keys(object).sort().join(',') !==
        (structured && Object.hasOwn(object, 'page')
          ? 'page,paragraphs,runs'
          : 'paragraphs,runs') ||
      !Array.isArray(object.runs) ||
      !Array.isArray(object.paragraphs) ||
      object.runs.length > MAX_RUNS ||
      object.paragraphs.length > MAX_RUNS
    )
      throw new Error('INVALID_FORMATTING');
    let last = 0;
    const runs = object.runs.map((raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new Error('INVALID_FORMATTING');
      const r = raw as FormatRun;
      if (
        !Number.isInteger(r.from) ||
        !Number.isInteger(r.to) ||
        r.from < last ||
        r.to <= r.from ||
        r.to > text.length ||
        !validCharacterFormat(r) ||
        snapRange(text, r.from, r.to)[0] !== r.from ||
        snapRange(text, r.from, r.to)[1] !== r.to ||
        !Object.keys(clean(r)).length ||
        Object.keys(r).some(
          (key) =>
            !(
              extended
                ? [
                    'from',
                    'to',
                    'font',
                    'size',
                    'color',
                    'background',
                    'strike',
                    'script',
                    ...(structured ? ['link'] : []),
                  ]
                : ['from', 'to', 'font', 'size', 'color']
            ).includes(key),
        ) ||
        (Object.hasOwn(r, 'link') && typeof r.link !== 'string') ||
        (Object.hasOwn(r, 'background') && typeof r.background !== 'string') ||
        (Object.hasOwn(r, 'script') && !['super', 'sub'].includes(r.script!))
      )
        throw new Error('INVALID_FORMATTING');
      last = r.to;
      const parsed = { ...r };
      if (parsed.link) parsed.link = new URL(parsed.link).href;
      if (parsed.strike === false) delete parsed.strike;
      return parsed;
    });
    last = -1;
    const paragraphs = object.paragraphs.map((raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new Error('INVALID_FORMATTING');
      const p = raw as ParagraphFormat;
      if (
        !Number.isInteger(p.from) ||
        p.from <= last ||
        p.from < 0 ||
        p.from > text.length ||
        text.text.lineAt(p.from).from !== p.from ||
        !(
          structured ? ['left', 'center', 'right', 'justify'] : ['center', 'right', 'justify']
        ).includes(p.align) ||
        !validParagraph(p) ||
        Object.keys(p).some(
          (key) => !['from', 'align', ...(structured ? PARAGRAPH_KEYS : [])].includes(key),
        ) ||
        (p.align === 'left' && !PARAGRAPH_KEYS.some((k) => p[k] !== undefined)) ||
        (Object.hasOwn(p, 'table') && p.table === null)
      )
        throw new Error('INVALID_FORMATTING');
      last = p.from;
      return { ...p };
    });
    validateTables(paragraphs, text);
    return new RichFormatting(
      runs,
      paragraphs,
      object.page === undefined ? {} : parsePage(object.page),
    );
  }
}
function normalize(runs: FormatRun[]): FormatRun[] {
  runs.sort((a, b) => a.from - b.from);
  const result: FormatRun[] = [];
  for (const run of runs) {
    if (run.from >= run.to) continue;
    const previous = result.at(-1);
    if (previous && previous.to === run.from && same(previous, run)) previous.to = run.to;
    else result.push(run);
    if (result.length > MAX_RUNS) throw new Error('FORMAT_LIMIT');
  }
  return result;
}

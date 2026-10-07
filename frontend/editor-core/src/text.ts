import { ChangeSet, Text } from '@codemirror/state';
import { graphemeSegments } from 'unicode-segmenter/grapheme';
export const MAX_BYTES = 10_485_760,
  MAX_LINES = 1_000_000;
const encoder = new TextEncoder();
export function utf8Length(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes++;
    else if (c < 0x800) bytes += 2;
    else if (
      c >= 0xd800 &&
      c <= 0xdbff &&
      s.charCodeAt(i + 1) >= 0xdc00 &&
      s.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}
export function validUnicode(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(++i);
      if (!(d >= 0xdc00 && d <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
export class TextAdapter {
  constructor(
    readonly text: Text,
    readonly utf8Bytes: number,
  ) {
    if (utf8Bytes > MAX_BYTES || text.lines > MAX_LINES) throw new RangeError('FILE_TOO_LARGE');
  }
  static from(s: string): TextAdapter {
    if (s.includes('\r') || s.charCodeAt(0) === 0xfeff || !validUnicode(s))
      throw new Error('INVALID_TEXT');
    const bytes = utf8Length(s);
    if (bytes > MAX_BYTES) throw new RangeError('FILE_TOO_LARGE');
    // Bound temporary line arrays and intern only short strings within this load.
    // Immutable equal lines can share storage; no document/global cache is retained.
    const shortLines = new Map<string, string>();
    let text = Text.empty,
      lines: string[] = [],
      from = 0,
      count = 0,
      first = true;
    for (;;) {
      if (++count > MAX_LINES) throw new RangeError('FILE_TOO_LARGE');
      const end = s.indexOf('\n', from);
      let line = s.slice(from, end < 0 ? s.length : end);
      if (line.length <= 256) {
        const shared = shortLines.get(line);
        if (shared !== undefined) line = shared;
        else if (shortLines.size < 4096) shortLines.set(line, line);
      }
      lines.push(line);
      if (lines.length === 4096 || end < 0) {
        if (first) text = Text.of(lines);
        else text = text.append(Text.of(['', ...lines]));
        first = false;
        lines = [];
      }
      if (end < 0) break;
      from = end + 1;
    }
    return new TextAdapter(text, bytes);
  }
  get length(): number {
    return this.text.length;
  }
  get lines(): number {
    return this.text.lines;
  }
  slice(from = 0, to = this.length): string {
    return this.text.sliceString(from, to);
  }
  encodeUtf8(): Uint8Array {
    const bytes = new Uint8Array(this.utf8Bytes);
    let offset = 0,
      carry = '';
    for (const chunk of this.chunks()) {
      let part = carry + chunk;
      const last = part.charCodeAt(part.length - 1);
      carry = last >= 0xd800 && last <= 0xdbff ? part.slice(-1) : '';
      if (carry) part = part.slice(0, -1);
      const result = encoder.encodeInto(part, bytes.subarray(offset));
      if (result.read !== part.length) throw new Error('TEXT_BYTE_COUNT');
      offset += result.written;
    }
    if (carry || offset !== bytes.length) throw new Error('TEXT_BYTE_COUNT');
    return bytes;
  }
  apply(changes: ChangeSet): TextAdapter {
    let bytes = this.utf8Bytes;
    changes.iterChanges((a, b, _c, _d, insert) => {
      bytes += utf8Length(insert.toString()) - utf8Length(this.slice(a, b));
    });
    return new TextAdapter(changes.apply(this.text), bytes);
  }
  *chunks(): Generator<string> {
    const it = this.text.iter();
    let parts: string[] = [],
      size = 0;
    while (!it.next().done) {
      const value = it.value;
      if (value.length >= 65536) {
        if (size) {
          yield parts.join('');
          parts = [];
          size = 0;
        }
        for (let offset = 0; offset < value.length; offset += 65536)
          yield value.slice(offset, offset + 65536);
      } else {
        parts.push(value);
        size += value.length;
        if (size >= 65536) {
          yield parts.join('');
          parts = [];
          size = 0;
        }
      }
    }
    if (size) yield parts.join('');
  }
}
export function graphemes(s: string): Generator<{ from: number; to: number }> {
  return (function* () {
    for (const g of graphemeSegments(s)) yield { from: g.index, to: g.index + g.segment.length };
  })();
}
export function snapRange(text: TextAdapter, from: number, to: number): [number, number] {
  // Segment only endpoint neighborhoods; expand for arbitrarily long joining chains.
  const joining = /[\p{M}\u200d\uFE0F\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}]/u;
  function boundary(pos: number, bias: 'left' | 'right'): number {
    if (pos <= 0 || pos >= text.length) return pos;
    const adjacent = text.slice(pos - 1, pos + 1);
    if (adjacent.charCodeAt(0) < 128 && adjacent.charCodeAt(1) < 128) return pos;
    let start = Math.max(0, pos - 256),
      end = Math.min(text.length, pos + 256);
    while (
      start > 0 &&
      joining.test(text.slice(Math.max(0, start - 2), Math.min(text.length, start + 2)))
    )
      start = Math.max(0, start - 256);
    while (
      end < text.length &&
      joining.test(text.slice(Math.max(0, end - 2), Math.min(text.length, end + 2)))
    )
      end = Math.min(text.length, end + 256);
    if (
      start > 0 &&
      text.slice(start, start + 1).charCodeAt(0) >= 0xdc00 &&
      text.slice(start, start + 1).charCodeAt(0) <= 0xdfff
    )
      start--;
    if (
      end < text.length &&
      text.slice(end, end + 1).charCodeAt(0) >= 0xdc00 &&
      text.slice(end, end + 1).charCodeAt(0) <= 0xdfff
    )
      end++;
    for (const g of graphemes(text.slice(start, end))) {
      const a = start + g.from,
        b = start + g.to;
      if (a < pos && pos < b) return bias === 'left' ? a : b;
      if (a >= pos) break;
    }
    return pos;
  }
  return [boundary(from, 'left'), boundary(to, 'right')];
}

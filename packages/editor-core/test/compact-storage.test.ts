import { ChangeSet, Text } from '@codemirror/state';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  decodeNative,
  EditorModel,
  encodeNative,
  StyleTree,
  TextAdapter,
  utf8Length,
} from '../src/index';

describe('compact style storage and streaming native output', () => {
  it('builds identical CodeMirror line/offset trees across chunk and cache boundaries', () => {
    const values = [
      '',
      '\n',
      'repeat\n'.repeat(10000),
      Array.from({ length: 12000 }, (_, i) => `line-${i}😀`).join('\n') + '\n',
    ];
    for (const value of values) {
      const text = TextAdapter.from(value),
        reference = Text.of(value.split('\n'));
      expect(text.text.eq(reference)).toBe(true);
      expect(text.slice()).toBe(value);
      expect(text.lines).toBe(reference.lines);
      for (const number of [
        1,
        Math.min(4096, text.lines),
        Math.min(4097, text.lines),
        text.lines,
      ]) {
        expect(text.text.line(number)).toEqual(reference.line(number));
      }
      if (text.length) {
        const position = Math.floor(text.length / 2);
        const changes = ChangeSet.of({ from: position, to: position, insert: '\n' }, text.length);
        expect(text.apply(changes).text.eq(changes.apply(reference))).toBe(true);
      }
    }
  });
  it('queries clipped ranges across packed/dense leaves and composed lazy tags', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 16000 }), fc.nat(16000), (from, span) => {
        const masks = Array.from({ length: 16000 }, (_, i) =>
          i < 8000 ? Math.floor(i / 10) % 8 : i % 8,
        );
        let tree = StyleTree.fromRuns(masks.map((mask) => ({ length: 1, mask })));
        const original = tree;
        tree = tree.applyBit(0, 16000, 4, 'set').applyBit(4090, 12300, 2, 'clear');
        const to = Math.min(16000, from + span),
          expected = masks.map((mask, i) => (mask | 4) & (i >= 4090 && i < 12300 ? 5 : 7));
        const runs = [...tree.queryRuns(from, to)];
        expect(runs.flatMap((r) => Array<number>(r.to - r.from).fill(r.mask))).toEqual(
          expected.slice(from, to),
        );
        if (runs.length) {
          expect(runs[0]!.from).toBe(from);
          expect(runs.at(-1)!.to).toBe(to);
        }
        for (let i = 1; i < runs.length; i++) {
          expect(runs[i]!.from).toBe(runs[i - 1]!.to);
          expect(runs[i]!.mask).not.toBe(runs[i - 1]!.mask);
        }
        for (const i of [0, 31, 4095, 4096, 7999, 8000, 15999]) {
          expect(tree.maskAt(i)).toBe(expected[i]);
          expect(original.maskAt(i)).toBe(masks[i]);
        }
      }),
      { seed: 42, numRuns: 100 },
    );
  });

  it('counts UTF-8 bytes like TextEncoder including isolated surrogate replacement', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 65535 }), { maxLength: 2048 }), (units) => {
        const text = String.fromCharCode(...units);
        expect(utf8Length(text)).toBe(new TextEncoder().encode(text).length);
      }),
      { seed: 42, numRuns: 500 },
    );
  });

  it('streams exact UTF-8 across surrogate/chunk/newline boundaries and edits', () => {
    const value = 'x'.repeat(65535) + '😀e\u0301\n' + 'Việt 😀\n'.repeat(12000) + '終';
    const text = TextAdapter.from(value),
      bytes = text.encodeUtf8();
    expect(bytes).toEqual(new TextEncoder().encode(value));
    const edited = text.apply(ChangeSet.of({ from: 65535, to: 65537, insert: '👩‍💻' }, text.length));
    expect(edited.encodeUtf8()).toEqual(new TextEncoder().encode(edited.slice()));
    expect(() => new TextAdapter(Text.of(['abc']), 2).encodeUtf8()).toThrow('TEXT_BYTE_COUNT');
  });

  it('writes native ZIP offsets/checksums correctly with streamed Unicode and styles', async () => {
    const value = 'a'.repeat(65535) + '😀\n' + 'Việt\n'.repeat(17000);
    const model = new EditorModel(TextAdapter.from(value));
    model.styles = model.styles.applyBit(0, 65537, 1, 'set');
    model.preferredExportEol = 'CRLF';
    model.exportBom = true;
    const pinned = model.snapshot();
    const writing = encodeNative(pinned);
    model.replace(0, 1, 'b');
    const loaded = await decodeNative(await writing);
    expect(loaded.text.slice()).toBe(value);
    expect([...loaded.styles.queryRuns()]).toEqual([...pinned.styles.queryRuns()]);
    expect(loaded.preferredExportEol).toBe('CRLF');
    expect(loaded.exportBom).toBe(true);
  });
});

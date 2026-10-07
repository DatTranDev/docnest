import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { EditorSelection } from '@codemirror/state';
import {
  decodeNative,
  decodeStyles,
  EditorModel,
  encodeNative,
  encodeStyles,
  exportTxt,
  graphemes,
  importTxt,
  search,
  sha256,
  StyleTree,
  TextAdapter,
} from '../src/index';
const golden = resolve(import.meta.dirname, '../../../testing/fixtures/native');
describe('persistent adaptive StyleTree', () => {
  it('matches a flat oracle under random replace/format/slice and preserves old roots', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            kind: fc.integer({ min: 0, max: 2 }),
            a: fc.nat(300),
            b: fc.nat(300),
            length: fc.nat(15),
            mask: fc.integer({ min: 0, max: 7 }),
            bit: fc.constantFrom(1, 2, 4),
          }),
          { minLength: 1, maxLength: 1000 },
        ),
        (ops) => {
          let tree = StyleTree.uniform(100),
            oracle = new Array<number>(100).fill(0);
          for (const op of ops) {
            const a = op.a % (oracle.length + 1),
              b = a + (op.b % (oracle.length - a + 1)),
              old = tree,
              oldOracle = [...oracle];
            if (op.kind === 0) {
              tree = tree.replace(a, b, StyleTree.uniform(op.length, op.mask));
              oracle.splice(a, b - a, ...new Array<number>(op.length).fill(op.mask));
            } else if (op.kind === 1) {
              const clear = oracle.slice(a, b).every((m) => !!(m & op.bit));
              tree = tree.applyBit(a, b, op.bit, 'toggle');
              for (let i = a; i < b; i++)
                oracle[i] = clear ? oracle[i]! & (7 ^ op.bit) : oracle[i]! | op.bit;
            } else {
              expect(
                [...tree.slice(a, b).queryRuns()].flatMap((r) =>
                  new Array<number>(r.to - r.from).fill(r.mask),
                ),
              ).toEqual(oracle.slice(a, b));
            }
            expect(tree.length).toBe(oracle.length);
            expect(
              [...tree.queryRuns()].flatMap((r) => new Array<number>(r.to - r.from).fill(r.mask)),
            ).toEqual(oracle);
            expect(
              [...old.queryRuns()].flatMap((r) => new Array<number>(r.to - r.from).fill(r.mask)),
            ).toEqual(oldOracle);
            expect([...decodeStyles(encodeStyles(tree)).queryRuns()]).toEqual([
              ...tree.queryRuns(),
            ]);
          }
        },
      ),
      { numRuns: 100, seed: 42 },
    );
  });
  it('splits dense planes and lazy transforms across tree boundaries', () => {
    const oracle = Array.from({ length: 16000 }, (_, i) => i % 8),
      tree = StyleTree.fromRuns(oracle.map((mask) => ({ length: 1, mask }))),
      changed = tree.applyBit(31, 12500, 4, 'clear').replace(4095, 4100, StyleTree.uniform(2, 7));
    const expected = oracle.map((m, i) => (i >= 31 && i < 12500 ? m & 3 : m));
    expected.splice(4095, 5, 7, 7);
    for (let i = 0; i < expected.length; i++) expect(changed.maskAt(i)).toBe(expected[i]);
    expect(tree.maskAt(4095)).toBe(7);
  });
  it('reselects the cheaper run encoding after a lazy dense transform', () => {
    const tree = StyleTree.fromRuns(
      Array.from({ length: 4096 }, (_, i) => ({
        length: 1,
        mask: (i % 2) | (i >= 100 && i < 200 ? 4 : 0),
      })),
    ).applyBit(0, 4096, 1, 'clear');
    const bytes = encodeStyles(tree);
    expect(bytes.length).toBeLessThan(50);
    expect([...decodeStyles(bytes).queryRuns()]).toEqual([
      { from: 0, to: 100, mask: 0 },
      { from: 100, to: 200, mask: 4 },
      { from: 200, to: 4096, mask: 0 },
    ]);
  });
});
describe('atomic history and Unicode', () => {
  it('matches a text/style/history oracle through 1000 random editor operations (seed 42)', () => {
    const ops = fc.sample(
      fc.array(
        fc.record({
          kind: fc.integer({ min: 0, max: 3 }),
          a: fc.nat(1000),
          b: fc.nat(1000),
          text: fc.string({ unit: fc.constantFrom('a', 'b', 'x'), maxLength: 5 }),
          mask: fc.integer({ min: 0, max: 7 }),
          bit: fc.constantFrom(1, 2, 4),
        }),
        { minLength: 1000, maxLength: 1000 },
      ),
      { seed: 42, numRuns: 10 },
    );
    for (const sequence of ops) {
      const m = new EditorModel();
      let text = '',
        masks: number[] = [];
      type O = { text: string; masks: number[] };
      const undo: { before: O; after: O }[] = [],
        redo: { before: O; after: O }[] = [];
      for (const [step, op] of sequence.entries()) {
        const a = op.a % (text.length + 1),
          b = a + (op.b % (text.length - a + 1)),
          before = { text, masks: [...masks] };
        if (op.kind === 0) {
          m.replace(a, b, op.text, op.mask, `op-${step}`);
          text = text.slice(0, a) + op.text + text.slice(b);
          masks.splice(a, b - a, ...new Array<number>(op.text.length).fill(op.mask));
          undo.push({ before, after: { text, masks: [...masks] } });
          redo.length = 0;
        } else if (op.kind === 1) {
          m.moveSelection(EditorSelection.single(a, b));
          m.format(op.bit);
          if (a !== b) {
            const clear = masks.slice(a, b).every((mask) => !!(mask & op.bit));
            for (let i = a; i < b; i++)
              masks[i] = clear ? masks[i]! & (7 ^ op.bit) : masks[i]! | op.bit;
            undo.push({ before, after: { text, masks: [...masks] } });
            redo.length = 0;
          }
        } else if (op.kind === 2) {
          const entry = undo.pop();
          expect(m.undo()).toBe(!!entry);
          if (entry) {
            redo.push(entry);
            text = entry.before.text;
            masks = [...entry.before.masks];
          }
        } else {
          const entry = redo.pop();
          expect(m.redo()).toBe(!!entry);
          if (entry) {
            undo.push(entry);
            text = entry.after.text;
            masks = [...entry.after.masks];
          }
        }
        expect(m.text.slice()).toBe(text);
        expect(m.text.utf8Bytes).toBe(new TextEncoder().encode(text).length);
        expect(
          [...m.styles.queryRuns()].flatMap((r) => new Array<number>(r.to - r.from).fill(r.mask)),
        ).toEqual(masks);
        expect(m.styles.length).toBe(text.length);
      }
    }
  });
  it('zero-match replacement leaves content/history/dirty state unchanged', () => {
    const m = new EditorModel(TextAdapter.from('abc')),
      s = m.snapshot();
    m.replaceAll([], 3, 'replacement');
    expect(m.contentToken).toBe(s.contentToken);
    expect(m.text.slice()).toBe('abc');
    expect(m.history).toHaveLength(0);
    expect(m.dirty).toBe(false);
  });
  it('restores styles/content tokens and discards redo branches', () => {
    const m = new EditorModel();
    m.replace(0, 0, 'Việt 😀 é\n');
    const typed = m.contentToken;
    m.moveSelection(EditorSelection.single(0, 4));
    m.format(1);
    expect(m.styles.maskAt(1)).toBe(1);
    m.undo();
    expect(m.styles.maskAt(1)).toBe(0);
    expect(m.contentToken).toBe(typed);
    m.redo();
    expect(m.styles.maskAt(1)).toBe(1);
    m.undo();
    m.replace(0, 0, 'x');
    expect(m.redo()).toBe(false);
    const saved = m.snapshot();
    m.savedContentToken = saved.contentToken;
    m.replace(1, 1, 'y');
    expect(m.dirty).toBe(true);
    m.undo();
    expect(m.dirty).toBe(false);
    expect(m.localRevision).toBeGreaterThan(saved.localRevision);
  });
  it('does not split surrogate, combining, skin-tone or ZWJ graphemes', () => {
    for (const cluster of ['😀', 'é', '👩🏽‍💻', '👨‍👩‍👧‍👦', '🇻🇳', 'क्‍ष', '🫩']) {
      expect([...graphemes(cluster)]).toEqual([{ from: 0, to: cluster.length }]);
      const m = new EditorModel(TextAdapter.from(`A${cluster}B`));
      m.moveSelection(EditorSelection.single(2, 3));
      m.format(2);
      for (let i = 1; i < 1 + cluster.length; i++) expect(m.styles.maskAt(i)).toBe(2);
      m.replace(2, 2, 'x');
      expect(m.text.slice()).toBe('AxB');
    }
  });
  it('preserves first surviving style when a combining mark joins it', () => {
    const m = new EditorModel(TextAdapter.from('a'), StyleTree.uniform(1, 1));
    m.pendingMask = 2;
    m.replace(1, 1, '́');
    expect(m.text.slice()).toBe('á');
    expect(m.styles.maskAt(1)).toBe(1);
    m.undo();
    expect(m.text.slice()).toBe('a');
  });
  it('expands arbitrarily long combining and ZWJ chains, without segmenting a full selection', () => {
    for (const cluster of ['e' + '́'.repeat(1000), '👩‍'.repeat(200) + '👩']) {
      const m = new EditorModel(TextAdapter.from(cluster));
      m.moveSelection(EditorSelection.single(300, 301));
      m.format(4);
      expect(m.styles.node!.andMask).toBe(4);
      m.replace(300, 301, 'x');
      expect(m.text.slice()).toBe('x');
    }
  });
  it('rejects invalid Unicode and whole operations beyond the byte/line cap', () => {
    expect(() => TextAdapter.from('\ud800')).toThrow();
    expect(() => TextAdapter.from('x'.repeat(10485761))).toThrow('FILE_TOO_LARGE');
    expect(() => TextAdapter.from('\n'.repeat(1000000))).toThrow('FILE_TOO_LARGE');
    const m = new EditorModel(TextAdapter.from('x'.repeat(10485760)));
    expect(() => m.replace(0, 0, 'x')).toThrow('FILE_TOO_LARGE');
    expect(m.text.length).toBe(10485760);
  });
});
describe('native codec and TXT preferences', () => {
  it('independently reads all uniform/run/dense fixtures and SHA values', async () => {
    const index = JSON.parse(await readFile(resolve(golden, 'index.json'), 'utf8')) as {
      file: string;
      nativeSha256: string;
      manifest: { utf16Length: number };
      styleKind: string;
      uniformMask: number;
      runs: [number, number][];
    }[];
    for (const f of index) {
      const raw = new Uint8Array(await readFile(resolve(golden, f.file)));
      expect(await sha256(raw)).toBe(f.nativeSha256);
      const s = await decodeNative(raw);
      expect(s.text.length).toBe(f.manifest.utf16Length);
      let expected: number[] = [];
      if (f.styleKind === 'uniform')
        expected = new Array<number>(s.text.length).fill(f.uniformMask);
      else if (f.styleKind === 'runs')
        expected = f.runs.flatMap(([n, m]) => new Array<number>(n).fill(m));
      else expected = Array.from({ length: s.text.length }, (_, i) => i % 8);
      expect(
        [...s.styles.queryRuns()].flatMap((r) => new Array<number>(r.to - r.from).fill(r.mask)),
      ).toEqual(expected);
      const round = await decodeNative(await encodeNative(s));
      expect(round.text.slice()).toBe(s.text.slice());
      expect([...round.styles.queryRuns()]).toEqual([...s.styles.queryRuns()]);
    }
  });
  it('preserves Unicode, CRLF and BOM only as TXT export preferences', async () => {
    const s = importTxt(new TextEncoder().encode('\ufeffViệt 😀\r\né\rnext'));
    expect(s.text.slice()).toBe('Việt 😀\né\nnext');
    expect(s.preferredExportEol).toBe('CRLF');
    expect(s.exportBom).toBe(true);
    const round = await decodeNative(await encodeNative(s));
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(exportTxt(round))).toBe(
      '\ufeffViệt 😀\r\né\r\nnext',
    );
    expect(() => importTxt(Uint8Array.from([0xc0, 0xaf]))).toThrow();
  });
  it('rejects CRC corruption, truncation, compression, unknown entries and inconsistent grapheme styles', async () => {
    const original = new Uint8Array(await readFile(resolve(golden, 'mixed-runs.tedoc')));
    const corrupted = original.slice();
    corrupted[90] = corrupted[90]! ^ 1;
    await expect(decodeNative(corrupted)).rejects.toThrow();
    await expect(decodeNative(original.subarray(0, original.length - 1))).rejects.toThrow();
    const compressed = original.slice();
    new DataView(compressed.buffer).setUint16(8, 8, true);
    await expect(decodeNative(compressed)).rejects.toThrow();
    const bad = new EditorModel(
      TextAdapter.from('é'),
      StyleTree.fromRuns([
        { length: 1, mask: 0 },
        { length: 1, mask: 1 },
      ]),
    );
    await expect(decodeNative(await encodeNative(bad.snapshot()))).rejects.toThrow(
      'GRAPHEME_STYLE_MISMATCH',
    );
    const badStyle = encodeStyles(StyleTree.uniform(1));
    badStyle[20] = 9;
    expect(() => decodeStyles(badStyle)).toThrow('UNKNOWN_STYLE_TAG');
    const trailing = new Uint8Array(badStyle.length + 1);
    trailing.set(encodeStyles(StyleTree.uniform(1)));
    expect(() => decodeStyles(trailing)).toThrow();
  });
});
describe('streaming literal KMP', () => {
  it('finds across arbitrary chunks and newline and counts past retained cap', () => {
    expect(search(['xxab', 'c\n', 'dabc\nd'], 'abc\nd')).toEqual({
      count: 2,
      matches: [2, 7],
      truncated: false,
    });
    expect(search(['aBc', 'ABC'], 'abc', true).count).toBe(2);
    expect(search(['x'.repeat(20001)], 'x').matches.length).toBe(10000);
    expect(search(['x'.repeat(20001)], 'x').count).toBe(20001);
    expect(() => search(['abc'], 'b', false, () => true)).toThrow('CANCELLED');
  });
});

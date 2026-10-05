import { describe, expect, it } from 'vitest';
import { decodeNative, EditorModel, encodeNative, StyleTree, TextAdapter } from '../src';
describe('streaming literal replace transactions', () => {
  it('replaces a million matches without a million undo descriptors', () => {
    const original = 'x\n'.repeat(999999) + 'x',
      model = new EditorModel(TextAdapter.from(original), StyleTree.uniform(original.length, 7));
    model.replaceLiteralAll('x', 'y');
    expect(model.text.lines).toBe(1000000);
    expect(model.text.slice(0, 3)).toBe('y\ny');
    expect(model.text.slice(-1 + model.text.length)).toBe('y');
    expect(model.history).toHaveLength(1);
    expect(model.styles.maskAt(model.text.length - 1)).toBe(7);
    expect(model.historyBytes).toBeLessThan(model.historyCap);
    model.undo();
    expect(model.text.slice()).toBe(original);
    expect(model.dirty).toBe(false);
    model.redo();
    expect(model.text.slice(0, 3)).toBe('y\ny');
  }, 30000);
  it('preserves varying masks in bulk output and native reopening', async () => {
    const model = new EditorModel(
      TextAdapter.from('ab'.repeat(12000)),
      StyleTree.fromRuns(Array.from({ length: 24000 }, (_, i) => ({ length: 1, mask: i % 8 }))),
    );
    model.replaceLiteralAll('a', 'zz');
    expect(model.text.length).toBe(36000);
    for (let i = 0; i < 30; i++) {
      expect(model.styles.maskAt(i * 3)).toBe((i * 2) % 8);
      expect(model.styles.maskAt(i * 3 + 1)).toBe((i * 2) % 8);
      expect(model.styles.maskAt(i * 3 + 2)).toBe((i * 2 + 1) % 8);
    }
    const opened = await decodeNative(await encodeNative(model.snapshot()));
    expect(opened.text.slice()).toBe(model.text.slice());
    expect(opened.styles.maskAt(35999)).toBe(model.styles.maskAt(35999));
    model.undo();
    expect(model.text.length).toBe(24000);
  }, 30000);
  it('counts case-folded matches freshly and rejects size growth atomically', () => {
    const model = new EditorModel(TextAdapter.from('Ab aB'));
    model.replaceLiteralAll('AB', 'z', true);
    expect(model.text.slice()).toBe('z z');
    const large = new EditorModel(TextAdapter.from('x'.repeat(10485760))),
      token = large.contentToken;
    expect(() => large.replaceLiteralAll('x', 'xx')).toThrow('FILE_TOO_LARGE');
    expect(large.contentToken).toBe(token);
    expect(large.history).toHaveLength(0);
  }, 30000);
  it('reconciles newly joined combining graphemes with their start mask', async () => {
    const model = new EditorModel(
      TextAdapter.from('ax '.repeat(12000)),
      StyleTree.fromRuns(
        Array.from({ length: 36000 }, (_, i) => ({ length: 1, mask: i % 3 === 0 ? 1 : 4 })),
      ),
    );
    model.replaceLiteralAll('x', '\u0301');
    expect(model.styles.maskAt(0)).toBe(1);
    expect(model.styles.maskAt(1)).toBe(1);
    await expect(decodeNative(await encodeNative(model.snapshot()))).resolves.toBeDefined();
  }, 30000);
});

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ChangeSet } from '@codemirror/state';
import { encodeNative, decodeNative } from '../src/codec';
import { EditorModel } from '../src/model';
import { TextAdapter } from '../src/text';
import { SharedDocument } from '../src/collaboration';

const base = () => new EditorModel(TextAdapter.from('Hello world')).snapshot();
function peers() {
  const a = new SharedDocument(),
    b = new SharedDocument();
  a.seed(base());
  b.apply(a.encode());
  return [a, b] as const;
}
function insert(peer: SharedDocument, at: number, text: string) {
  const m = EditorModel.loaded(peer.snapshot(base()));
  m.replace(at, at, text);
  const changes = ChangeSet.of({ from: at, insert: text }, peer.text.length);
  peer.publish(m.snapshot(), changes, [{ newFrom: at, newTo: at + text.length }]);
}
describe('concurrent editing CRDT', () => {
  it('converges for concurrent insertion, reversed delivery and duplicate updates', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 11 }),
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !/[\r\uFEFF]/.test(s)),
        (at, text) => {
          const [a, b] = peers();
          try {
            insert(a, at, text);
            insert(b, at, 'remote');
            const aa = a.encode(),
              bb = b.encode();
            a.apply(bb);
            b.apply(aa);
            b.apply(bb);
            a.apply(aa);
            expect(a.text.toString()).toBe(b.text.toString());
            expect(a.text.length).toBe(17 + text.length);
          } finally {
            a.destroy();
            b.destroy();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
  it('local undo keeps the other user’s simultaneous text', () => {
    const [a, b] = peers();
    insert(a, 5, 'A');
    insert(b, 5, 'B');
    const aa = a.encode(),
      bb = b.encode();
    a.apply(bb);
    b.apply(aa);
    a.undoManager.undo();
    b.apply(a.encode());
    expect(a.text.toString()).toBe('HelloB world');
    expect(b.text.toString()).toBe(a.text.toString());
    a.undoManager.redo();
    expect(a.text.toString()).toContain('A');
    b.apply(a.encode());
    expect(a.text.toString()).toBe(b.text.toString());
    a.destroy();
    b.destroy();
  });
  it('combines concurrent independent formatting attributes', () => {
    const [a, b] = peers();
    const ma = EditorModel.loaded(a.snapshot(base())),
      mb = EditorModel.loaded(b.snapshot(base()));
    ma.styles = ma.styles.applyBit(0, 5, 1, 'set');
    mb.styles = mb.styles.applyBit(0, 5, 2, 'set');
    const ranges = [{ newFrom: 0, newTo: 5 }];
    a.publish(ma.snapshot(), ChangeSet.empty(11), ranges);
    b.publish(mb.snapshot(), ChangeSet.empty(11), ranges);
    const aa = a.encode(),
      bb = b.encode();
    a.apply(bb);
    b.apply(aa);
    expect(a.snapshot(base()).styles.maskAt(0)).toBe(3);
    expect(b.snapshot(base()).styles.maskAt(0)).toBe(3);
    a.destroy();
    b.destroy();
  });
  it('merges extended formatting attributes and keeps them through Unicode projection and native save', async () => {
    const initial = new EditorModel(TextAdapter.from('Việt😀')).snapshot();
    const a = new SharedDocument(),
      b = new SharedDocument();
    try {
      a.seed(initial);
      b.apply(a.encode());
      const ma = EditorModel.loaded(a.snapshot(initial)),
        mb = EditorModel.loaded(b.snapshot(initial));
      ma.formatting = ma.formatting.apply(0, ma.text.length, { background: '#ffff00' });
      mb.formatting = mb.formatting.apply(0, mb.text.length, { strike: true, script: 'sub' });
      a.publish(ma.snapshot(), ChangeSet.empty(ma.text.length), [
        { newFrom: 0, newTo: ma.text.length },
      ]);
      b.publish(mb.snapshot(), ChangeSet.empty(mb.text.length), [
        { newFrom: 0, newTo: mb.text.length },
      ]);
      const aa = a.encode(),
        bb = b.encode();
      a.apply(bb);
      b.apply(aa);
      a.apply(bb);
      const left = a.snapshot(initial),
        right = b.snapshot(initial);
      expect(left.formatting?.toJSON()).toEqual(right.formatting?.toJSON());
      expect((await decodeNative(await encodeNative(left))).formatting?.at(4)).toMatchObject({
        background: '#ffff00',
        strike: true,
        script: 'sub',
      });
    } finally {
      a.destroy();
      b.destroy();
    }
  });
  it('merges overlapping deletion and insertion without deleting the concurrent insertion', () => {
    const [a, b] = peers();
    const ma = EditorModel.loaded(a.snapshot(base()));
    ma.replace(0, 5, '');
    a.publish(ma.snapshot(), ChangeSet.of({ from: 0, to: 5 }, 11), []);
    insert(b, 3, 'X');
    const aa = a.encode(),
      bb = b.encode();
    a.apply(bb);
    b.apply(aa);
    expect(a.text.toString()).toBe('X world');
    expect(b.text.toString()).toBe('X world');
    a.destroy();
    b.destroy();
  });

  it('projects a combining mark inserted concurrently with formatting into valid native graphemes', async () => {
    const a = new SharedDocument(),
      b = new SharedDocument();
    const initial = new EditorModel(TextAdapter.from('a')).snapshot();
    a.seed(initial);
    b.apply(a.encode());
    const styled = EditorModel.loaded(initial);
    styled.styles = styled.styles.applyBit(0, 1, 1, 'set');
    a.publish(styled.snapshot(), ChangeSet.empty(1), [{ newFrom: 0, newTo: 1 }]);
    const accented = EditorModel.loaded(initial);
    accented.replace(1, 1, '\u0301');
    b.publish(accented.snapshot(), ChangeSet.of({ from: 1, insert: '\u0301' }, 1), [
      { newFrom: 1, newTo: 2 },
    ]);
    const aa = a.encode(),
      bb = b.encode();
    a.apply(bb);
    b.apply(aa);
    const projected = a.snapshot(initial);
    expect(projected.text.slice()).toBe('a\u0301');
    expect(projected.styles.maskAt(0)).toBe(projected.styles.maskAt(1));
    const reopened = await decodeNative(await encodeNative(projected));
    expect(reopened.text.slice()).toBe('a\u0301');
    a.destroy();
    b.destroy();
  });

  it('preserves independently concurrent font, size, color and paragraph alignment', async () => {
    const [a, b] = peers();
    const ma = EditorModel.loaded(a.snapshot(base())),
      mb = EditorModel.loaded(b.snapshot(base()));
    ma.formatting = ma.formatting
      .apply(0, 11, { font: 'Georgia', size: 18 })
      .align(ma.text, 0, 11, 'center');
    mb.formatting = mb.formatting.apply(0, 11, { color: '#bb2244' });
    const range = [{ newFrom: 0, newTo: 11 }];
    a.publish(ma.snapshot(), ChangeSet.empty(11), range);
    b.publish(mb.snapshot(), ChangeSet.empty(11), range);
    const aa = a.encode(),
      bb = b.encode();
    a.apply(bb);
    b.apply(aa);
    const snapshot = a.snapshot(base());
    expect(snapshot.formatting!.at(0)).toMatchObject({
      font: 'Georgia',
      size: 18,
      color: '#bb2244',
    });
    expect(snapshot.formatting!.alignAt(0)).toBe('center');
    expect(b.snapshot(base()).formatting!.toJSON()).toEqual(snapshot.formatting!.toJSON());
    expect((await decodeNative(await encodeNative(snapshot))).formatting!.alignAt(0)).toBe(
      'center',
    );
    a.destroy();
    b.destroy();
  });

  it('preserves alignment and selective undo on an empty final paragraph', async () => {
    const initial = new EditorModel();
    initial.formatting = initial.formatting.align(initial.text, 0, 0, 'center');
    const a = new SharedDocument(),
      b = new SharedDocument();
    a.seed(initial.snapshot());
    b.apply(a.encode());
    expect(b.snapshot(initial.snapshot()).formatting!.alignAt(0)).toBe('center');
    initial.formatting = initial.formatting.align(initial.text, 0, 0, 'right');
    a.publish(initial.snapshot(), ChangeSet.empty(0), [{ newFrom: 0, newTo: 0 }]);
    a.undoManager.undo();
    expect(a.snapshot(initial.snapshot()).formatting!.alignAt(0)).toBe('center');
    a.undoManager.redo();
    b.apply(a.encode());
    const reopened = await decodeNative(await encodeNative(b.snapshot(initial.snapshot())));
    expect(reopened.formatting!.alignAt(0)).toBe('right');
    a.destroy();
    b.destroy();
  });
});

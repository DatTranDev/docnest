import { EditorSelection } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { decodeNative, EditorModel, encodeNative, TextAdapter, RichFormatting } from '../src/index';

describe('font, size, color and paragraph alignment', () => {
  it('round trips all extended properties, clears individual attributes and preserves atomic undo', async () => {
    const model = new EditorModel(TextAdapter.from('A😀B'));
    model.moveSelection(EditorSelection.single(0, 4));
    model.formatCharacter({ background: '#ABCDEF', strike: true, script: 'super', size: 18 });
    const snapshot = model.snapshot();
    const reopened = await decodeNative(await encodeNative(snapshot));
    expect(reopened.formatting?.at(1)).toMatchObject({
      background: '#abcdef',
      strike: true,
      script: 'super',
      size: 18,
    });
    model.formatCharacter({ background: null, strike: false, script: 'sub' });
    expect(model.formatting.at(1).background).toBeUndefined();
    expect(model.formatting.at(1).strike).toBeUndefined();
    expect(model.formatting.at(1).script).toBe('sub');
    model.undo();
    expect(model.formatting).toBe(snapshot.formatting);
    model.redo();
    expect(
      (await decodeNative(await encodeNative(model.snapshot()))).formatting?.at(1).script,
    ).toBe('sub');
  });
  it('rejects unsafe CSS, unsupported script values and extended attributes in legacy formatting', () => {
    const text = TextAdapter.from('abc');
    const model = new EditorModel(text);
    model.moveSelection(EditorSelection.single(0, 3));
    expect(() => model.formatCharacter({ background: 'url(javascript:1)' })).toThrow(
      'INVALID_FORMAT',
    );
    expect(() => model.formatCharacter({ script: 'bad' as 'super' })).toThrow('INVALID_FORMAT');
    expect(() =>
      RichFormatting.parse(
        { runs: [{ from: 0, to: 3, background: '#ffff00' }], paragraphs: [] },
        text,
        false,
      ),
    ).toThrow('INVALID_FORMATTING');
    expect(() =>
      RichFormatting.parse(
        { runs: [{ from: 0, to: 3, background: null, color: '#123456' }], paragraphs: [] },
        text,
      ),
    ).toThrow('INVALID_FORMATTING');
  });
  it('does not mutate imported adjacent runs when normalizing a cleared snapshot', () => {
    const source = new RichFormatting([
      { from: 0, to: 2, size: 18 },
      { from: 2, to: 4, size: 18 },
      { from: 4, to: 6, color: '#123456' },
    ]);
    const original = source.toJSON();
    const cleared = source.clear(4, 6);
    expect(cleared.query(0, 4)).toEqual([{ from: 0, to: 4, size: 18 }]);
    expect(source.toJSON()).toEqual(original);
  });
  it('removes imported default strike without changing legacy color casing before choosing a writer version', async () => {
    const model = new EditorModel(TextAdapter.from('abc'));
    model.formatting = RichFormatting.parse(
      {
        runs: [{ from: 0, to: 3, font: 'Arial', color: '#AABBCC', strike: false }],
        paragraphs: [],
      },
      model.text,
    );
    expect(model.formatting.at(0).color).toBe('#AABBCC');
    expect(model.formatting.at(0).strike).toBeUndefined();
    expect((await decodeNative(await encodeNative(model.snapshot()))).formatting?.at(0).font).toBe(
      'Arial',
    );
  });
  it('applies a paragraph preset atomically and excludes the next paragraph at a selection boundary', async () => {
    const model = new EditorModel(TextAdapter.from('First😀\nsecond'));
    model.moveSelection(EditorSelection.single(1, 8));
    model.format(4);
    model.formatCharacter({ font: 'Georgia', color: '#123456' });
    const before = model.snapshot();
    const history = model.history.length;
    model.applyTextStyle('heading2');
    expect(model.text.slice()).toBe('First😀\nsecond');
    expect(model.styles.maskAt(0)).toBe(1);
    expect(model.styles.maskAt(6)).toBe(1);
    expect(model.styles.maskAt(8)).toBe(0);
    expect(model.formatting.at(0)).toMatchObject({ font: 'Arial', size: 16, color: '#202124' });
    expect(model.formatting.at(8)).toEqual({});
    expect(model.history.length).toBe(history + 1);
    model.undo();
    expect(model.styles).toBe(before.styles);
    expect(model.formatting).toBe(before.formatting);
    model.redo();
    const reopened = await decodeNative(await encodeNative(model.snapshot()));
    expect(reopened.formatting?.at(0).size).toBe(16);
    expect(reopened.styles.maskAt(0)).toBe(1);
  });
  it('clears grapheme-safe character styles in one undo step without changing alignment or text', () => {
    const model = new EditorModel(TextAdapter.from('A😀B'));
    model.moveSelection(EditorSelection.single(0, 4));
    model.format(1);
    model.formatCharacter({ font: 'Georgia', size: 18, color: '#123456' });
    model.alignParagraph('right');
    const before = model.snapshot();
    model.moveSelection(EditorSelection.single(2, 3));
    model.clearFormatting();
    expect(model.styles.maskAt(0)).toBe(1);
    expect(model.styles.maskAt(1)).toBe(0);
    expect(model.styles.maskAt(2)).toBe(0);
    expect(model.styles.maskAt(3)).toBe(1);
    expect(model.formatting.at(1)).toEqual({});
    expect(model.formatting.at(3).font).toBe('Georgia');
    expect(model.formatting.alignAt(0)).toBe('right');
    expect(model.text).toBe(before.text);
    model.undo();
    expect(model.styles).toBe(before.styles);
    expect(model.formatting).toBe(before.formatting);
  });
  it('sets only pending styles on an empty paragraph and resets them at the caret', () => {
    const model = new EditorModel();
    model.applyTextStyle('heading1');
    expect(model.dirty).toBe(false);
    expect(model.pendingMask).toBe(1);
    model.replace(0, 0, 'Title');
    expect(model.styles.maskAt(0)).toBe(1);
    expect(model.formatting.at(0).size).toBe(20);
    model.clearFormatting();
    model.replace(5, 5, ' plain');
    expect(model.styles.maskAt(5)).toBe(0);
    expect(model.formatting.at(5)).toEqual({});
  });
  it('preserves every character outside cleared ranges against a flat oracle', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), fc.nat(49), fc.nat(49), (length, a, b) => {
        const from = Math.min(a % length, b % length),
          to = Math.max(a % length, b % length) + 1;
        const model = new EditorModel(TextAdapter.from('x'.repeat(length)));
        model.moveSelection(EditorSelection.single(0, length));
        model.format(2);
        model.formatCharacter({ size: 24, color: '#123456' });
        model.moveSelection(EditorSelection.single(from, to));
        model.clearFormatting();
        for (let at = 0; at < length; at++) {
          expect(model.styles.maskAt(at)).toBe(at >= from && at < to ? 0 : 2);
          expect(model.formatting.at(at).size).toBe(at >= from && at < to ? undefined : 24);
        }
      }),
      { numRuns: 100 },
    );
  });
  it('survives native save/reopen and undo/redo without changing v1 documents', async () => {
    const old = new EditorModel(TextAdapter.from('Hello\nworld'));
    const oldBytes = await encodeNative(old.snapshot());
    expect((await decodeNative(oldBytes)).formatting?.empty).toBe(true);

    old.moveSelection(EditorSelection.single(0, 5));
    old.formatCharacter({ font: 'Georgia', size: 18, color: '#AABBCC' });
    old.alignParagraph('center');
    expect(old.formatting.at(2)).toMatchObject({ font: 'Georgia', size: 18, color: '#aabbcc' });
    expect(old.formatting.alignAt(0)).toBe('center');
    expect(old.pendingFormat.font).toBe('Georgia');
    const bytes = await encodeNative(old.snapshot());
    const reopened = EditorModel.loaded(await decodeNative(bytes));
    expect(reopened.formatting.at(2)).toMatchObject({
      font: 'Georgia',
      size: 18,
      color: '#aabbcc',
    });
    expect(reopened.formatting.alignAt(0)).toBe('center');

    expect(old.undo()).toBe(true);
    expect(old.formatting.alignAt(0)).toBe('left');
    expect(old.undo()).toBe(true);
    expect(old.formatting.at(2)).toEqual({});
    expect(old.redo()).toBe(true);
    expect(old.redo()).toBe(true);
    expect(old.formatting.alignAt(0)).toBe('center');
  });

  it('inherits formatting while typing and rejects unsupported values', () => {
    const model = new EditorModel(TextAdapter.from('abc'));
    model.moveSelection(EditorSelection.single(0, 3));
    model.formatCharacter({ font: 'Courier New', size: 12, color: '#123456' });
    model.moveSelection(EditorSelection.single(2));
    model.replace(2, 2, 'Z');
    expect(model.formatting.at(2)).toMatchObject({
      font: 'Courier New',
      size: 12,
      color: '#123456',
    });
    expect(() => model.formatCharacter({ size: 100 })).toThrow('INVALID_FORMAT');
    expect(() => model.formatCharacter({ color: 'url(javascript:1)' })).toThrow('INVALID_FORMAT');
  });

  it('carries paragraph alignment to a newly inserted paragraph', () => {
    const model = new EditorModel(TextAdapter.from('hello'));
    model.alignParagraph('right');
    model.moveSelection(EditorSelection.single(5));
    model.replace(5, 5, '\nworld');
    expect(model.formatting.alignAt(0)).toBe('right');
    expect(model.formatting.alignAt(6)).toBe('right');
  });

  it('preserves distinct character formatting at each replace-all match', () => {
    const model = new EditorModel(TextAdapter.from('aa bb aa'));
    model.moveSelection(EditorSelection.single(0, 2));
    model.formatCharacter({ font: 'Georgia' });
    model.moveSelection(EditorSelection.single(6, 8));
    model.formatCharacter({ font: 'Courier New' });
    model.replaceLiteralAll('aa', 'X');
    expect(model.text.slice()).toBe('X bb X');
    expect(model.formatting.at(0).font).toBe('Georgia');
    expect(model.formatting.at(5).font).toBe('Courier New');
  });
});

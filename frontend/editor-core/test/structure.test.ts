import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ChangeSet, EditorSelection } from '@codemirror/state';
import {
  decodeNative,
  encodeNative,
  EditorModel,
  TextAdapter,
  RichFormatting,
  safeLink,
  SharedDocument,
} from '../src/index';

describe('structured document transactions', () => {
  it('canonicalizes internationalized hyperlink hosts and paths for the Java reader', async () => {
    const model = new EditorModel(TextAdapter.from('Link'));
    model.moveSelection(EditorSelection.single(0, 4));
    model.formatCharacter({ link: 'https://tiếngviệt.vn/đường' });
    const link = model.formatting.at(0).link!;
    expect(link).toMatch(/^https:\/\/xn--/);
    expect(link).toContain('%C4');
    expect((await decodeNative(await encodeNative(model.snapshot()))).formatting?.at(0).link).toBe(
      link,
    );
  });
  it('bounds tables before commit and keeps a single break when inserting at paragraph start', () => {
    const m = new EditorModel(TextAdapter.from('abc'));
    m.formatParagraph({ pageBreak: true, list: 'bullet' });
    m.replace(0, 0, 'prefix\n');
    expect(m.formatting.paragraphs.filter((p) => p.pageBreak)).toHaveLength(1);
    const table = new EditorModel();
    table.insertTable(1, 2);
    const before = table.snapshot();
    expect(() => table.replace(0, 0, 'x'.repeat(20000))).toThrow('TABLE_LIMIT');
    expect(table.contentToken).toBe(before.contentToken);
    expect(table.text).toBe(before.text);
    expect(() =>
      RichFormatting.parse(
        {
          runs: [],
          paragraphs: [
            { from: 0, align: 'left', table: { id: 'same', columns: 2 } },
            { from: 2, align: 'left', table: { id: 'same', columns: 3 } },
          ],
        },
        TextAdapter.from('a\nb'),
      ),
    ).toThrow('TABLE_LIMIT');
  });
  it('roundtrips V5 paragraphs, links, page settings and atomic undo', async () => {
    const model = new EditorModel(TextAdapter.from('Việt 😀\nsecond\nlast'));
    model.moveSelection(EditorSelection.single(0, 8));
    model.formatParagraph({
      list: 'number',
      indent: 2,
      lineSpacing: 2,
      spaceAfter: 12,
      pageBreak: true,
    });
    model.formatCharacter({ link: 'https://example.com/?q=a&b=c' });
    model.setPage({ header: 'Header Việt', footer: 'Footer', pageNumbers: true });
    const snapshot = model.snapshot(),
      data = await encodeNative(snapshot),
      reopened = await decodeNative(data);
    expect(reopened.formatting?.toJSON()).toEqual(model.formatting.toJSON());
    expect(new TextDecoder().decode(data)).toContain('"schemaVersion":5');
    model.undo();
    expect(model.formatting.page).toEqual({});
    model.redo();
    expect(model.formatting).toBe(snapshot.formatting);
    model.alignParagraph('center');
    expect(model.formatting.paragraphAt(0)).toMatchObject({
      align: 'center',
      list: 'number',
      indent: 2,
    });
    model.formatParagraph({ list: undefined, indent: 0, pageBreak: false });
    expect(model.formatting.paragraphAt(0).list).toBeUndefined();
  });
  it('inserts editable table cells as one transaction, maps edits and restores them', async () => {
    const model = new EditorModel(TextAdapter.from('before after'));
    model.moveSelection(EditorSelection.single(7));
    const before = model.snapshot();
    model.insertTable(2, 3);
    expect(model.history).toHaveLength(1);
    expect(model.formatting.paragraphs.filter((p) => p.table)).toHaveLength(6);
    const start = model.selection.main.from;
    model.replace(start, start + 1, 'cell Việt');
    expect(model.formatting.paragraphAt(start).table?.columns).toBe(3);
    const saved = await decodeNative(await encodeNative(model.snapshot()));
    expect(saved.formatting?.toJSON()).toEqual(model.formatting.toJSON());
    model.undo();
    model.undo();
    expect(model.text).toBe(before.text);
    expect(model.formatting).toBe(before.formatting);
    model.redo();
    model.redo();
    expect(model.text.slice()).toContain('cell Việt');
  });
  it('inherits paragraph style on splitting, without duplicating stored page breaks', () => {
    const m = new EditorModel(TextAdapter.from('abc'));
    m.formatParagraph({ list: 'bullet', indent: 1, pageBreak: true });
    m.replace(1, 1, '\n');
    expect(m.formatting.paragraphAt(2)).toMatchObject({ list: 'bullet', indent: 1 });
    expect(m.formatting.paragraphAt(2).pageBreak).toBeUndefined();
    const n = new EditorModel(TextAdapter.from('abc'));
    n.formatParagraph({ list: 'bullet' });
    n.replace(0, 0, 'new\n');
    expect(n.formatting.paragraphAt(0).list).toBe('bullet');
    expect(n.formatting.paragraphAt(4).list).toBe('bullet');
  });
  it('page break splits at caret and undo restores text and metadata together', () => {
    const m = new EditorModel(TextAdapter.from('abcdef'));
    m.moveSelection(EditorSelection.single(3));
    m.insertPageBreak();
    expect(m.text.slice()).toBe('abc\ndef');
    expect(m.formatting.paragraphAt(4).pageBreak).toBe(true);
    m.undo();
    expect(m.text.slice()).toBe('abcdef');
    expect(m.formatting.empty).toBe(true);
  });
  it('rejects unsafe links and unbounded/malformed structural data, including in legacy native readers', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///a',
      'https://user:secret@example.com',
      'https://example.com/\n',
    ])
      expect(safeLink(url)).toBe(false);
    for (const url of [
      'https://example.com/#part',
      'mailto:user@example.com',
      'http://example.com/',
    ])
      expect(safeLink(url)).toBe(true);
    const text = TextAdapter.from('abc');
    for (const p of [
      { indent: 9 },
      { lineSpacing: 1.3 },
      { table: { id: 'x', columns: 9 } },
      { pageBreak: 'yes' },
      { unknown: true },
    ])
      expect(() =>
        RichFormatting.parse({ runs: [], paragraphs: [{ from: 0, align: 'left', ...p }] }, text),
      ).toThrow();
    expect(() =>
      RichFormatting.parse({ runs: [], paragraphs: [], page: { header: 'bad\n' } }, text),
    ).toThrow();
    expect(() =>
      RichFormatting.parse(
        { runs: [{ from: 0, to: 3, link: 'https://example.com' }], paragraphs: [] },
        text,
        true,
        false,
      ),
    ).toThrow();
    expect(() =>
      RichFormatting.parse(
        { runs: [], paragraphs: [{ from: 0, align: 'left', list: 'bullet' }] },
        text,
        true,
        false,
      ),
    ).toThrow();
  });
  it('preserves immutable sparse anchors under generated edits and native serialization', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 8 }),
        async (at, indent) => {
          const m = new EditorModel(TextAdapter.from('first\nsecond'));
          m.moveSelection(EditorSelection.single(0, 12));
          m.formatParagraph({ list: 'number', indent, lineSpacing: 1.5 });
          const before = m.formatting.toJSON();
          m.replace(at, at, 'x\ny');
          const result = m.formatting.toJSON();
          for (const p of result.paragraphs) expect(m.text.text.lineAt(p.from).from).toBe(p.from);
          expect(
            (await decodeNative(await encodeNative(m.snapshot()))).formatting?.toJSON(),
          ).toEqual(result);
          m.undo();
          expect(m.formatting.toJSON()).toEqual(before);
        },
      ),
      { numRuns: 50 },
    );
  });
  it('converges independent paragraph/page/link edits and collaborative table cell edits', async () => {
    const m = new EditorModel(TextAdapter.from('Việt'));
    m.moveSelection(EditorSelection.single(4));
    m.insertTable(1, 2);
    const base = m.snapshot();
    const a = new SharedDocument(),
      b = new SharedDocument();
    a.seed(base);
    b.apply(a.encode());
    try {
      const ma = EditorModel.loaded(a.snapshot(base)),
        mb = EditorModel.loaded(b.snapshot(base));
      ma.moveSelection(EditorSelection.single(0, 4));
      ma.formatParagraph({ list: 'number' });
      ma.setPage({ header: 'Header' });
      ma.formatCharacter({ link: 'https://example.com' });
      mb.moveSelection(EditorSelection.single(0, 4));
      mb.formatParagraph({ lineSpacing: 2 });
      mb.setPage({ footer: 'Footer' });
      a.publish(ma.snapshot(), ChangeSet.empty(ma.text.length), [{ newFrom: 0, newTo: 5 }]);
      b.publish(mb.snapshot(), ChangeSet.empty(mb.text.length), [{ newFrom: 0, newTo: 5 }]);
      const aa = a.encode(),
        bb = b.encode();
      a.apply(bb);
      b.apply(aa);
      const merged = a.snapshot(base);
      expect(merged.formatting?.paragraphAt(0)).toMatchObject({ list: 'number', lineSpacing: 2 });
      expect(merged.formatting?.page).toEqual({ header: 'Header', footer: 'Footer' });
      expect(merged.formatting?.at(0).link).toBe('https://example.com/');
      expect(b.snapshot(base).formatting?.toJSON()).toEqual(merged.formatting?.toJSON());
      expect((await decodeNative(await encodeNative(merged))).formatting?.toJSON()).toEqual(
        merged.formatting?.toJSON(),
      );
    } finally {
      a.destroy();
      b.destroy();
    }
  });
});

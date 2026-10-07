import { ChangeSet, EditorSelection } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { EditorModel, StyleTree, TextAdapter } from '../src/index';

describe('composition history boundaries', () => {
  it('undoes one long Vietnamese composition with text, styles and token restored together', () => {
    const m = new EditorModel(TextAdapter.from('A'), StyleTree.uniform(1, 1)),
      before = m.contentToken;
    m.moveSelection(EditorSelection.single(1));
    m.beginComposition();
    m.replace(1, 1, 'v', 2, 'composition', 1000);
    m.moveSelection(EditorSelection.single(2), true);
    m.replace(1, 2, 'vie', 2, 'composition', 3000);
    m.replace(1, 4, 'Việt', 2, 'composition', 8000);
    m.endComposition();
    expect(m.history).toHaveLength(1);
    expect(m.text.slice()).toBe('AViệt');
    expect(m.styles.maskAt(2)).toBe(2);
    const after = m.contentToken;
    expect(m.undo()).toBe(true);
    expect(m.text.slice()).toBe('A');
    expect(m.contentToken).toBe(before);
    expect(m.styles.maskAt(0)).toBe(1);
    expect(m.redo()).toBe(true);
    expect(m.text.slice()).toBe('AViệt');
    expect(m.contentToken).toBe(after);
    expect(m.styles.maskAt(2)).toBe(2);
  });
  it('separates adjacent compositions and ordinary typing even within 500ms', () => {
    const m = new EditorModel();
    m.replace(0, 0, 'A', 0, 'typing', 0);
    m.beginComposition();
    m.replace(1, 1, 'e', 0, 'composition', 10);
    m.replace(1, 2, 'é', 0, 'composition', 20);
    m.endComposition();
    m.beginComposition();
    m.replace(3, 3, 'x', 0, 'composition', 30);
    m.replace(3, 4, '🇻🇳', 0, 'composition', 40);
    m.endComposition();
    m.replace(7, 7, 'B', 0, 'typing', 50);
    expect(m.history).toHaveLength(4);
    m.undo();
    expect(m.text.slice()).toBe('Aé🇻🇳');
    m.undo();
    expect(m.text.slice()).toBe('Aé');
    m.undo();
    expect(m.text.slice()).toBe('A');
    m.undo();
    expect(m.text.slice()).toBe('');
  });
});

describe('atomic internal paste style slices', () => {
  it('preserves mixed masks in a single undoable transaction and reconciles joining graphemes', () => {
    const m = new EditorModel(TextAdapter.from('abc'), StyleTree.uniform(3, 4));
    const insert = 'é👩🏽‍💻',
      styles = StyleTree.fromRuns([
        { length: 2, mask: 3 },
        { length: insert.length - 2, mask: 5 },
      ]);
    m.change(
      ChangeSet.of({ from: 1, to: 2, insert }, 3),
      EditorSelection.single(1 + insert.length),
      0,
      'paste',
      0,
      styles,
    );
    expect(m.history).toHaveLength(1);
    expect(m.text.slice()).toBe(`a${insert}c`);
    expect(m.styles.maskAt(1)).toBe(3);
    expect(m.styles.maskAt(4)).toBe(5);
    m.undo();
    expect(m.text.slice()).toBe('abc');
    expect(m.styles.node!.andMask).toBe(4);
    m.redo();
    expect(m.styles.maskAt(4)).toBe(5);
    const joined = new EditorModel(TextAdapter.from('a'), StyleTree.uniform(1, 1));
    joined.change(
      ChangeSet.of({ from: 1, insert: '́' }, 1),
      EditorSelection.single(2),
      0,
      'paste',
      0,
      StyleTree.uniform(1, 4),
    );
    expect(joined.styles.maskAt(1)).toBe(1);
  });
  it('rejects mismatched length and inconsistent grapheme masks without mutating the document', () => {
    const m = new EditorModel(),
      token = m.contentToken,
      changes = ChangeSet.of({ from: 0, insert: 'é' }, 0);
    expect(() =>
      m.change(changes, EditorSelection.single(2), 0, 'paste', 0, StyleTree.uniform(1, 1)),
    ).toThrow('STYLE_LENGTH');
    expect(() =>
      m.change(
        changes,
        EditorSelection.single(2),
        0,
        'paste',
        0,
        StyleTree.fromRuns([
          { length: 1, mask: 0 },
          { length: 1, mask: 1 },
        ]),
      ),
    ).toThrow('GRAPHEME_STYLE_MISMATCH');
    expect(m.text.length).toBe(0);
    expect(m.contentToken).toBe(token);
    expect(m.history).toHaveLength(0);
  });
});

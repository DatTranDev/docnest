import { ChangeSet, EditorSelection } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  EditorModel,
  encodeNative,
  encodeStyles,
  IMAGE_PLACEHOLDER,
  TextAdapter,
} from '@ted/editor-core';
import { restoreDraft } from '../model/DraftStore';

describe('rich offline draft recovery', () => {
  it('replays inserted image metadata with its text placeholder', async () => {
    const model = new EditorModel(TextAdapter.from('A'));
    const native = await encodeNative(model.snapshot());
    model.moveSelection(EditorSelection.single(1));
    model.insertImage({
      id: 'c7400587-68dd-4afa-a90e-358783bf2dc0',
      mime: 'image/png',
      width: 1,
      height: 1,
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
    });
    const recovered = await restoreDraft({
      key: 'test',
      userId: 'user',
      documentId: 'document',
      baseHeadRevision: 0,
      updatedAt: Date.now(),
      token: model.contentToken,
      native,
      journal: [
        {
          changes: ChangeSet.of({ from: 1, insert: IMAGE_PLACEHOLDER }, 1).toJSON(),
          ranges: [{ from: 1, to: 1, styles: encodeStyles(model.styles.slice(1, 2)) }],
          images: model.images.toJSON(),
          revision: model.localRevision,
          token: model.contentToken,
        },
      ],
    });
    expect(recovered.images?.at(1)?.mime).toBe('image/png');
  });
  it('replays character and paragraph formatting over a native checkpoint', async () => {
    const model = new EditorModel(TextAdapter.from('Hello'));
    const native = await encodeNative(model.snapshot());
    model.moveSelection(EditorSelection.single(0, 5));
    model.formatCharacter({ font: 'Georgia', size: 18, color: '#aabbcc' });
    model.alignParagraph('right');
    const recovered = await restoreDraft({
      key: 'test',
      userId: 'user',
      documentId: 'document',
      baseHeadRevision: 0,
      updatedAt: Date.now(),
      token: model.contentToken,
      native,
      journal: [
        {
          changes: ChangeSet.empty(5).toJSON(),
          ranges: [{ from: 0, to: 5, styles: encodeStyles(model.styles) }],
          formatting: model.formatting.toJSON(),
          revision: model.localRevision,
          token: model.contentToken,
        },
      ],
    });
    expect(recovered.formatting?.at(1)).toMatchObject({
      font: 'Georgia',
      size: 18,
      color: '#aabbcc',
    });
    expect(recovered.formatting?.alignAt(0)).toBe('right');
  });
});

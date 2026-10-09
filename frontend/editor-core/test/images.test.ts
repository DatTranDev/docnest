import { EditorSelection } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  decodeNative,
  EditorModel,
  encodeNative,
  exportTxt,
  IMAGE_PLACEHOLDER,
  ImageStore,
  TextAdapter,
} from '../src/index';

const png = {
  id: 'c7400587-68dd-4afa-a90e-358783bf2dc0',
  mime: 'image/png' as const,
  width: 1,
  height: 1,
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
};

describe('embedded images', () => {
  it('inserts, moves, saves, reopens, undoes and exports an image', async () => {
    const model = new EditorModel(TextAdapter.from('hello'));
    model.moveSelection(EditorSelection.single(2));
    model.insertImage(png);
    expect(model.text.slice()).toBe(`he${IMAGE_PLACEHOLDER}llo`);
    expect(model.images.at(2)?.id).toBe(png.id);
    const native = await encodeNative(model.snapshot());
    const reopened = EditorModel.loaded(await decodeNative(native));
    expect(reopened.images.at(2)).toMatchObject(png);
    expect(new TextDecoder().decode(exportTxt(reopened.snapshot()))).toBe('he[Image]llo');
    model.replace(0, 0, 'A');
    expect(model.images.at(3)?.id).toBe(png.id);
    model.undo();
    expect(model.images.at(2)?.id).toBe(png.id);
    model.undo();
    expect(model.images.empty).toBe(true);
    model.redo();
    expect(model.images.at(2)?.id).toBe(png.id);
  });

  it('rejects metadata without a matching placeholder and invalid data', () => {
    expect(() =>
      ImageStore.parse({ images: [{ ...png, from: 0 }] }, TextAdapter.from('abc')),
    ).toThrow('INVALID_IMAGES');
    expect(() =>
      ImageStore.parse(
        { images: [{ ...png, from: 0, data: 'AAAA' }] },
        TextAdapter.from(IMAGE_PLACEHOLDER),
      ),
    ).toThrow('INVALID_IMAGE');
  });
});

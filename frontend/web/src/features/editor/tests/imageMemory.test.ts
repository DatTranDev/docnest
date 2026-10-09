import { EditorSelection } from '@codemirror/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorModel, ImageStore, TextAdapter } from '@ted/editor-core';
import { ImageUrlCache } from '../model/ImageUrlCache';
import { ReplicaBridge } from '../model/ReplicaBridge';

const image = {
  from: 0,
  id: 'c7400587-68dd-4afa-a90e-358783bf2dc0',
  mime: 'image/png' as const,
  width: 1,
  height: 1,
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
};

afterEach(() => vi.restoreAllMocks());

describe('image memory boundaries', () => {
  it('uses one binary object URL per image and releases it on delete/close', async () => {
    const blobs: Blob[] = [];
    const created = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      if (!(blob instanceof Blob)) throw new Error('Expected image Blob');
      blobs.push(blob);
      return `blob:test/${blobs.length}`;
    });
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const cache = new ImageUrlCache();
    expect(cache.get(image)).toBe('blob:test/1');
    expect(cache.get(image)).toBe('blob:test/1');
    expect(created).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(await blobs[0]!.arrayBuffer()).slice(0, 8)).toEqual(
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    cache.prune(new ImageStore());
    expect(revoked).toHaveBeenCalledWith('blob:test/1');
    expect(cache.get(image)).toBe('blob:test/2');
    cache.destroy();
    expect(revoked).toHaveBeenCalledWith('blob:test/2');
  });

  it('sends image bytes to the worker only for a pinned save snapshot', () => {
    const messages: Record<string, unknown>[] = [];
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      postMessage(message: Record<string, unknown>) {
        messages.push(message);
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    try {
      const model = new EditorModel(TextAdapter.from('A'));
      model.moveSelection(EditorSelection.single(1));
      model.insertImage(image);
      const bridge = new ReplicaBridge();
      bridge.init(model);
      expect(messages[0]).not.toHaveProperty('images');
      model.replace(0, 0, 'B');
      bridge.update(model, model.history.at(-1)!.forward, [
        { from: 0, to: 0, newFrom: 0, newTo: 1 },
      ]);
      expect(messages[1]).not.toHaveProperty('images');
      const pending = bridge.snapshotFor(model.snapshot()).catch(() => undefined);
      expect((messages[2]!.images as { images: unknown[] }).images).toHaveLength(1);
      bridge.destroy();
      return pending;
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

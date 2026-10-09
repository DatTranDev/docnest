import { MAX_IMAGE_BYTES, type ImageStore, type PlacedImage } from '@ted/editor-core';

function imageBytes(data: string): Uint8Array {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  const length = (data.length / 4) * 3 - padding;
  if (!Number.isInteger(length) || length < 1 || length > MAX_IMAGE_BYTES)
    throw new Error('INVALID_IMAGE');
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (let from = 0; from < data.length; from += 32768) {
    const chunk = atob(data.slice(from, from + 32768));
    for (let i = 0; i < chunk.length; i++) bytes[offset++] = chunk.charCodeAt(i);
  }
  if (offset !== length) throw new Error('INVALID_IMAGE');
  return bytes;
}

export class ImageUrlCache {
  private readonly urls = new Map<string, { data: string; url: string }>();

  get(image: PlacedImage): string {
    const current = this.urls.get(image.id);
    if (current?.data === image.data) return current.url;
    if (current) URL.revokeObjectURL(current.url);
    const bytes = imageBytes(image.data);
    const url = URL.createObjectURL(
      new Blob([bytes as Uint8Array<ArrayBuffer>], { type: image.mime }),
    );
    this.urls.set(image.id, { data: image.data, url });
    return url;
  }

  prune(images: ImageStore): void {
    const active = new Set(images.images.map((image) => image.id));
    for (const [id, cached] of this.urls)
      if (!active.has(id)) {
        URL.revokeObjectURL(cached.url);
        this.urls.delete(id);
      }
  }

  destroy(): void {
    for (const cached of this.urls.values()) URL.revokeObjectURL(cached.url);
    this.urls.clear();
  }
}

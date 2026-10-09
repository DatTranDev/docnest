import type { ChangeSet } from '@codemirror/state';
import type { TextAdapter } from './text';

export const IMAGE_PLACEHOLDER = '\ufffc';
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_COUNT = 100;
export const MAX_IMAGE_DIMENSION_PX = 4096;
export type ImageMime = 'image/png' | 'image/jpeg';
export interface ImageAsset {
  id: string;
  mime: ImageMime;
  width: number;
  height: number;
  data: string;
}
export interface PlacedImage extends ImageAsset {
  from: number;
}
export interface ImageData {
  images: PlacedImage[];
}

function decoded(asset: ImageAsset): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(asset.data) || asset.data.length % 4)
    throw new Error('INVALID_IMAGE');
  const estimated = (asset.data.length / 4) * 3;
  if (estimated > MAX_IMAGE_BYTES + 2) throw new Error('IMAGE_TOO_LARGE');
  let raw: string;
  try {
    raw = atob(asset.data);
  } catch {
    throw new Error('INVALID_IMAGE');
  }
  if (!raw.length || raw.length > MAX_IMAGE_BYTES) throw new Error('IMAGE_TOO_LARGE');
  let canonical = '';
  for (let offset = 0; offset < raw.length; offset += 32766)
    canonical += btoa(raw.slice(offset, offset + 32766));
  if (canonical !== asset.data) throw new Error('INVALID_IMAGE');
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function jpegDimensions(bytes: Uint8Array): [number, number] | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let offset = 2; offset + 9 < bytes.length;) {
    if (bytes[offset] !== 0xff) return null;
    let marker = bytes[++offset];
    while (marker === 0xff) marker = bytes[++offset];
    if (marker === undefined) return null;
    offset++;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const size = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (size < 2 || offset + size > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker!) && size >= 7)
      return [
        (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
        (bytes[offset + 3]! << 8) | bytes[offset + 4]!,
      ];
    offset += size;
  }
  return null;
}

export function validateImage(asset: ImageAsset): void {
  if (
    !/^[0-9a-fA-F-]{36}$/.test(asset.id) ||
    !['image/png', 'image/jpeg'].includes(asset.mime) ||
    !Number.isInteger(asset.width) ||
    !Number.isInteger(asset.height) ||
    asset.width < 1 ||
    asset.height < 1 ||
    asset.width > MAX_IMAGE_DIMENSION_PX ||
    asset.height > MAX_IMAGE_DIMENSION_PX
  )
    throw new Error('INVALID_IMAGE');
  const bytes = decoded(asset);
  let dimensions: [number, number] | null = null;
  if (asset.mime === 'image/png') {
    if (
      bytes.length >= 24 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) &&
      String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR'
    ) {
      const view = new DataView(bytes.buffer);
      dimensions = [view.getUint32(16), view.getUint32(20)];
    }
  } else dimensions = jpegDimensions(bytes);
  if (!dimensions || dimensions[0] !== asset.width || dimensions[1] !== asset.height)
    throw new Error('INVALID_IMAGE');
}

export class ImageStore {
  readonly images: readonly PlacedImage[];
  constructor(images: readonly PlacedImage[] = []) {
    this.images = images;
  }
  get empty(): boolean {
    return this.images.length === 0;
  }
  ids(): string {
    return this.images
      .map((image) => image.id)
      .sort()
      .join(',');
  }
  at(from: number): PlacedImage | undefined {
    let low = 0,
      high = this.images.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.images[middle]!.from < from) low = middle + 1;
      else high = middle;
    }
    return this.images[low]?.from === from ? this.images[low] : undefined;
  }
  query(from: number, to: number): PlacedImage[] {
    return this.images.filter((image) => image.from >= from && image.from < to);
  }
  map(changes: ChangeSet, inserted?: PlacedImage): ImageStore {
    if (this.empty && !inserted) return this;
    const removed = new Set<string>();
    changes.iterChanges((from, to) => {
      for (const image of this.query(from, to)) removed.add(image.id);
    });
    const next = this.images
      .filter((image) => !removed.has(image.id))
      .map((image) => ({
        ...image,
        from: changes.mapPos(image.from, 1),
      }));
    if (inserted) next.push(inserted);
    next.sort((a, b) => a.from - b.from);
    if (next.length > MAX_IMAGE_COUNT) throw new Error('IMAGE_LIMIT');
    if (
      (inserted || removed.size) &&
      new TextEncoder().encode(JSON.stringify({ images: next })).length > 8 * 1024 * 1024
    )
      throw new Error('MEDIA_LIMIT');
    return new ImageStore(next);
  }
  toJSON(): ImageData {
    return { images: this.images.map((image) => ({ ...image })) };
  }
  static parse(value: unknown, text: TextAdapter): ImageStore {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).join(',') !== 'images'
    )
      throw new Error('INVALID_IMAGES');
    const entries = (value as ImageData).images;
    if (!Array.isArray(entries) || entries.length > MAX_IMAGE_COUNT)
      throw new Error('INVALID_IMAGES');
    const ids = new Set<string>();
    let last = -1;
    const images = entries.map((entry) => {
      if (
        !entry ||
        typeof entry !== 'object' ||
        Array.isArray(entry) ||
        Object.keys(entry).sort().join(',') !== 'data,from,height,id,mime,width' ||
        !Number.isInteger(entry.from) ||
        entry.from <= last ||
        entry.from >= text.length ||
        text.slice(entry.from, entry.from + 1) !== IMAGE_PLACEHOLDER ||
        ids.has(entry.id)
      )
        throw new Error('INVALID_IMAGES');
      validateImage(entry);
      ids.add(entry.id);
      last = entry.from;
      return { ...entry };
    });
    return new ImageStore(images);
  }
}

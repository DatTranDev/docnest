import { Inflate } from 'fflate';

const MAX_INPUT = 16 * 1024 * 1024;
const MAX_EXPANDED = 32 * 1024 * 1024;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!;
  return (crc ^ 0xffffffff) >>> 0;
}
/** Check sizes before the ZIP decoder allocates or inflates any entry. ZIP64 is excluded. */
export function readDocxArchive(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.length > MAX_INPUT) throw new Error('docxLimit');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (
      view.getUint32(end, true) === 0x06054b50 &&
      end + 22 + view.getUint16(end + 20, true) === bytes.length
    )
      break;
  }
  if (end < 0 || end < bytes.length - 65557) throw new Error('docxInvalid');
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    count !== view.getUint16(end + 8, true) ||
    !count ||
    count > 512 ||
    offset + size !== end
  )
    throw new Error('docxInvalid');
  const expected = new Map<
    string,
    { size: number; crc: number; start: number; compressed: number; method: number }
  >();
  let expanded = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error('docxInvalid');
    const flags = view.getUint16(offset + 8, true),
      method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true),
      original = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true),
      extra = view.getUint16(offset + 30, true),
      comment = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const next = offset + 46 + nameLength + extra + comment;
    if (
      next > end ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      local + 30 > offset ||
      view.getUint32(local, true) !== 0x04034b50 ||
      view.getUint16(offset + 34, true)
    )
      throw new Error('docxInvalid');
    if ((expanded += original) > MAX_EXPANDED) throw new Error('docxLimit');
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const localNameLength = view.getUint16(local + 26, true),
      localExtra = view.getUint16(local + 28, true);
    const dataStart = local + 30 + localNameLength + localExtra;
    if (
      expected.has(name) ||
      name.includes('..') ||
      name.includes('\\') ||
      name.startsWith('/') ||
      dataStart + compressed > view.getUint32(end + 16, true) ||
      decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name ||
      view.getUint16(local + 8, true) !== method ||
      view.getUint16(local + 6, true) & 1
    )
      throw new Error('docxInvalid');
    expected.set(name, {
      size: original,
      crc: view.getUint32(offset + 16, true),
      start: dataStart,
      compressed,
      method,
    });
    offset = next;
  }
  if (
    offset !== end ||
    !expected.has('word/document.xml') ||
    !expected.has('[Content_Types].xml') ||
    [...expected.keys()].some((name) => /vbaProject|embeddings\//i.test(name))
  )
    throw new Error('docxUnsupported');
  const files: Record<string, Uint8Array> = Object.create(null);
  for (const [name, metadata] of expected) {
    const compressed = bytes.subarray(metadata.start, metadata.start + metadata.compressed);
    let file: Uint8Array;
    if (metadata.method === 0) file = compressed;
    else {
      file = new Uint8Array(metadata.size);
      let produced = 0;
      const inflater = new Inflate((chunk) => {
        if (produced + chunk.length > metadata.size) throw new Error('docxInvalid');
        file.set(chunk, produced);
        produced += chunk.length;
      });
      // A dishonest ZIP size cannot cause unbounded output allocation or silent truncation.
      for (let at = 0; at < compressed.length; at += 1024)
        inflater.push(compressed.subarray(at, at + 1024), at + 1024 >= compressed.length);
      if (produced !== metadata.size) throw new Error('docxInvalid');
    }
    if (file.length !== metadata.size || crc32(file) !== metadata.crc)
      throw new Error('docxInvalid');
    files[name] = file;
  }
  return files;
}

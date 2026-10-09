import { StyleTree, type Run } from './style';
import { RichFormatting } from './formatting';
import { ImageStore, IMAGE_PLACEHOLDER } from './images';
import { graphemes, MAX_BYTES, TextAdapter } from './text';
import type { Snapshot } from './model';
export interface Manifest {
  schemaVersion: 1 | 2 | 3 | 4 | 5;
  textEncoding: 'utf-8';
  internalEol: 'LF';
  preferredExportEol: 'LF' | 'CRLF';
  exportBom: boolean;
  offsetUnit: 'utf16';
  utf8Bytes: number;
  utf16Length: number;
  logicalLines: number;
  stylesEncoding: 'adaptive-v1';
  textSha256: string;
  stylesSha256: string;
  formattingEncoding?: 'sparse-v1' | 'sparse-v2' | 'sparse-v3';
  formattingSha256?: string;
  mediaEncoding?: 'embedded-v1';
  mediaSha256?: string;
}
const encoder = new TextEncoder(),
  decoder = new TextDecoder('utf-8', { fatal: true }),
  MAX_NATIVE = 32 * 1024 * 1024;
export async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  for (let k = 0; k < 8; k++) i = i & 1 ? 0xedb88320 ^ (i >>> 1) : i >>> 1;
  return i >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function varint(n: number): number[] {
  const a: number[] = [];
  do {
    const b = n & 127;
    n >>>= 7;
    a.push(b | (n ? 128 : 0));
  } while (n);
  return a;
}
function readVar(bytes: Uint8Array, pos: { i: number }): number {
  let n = 0;
  for (let k = 0; k < 5; k++) {
    const b = bytes[pos.i++];
    if (b === undefined || (k === 4 && b > 15)) throw new Error('INVALID_VARINT');
    n += (b & 127) * 2 ** (7 * k);
    if (!(b & 128)) {
      if (k && !(b & 127)) throw new Error('NONCANONICAL_VARINT');
      return n;
    }
  }
  throw new Error('INVALID_VARINT');
}
export function encodeStyles(styles: StyleTree): Uint8Array {
  const records: Uint8Array[] = [];
  for (const n of styles.leaves()) {
    if (n.leaf?.kind === 'dense' && n.andMask !== n.orMask) {
      const v = varint(n.length),
        words = Math.ceil(n.length / 32),
        dense = new Uint8Array(1 + v.length + words * 12),
        view = new DataView(dense.buffer);
      dense[0] = 2;
      dense.set(v, 1);
      for (let bit = 0; bit < 3; bit++)
        for (let w = 0; w < words; w++) {
          const active =
            w === words - 1 && n.length % 32 ? 0xffffffff >>> (32 - (n.length % 32)) : 0xffffffff;
          const value = n.o & (1 << bit) ? active : n.a & (1 << bit) ? n.leaf.planes[bit]![w]! : 0;
          view.setUint32(1 + v.length + bit * words * 4 + w * 4, value, true);
        }
      let runCount = 1;
      const prior = [0, 0, 0];
      for (let w = 0; w < words; w++) {
        let changes = 0;
        for (let bit = 0; bit < 3; bit++) {
          const value = view.getUint32(1 + v.length + bit * words * 4 + w * 4, true);
          changes |= value ^ ((value << 1) | prior[bit]!);
          prior[bit] = value >>> 31;
        }
        if (!w) changes &= ~1;
        if (w === words - 1 && n.length % 32) changes &= 0xffffffff >>> (32 - (n.length % 32));
        changes = changes - ((changes >>> 1) & 0x55555555);
        changes = (changes & 0x33333333) + ((changes >>> 2) & 0x33333333);
        runCount += (((changes + (changes >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
      }
      if (runCount * 2 + 1 + v.length + varint(runCount).length >= dense.length) {
        records.push(dense);
        continue;
      }
    }
    const rs = [...new StyleTree(n).queryRuns()].map((r) => ({
      length: r.to - r.from,
      mask: r.mask,
    }));
    let bytes: number[];
    if (rs.length === 1) bytes = [0, ...varint(n.length), rs[0]!.mask];
    else {
      const runs = [
        1,
        ...varint(n.length),
        ...varint(rs.length),
        ...rs.flatMap((r) => [...varint(r.length), r.mask]),
      ];
      const size = 1 + varint(n.length).length + 12 * Math.ceil(n.length / 32);
      if (runs.length <= size) bytes = runs;
      else {
        const dense = new Uint8Array(size);
        dense[0] = 2;
        dense.set(varint(n.length), 1);
        const d = new DataView(dense.buffer),
          offset = 1 + varint(n.length).length;
        let at = 0;
        for (const r of rs) {
          for (let end = at + r.length; at < end; at++)
            for (let bit = 0; bit < 3; bit++)
              if (r.mask & (1 << bit)) {
                const p = offset + bit * Math.ceil(n.length / 32) * 4 + (at >>> 5) * 4;
                d.setUint32(p, d.getUint32(p, true) | (1 << (at & 31)), true);
              }
        }
        records.push(dense);
        continue;
      }
    }
    records.push(Uint8Array.from(bytes));
  }
  const out = new Uint8Array(20 + records.reduce((n, r) => n + r.length, 0));
  out.set(encoder.encode('TEDSTYLE'));
  const d = new DataView(out.buffer);
  d.setUint16(8, 1, true);
  d.setUint32(12, styles.length, true);
  d.setUint32(16, records.length, true);
  let p = 20;
  for (const r of records) {
    out.set(r, p);
    p += r.length;
  }
  if (out.length > 8 * 1024 * 1024) throw new Error('STYLES_TOO_LARGE');
  return out;
}
export function decodeStyles(bytes: Uint8Array): StyleTree {
  if (
    bytes.length < 20 ||
    bytes.length > 8 * 1024 * 1024 ||
    decoder.decode(bytes.subarray(0, 8)) !== 'TEDSTYLE'
  )
    throw new Error('INVALID_STYLE_HEADER');
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    n = d.getUint32(12, true),
    count = d.getUint32(16, true);
  if (
    d.getUint16(8, true) !== 1 ||
    d.getUint16(10, true) !== 0 ||
    n > MAX_BYTES ||
    (count === 0) !== (n === 0) ||
    count > n
  )
    throw new Error('INVALID_STYLE_HEADER');
  let total = 0;
  const pos = { i: 20 };
  let tree = StyleTree.uniform(0);
  for (let k = 0; k < count; k++) {
    const tag = bytes[pos.i++],
      length = readVar(bytes, pos);
    if (!length || total + length > n) throw new Error('INVALID_STYLE_LENGTH');
    let part: StyleTree;
    if (tag === 0) {
      const mask = bytes[pos.i++];
      if (mask === undefined || mask > 7) throw new Error('INVALID_MASK');
      part = StyleTree.uniform(length, mask);
    } else if (tag === 1) {
      const count = readVar(bytes, pos),
        runs: Run[] = [];
      let sum = 0,
        size = 0;
      part = StyleTree.uniform(0);
      if (!count || count > length) throw new Error('INVALID_RUN_COUNT');
      for (let j = 0; j < count; j++) {
        const len = readVar(bytes, pos),
          mask = bytes[pos.i++];
        if (!len || mask === undefined || mask > 7 || sum + len > length)
          throw new Error('INVALID_RUN');
        sum += len;
        let remaining = len;
        while (remaining) {
          const take = Math.min(remaining, 4096 - size);
          runs.push({ length: take, mask });
          remaining -= take;
          size += take;
          if (size === 4096) {
            part = part.concat(StyleTree.fromRuns(runs));
            runs.length = 0;
            size = 0;
          }
        }
      }
      if (sum !== length) throw new Error('INVALID_RUN_SUM');
      part = part.concat(StyleTree.fromRuns(runs));
    } else if (tag === 2) {
      const words = Math.ceil(length / 32),
        size = words * 12;
      if (pos.i + size > bytes.length) throw new Error('TRUNCATED_DENSE');
      const planes = [0, 1, 2].map((bit) =>
        Uint32Array.from({ length: words }, (_, w) =>
          d.getUint32(pos.i + bit * words * 4 + w * 4, true),
        ),
      );
      if (length % 32)
        for (const plane of planes)
          if (plane.at(-1)! >>> (length % 32) !== 0) throw new Error('DENSE_PADDING');
      pos.i += size;
      part = StyleTree.fromDense(length, planes);
    } else throw new Error('UNKNOWN_STYLE_TAG');
    tree = tree.concat(part);
    total += part.length;
  }
  if (total !== n || pos.i !== bytes.length) throw new Error('STYLE_LENGTH_OR_TRAILING');
  return tree;
}
function zipStore(entries: Record<string, Uint8Array>): Uint8Array {
  const parts = Object.entries(entries).map(([name, payload]) => ({
    filename: encoder.encode(name),
    payload,
    crc: crc32(payload),
  }));
  const localSize = parts.reduce((n, p) => n + 30 + p.filename.length + p.payload.length, 0),
    centralSize = parts.reduce((n, p) => n + 46 + p.filename.length, 0);
  if (localSize + centralSize + 22 > MAX_NATIVE) throw new Error('FILE_TOO_LARGE');
  const out = new Uint8Array(localSize + centralSize + 22),
    view = new DataView(out.buffer);
  let local = 0,
    central = localSize;
  for (const { filename, payload, crc } of parts) {
    view.setUint32(local, 0x04034b50, true);
    view.setUint16(local + 4, 20, true);
    view.setUint16(local + 12, 33, true);
    view.setUint32(local + 14, crc, true);
    view.setUint32(local + 18, payload.length, true);
    view.setUint32(local + 22, payload.length, true);
    view.setUint16(local + 26, filename.length, true);
    out.set(filename, local + 30);
    out.set(payload, local + 30 + filename.length);
    view.setUint32(central, 0x02014b50, true);
    view.setUint16(central + 4, 20, true);
    view.setUint16(central + 6, 20, true);
    view.setUint16(central + 14, 33, true);
    view.setUint32(central + 16, crc, true);
    view.setUint32(central + 20, payload.length, true);
    view.setUint32(central + 24, payload.length, true);
    view.setUint16(central + 28, filename.length, true);
    view.setUint32(central + 42, local, true);
    out.set(filename, central + 46);
    local += 30 + filename.length + payload.length;
    central += 46 + filename.length;
  }
  view.setUint32(central, 0x06054b50, true);
  view.setUint16(central + 8, parts.length, true);
  view.setUint16(central + 10, parts.length, true);
  view.setUint32(central + 12, centralSize, true);
  view.setUint32(central + 16, localSize, true);
  return out;
}
function unzipStore(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.length > MAX_NATIVE || bytes.length < 22) throw new Error('INVALID_NATIVE_SIZE');
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && d.getUint32(end, true) !== 0x06054b50) end--;
  if (
    end < 0 ||
    d.getUint16(end + 4, true) ||
    d.getUint16(end + 6, true) ||
    ![3, 4, 5].includes(d.getUint16(end + 8, true)) ||
    d.getUint16(end + 10, true) !== d.getUint16(end + 8, true) ||
    end + 22 + d.getUint16(end + 20, true) !== bytes.length
  )
    throw new Error('INVALID_ZIP_DIRECTORY');
  let p = d.getUint32(end + 16, true),
    total = 0;
  const centralEnd = p + d.getUint32(end + 12, true),
    entries: Record<string, Uint8Array> = {};
  if (centralEnd !== end) throw new Error('INVALID_ZIP_DIRECTORY');
  for (let k = 0; k < d.getUint16(end + 8, true); k++) {
    if (p + 46 > end || d.getUint32(p, true) !== 0x02014b50) throw new Error('INVALID_ZIP_ENTRY');
    const flags = d.getUint16(p + 8, true),
      method = d.getUint16(p + 10, true),
      compressed = d.getUint32(p + 20, true),
      length = d.getUint32(p + 24, true),
      nameLength = d.getUint16(p + 28, true),
      extra = d.getUint16(p + 30, true),
      comment = d.getUint16(p + 32, true),
      local = d.getUint32(p + 42, true),
      name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    if (
      !['manifest.json', 'text.utf8', 'styles.bin', 'formatting.json', 'media.json'].includes(
        name,
      ) ||
      Object.hasOwn(entries, name) ||
      flags & ~0x800 ||
      method !== 0 ||
      compressed !== length ||
      ((d.getUint32(p + 38, true) >>> 16) & 0xf000) === 0xa000
    )
      throw new Error('UNSAFE_ZIP_ENTRY');
    const cap =
      name === 'manifest.json'
        ? 65536
        : name === 'styles.bin' || name === 'formatting.json' || name === 'media.json'
          ? 8 * 1024 * 1024
          : MAX_BYTES;
    if (length > cap || (total += length) > MAX_NATIVE) throw new Error('PAYLOAD_TOO_LARGE');
    if (
      local + 30 > p ||
      d.getUint32(local, true) !== 0x04034b50 ||
      d.getUint16(local + 6, true) !== flags ||
      d.getUint16(local + 8, true) !== method ||
      d.getUint32(local + 18, true) !== length ||
      d.getUint32(local + 22, true) !== length
    )
      throw new Error('ZIP_HEADER_MISMATCH');
    const ln = d.getUint16(local + 26, true),
      le = d.getUint16(local + 28, true),
      begin = local + 30 + ln + le;
    if (
      decoder.decode(bytes.subarray(local + 30, local + 30 + ln)) !== name ||
      begin + length > d.getUint32(end + 16, true)
    )
      throw new Error('ZIP_LOCAL_NAME');
    const payload = bytes.subarray(begin, begin + length);
    if (
      crc32(payload) !== d.getUint32(p + 16, true) ||
      d.getUint32(local + 14, true) !== d.getUint32(p + 16, true)
    )
      throw new Error('CRC_MISMATCH');
    entries[name] = payload;
    p += 46 + nameLength + extra + comment;
  }
  if (p !== centralEnd) throw new Error('ZIP_TRAILING');
  return entries;
}
export async function encodeNative(s: Snapshot): Promise<Uint8Array> {
  const text = s.text.encodeUtf8(),
    styles = encodeStyles(s.styles),
    formatting = s.formatting ?? new RichFormatting(),
    images = s.images ?? new ImageStore(),
    structured = formatting.structured,
    extended = formatting.extended,
    media = !images.empty || extended || structured,
    rich = !formatting.empty || media,
    formattingBytes = rich ? encoder.encode(JSON.stringify(formatting.toJSON())) : undefined,
    mediaBytes = media ? encoder.encode(JSON.stringify(images.toJSON())) : undefined,
    manifest: Manifest = {
      schemaVersion: structured ? 5 : extended ? 4 : media ? 3 : rich ? 2 : 1,
      textEncoding: 'utf-8',
      internalEol: 'LF',
      preferredExportEol: s.preferredExportEol,
      exportBom: s.exportBom,
      offsetUnit: 'utf16',
      utf8Bytes: text.length,
      utf16Length: s.text.length,
      logicalLines: s.text.lines,
      stylesEncoding: 'adaptive-v1',
      textSha256: await sha256(text),
      stylesSha256: await sha256(styles),
      ...(formattingBytes
        ? {
            formattingEncoding: structured
              ? ('sparse-v3' as const)
              : extended
                ? ('sparse-v2' as const)
                : ('sparse-v1' as const),
            formattingSha256: await sha256(formattingBytes),
          }
        : {}),
      ...(mediaBytes
        ? { mediaEncoding: 'embedded-v1' as const, mediaSha256: await sha256(mediaBytes) }
        : {}),
    };
  if (formattingBytes && formattingBytes.length > 8 * 1024 * 1024) throw new Error('FORMAT_LIMIT');
  if (mediaBytes && mediaBytes.length > 8 * 1024 * 1024) throw new Error('MEDIA_LIMIT');
  return zipStore({
    'manifest.json': encoder.encode(JSON.stringify(manifest)),
    'text.utf8': text,
    'styles.bin': styles,
    ...(formattingBytes ? { 'formatting.json': formattingBytes } : {}),
    ...(mediaBytes ? { 'media.json': mediaBytes } : {}),
  });
}
export async function decodeNative(bytes: Uint8Array): Promise<Snapshot> {
  const e = unzipStore(bytes),
    manifest = JSON.parse(decoder.decode(e['manifest.json'])) as Manifest;
  if (
    Object.keys(manifest).sort().join(',') !==
      (manifest.schemaVersion >= 3
        ? 'exportBom,formattingEncoding,formattingSha256,internalEol,logicalLines,mediaEncoding,mediaSha256,offsetUnit,preferredExportEol,schemaVersion,stylesEncoding,stylesSha256,textEncoding,textSha256,utf16Length,utf8Bytes'
        : manifest.schemaVersion === 2
          ? 'exportBom,formattingEncoding,formattingSha256,internalEol,logicalLines,offsetUnit,preferredExportEol,schemaVersion,stylesEncoding,stylesSha256,textEncoding,textSha256,utf16Length,utf8Bytes'
          : 'exportBom,internalEol,logicalLines,offsetUnit,preferredExportEol,schemaVersion,stylesEncoding,stylesSha256,textEncoding,textSha256,utf16Length,utf8Bytes') ||
    ![1, 2, 3, 4, 5].includes(manifest.schemaVersion) ||
    manifest.textEncoding !== 'utf-8' ||
    manifest.internalEol !== 'LF' ||
    manifest.offsetUnit !== 'utf16' ||
    manifest.stylesEncoding !== 'adaptive-v1' ||
    !['LF', 'CRLF'].includes(manifest.preferredExportEol) ||
    typeof manifest.exportBom !== 'boolean' ||
    !/^([a-f0-9]{64})$/.test(manifest.textSha256) ||
    !/^([a-f0-9]{64})$/.test(manifest.stylesSha256) ||
    (manifest.schemaVersion >= 2 &&
      (manifest.formattingEncoding !==
        (manifest.schemaVersion === 5
          ? 'sparse-v3'
          : manifest.schemaVersion === 4
            ? 'sparse-v2'
            : 'sparse-v1') ||
        !/^([a-f0-9]{64})$/.test(manifest.formattingSha256 ?? '') ||
        !e['formatting.json'])) ||
    (manifest.schemaVersion === 1 && Boolean(e['formatting.json'])) ||
    (manifest.schemaVersion >= 3 &&
      (manifest.mediaEncoding !== 'embedded-v1' ||
        !/^([a-f0-9]{64})$/.test(manifest.mediaSha256 ?? '') ||
        !e['media.json'])) ||
    (manifest.schemaVersion < 3 && Boolean(e['media.json']))
  )
    throw new Error('INVALID_MANIFEST');
  const raw = e['text.utf8']!,
    styleBytes = e['styles.bin']!,
    text = TextAdapter.from(decoder.decode(raw)),
    styles = decodeStyles(styleBytes);
  const formattingBytes = e['formatting.json'],
    mediaBytes = e['media.json'];
  if (
    text.length !== manifest.utf16Length ||
    text.lines !== manifest.logicalLines ||
    raw.length !== manifest.utf8Bytes ||
    styles.length !== text.length ||
    (await sha256(raw)) !== manifest.textSha256 ||
    (await sha256(styleBytes)) !== manifest.stylesSha256 ||
    (formattingBytes && (await sha256(formattingBytes)) !== manifest.formattingSha256) ||
    (mediaBytes && (await sha256(mediaBytes)) !== manifest.mediaSha256)
  )
    throw new Error('NATIVE_MISMATCH');
  // Stream segmentation one line/chunk at a time; carry the final cluster across chunk boundaries.
  if (styles.node?.andMask !== styles.node?.orMask) {
    let base = 0,
      carry = '';
    for (const chunk of text.chunks()) {
      if (!carry && /^[\x00-\x7f]*$/.test(chunk)) {
        base += chunk.length;
        continue;
      }
      const segment = carry + chunk;
      let last: { from: number; to: number } | undefined;
      for (const g of graphemes(segment)) {
        if (last) check(last, segment, base, styles);
        last = g;
      }
      if (last) {
        carry = segment.slice(last.from);
        base += last.from;
      }
    }
    if (carry) check({ from: 0, to: carry.length }, carry, base, styles);
  }
  return {
    text,
    styles,
    formatting: formattingBytes
      ? RichFormatting.parse(
          JSON.parse(decoder.decode(formattingBytes)),
          text,
          manifest.schemaVersion >= 4,
          manifest.schemaVersion === 5,
        )
      : new RichFormatting(),
    images: mediaBytes
      ? ImageStore.parse(JSON.parse(decoder.decode(mediaBytes)), text)
      : new ImageStore(),
    contentToken: crypto.randomUUID(),
    localRevision: 0,
    preferredExportEol: manifest.preferredExportEol,
    exportBom: manifest.exportBom,
  };
}
function check(g: { from: number; to: number }, _s: string, base: number, styles: StyleTree): void {
  if (g.to - g.from <= 1) return;
  const p = styles.slice(base + g.from, base + g.to);
  if (p.node?.andMask !== p.node?.orMask) throw new Error('GRAPHEME_STYLE_MISMATCH');
}
export function importTxt(bytes: Uint8Array): Snapshot {
  if (bytes.length > 12 * 1024 * 1024) throw new Error('RAW_TXT_TOO_LARGE');
  const bom = bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191,
    raw = decoder.decode(bom ? bytes.subarray(3) : bytes),
    eol = raw.includes('\r\n') ? 'CRLF' : 'LF',
    text = TextAdapter.from(raw.replace(/\r\n?/g, '\n'));
  return {
    text,
    styles: StyleTree.uniform(text.length),
    contentToken: crypto.randomUUID(),
    localRevision: 0,
    preferredExportEol: eol,
    exportBom: bom,
  };
}
export function exportTxt(s: Snapshot): Uint8Array {
  let plain = s.text.slice();
  for (const image of [...(s.images?.images ?? [])].reverse())
    if (plain[image.from] === IMAGE_PLACEHOLDER)
      plain = plain.slice(0, image.from) + '[Image]' + plain.slice(image.from + 1);
  return encoder.encode(
    (s.exportBom ? '\ufeff' : '') +
      (s.preferredExportEol === 'CRLF' ? plain.replace(/\n/g, '\r\n') : plain),
  );
}

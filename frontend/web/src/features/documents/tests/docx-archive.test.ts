import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { readDocxArchive } from '../model/docxArchive';
import { readImportedFile } from '../model/importFile';

const fixture = (extra: Record<string, Uint8Array> = {}) =>
  zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8('<document>Tiếng Việt 👋</document>'),
    ...extra,
  });
describe('DOCX package boundaries', () => {
  it('reports the DOCX input limit before attempting to parse an oversized Word file', async () => {
    const file = new File([new Uint8Array(16777217)], 'too-large.DOCX');
    await expect(readImportedFile(file)).rejects.toThrow('docxLimit');
  });
  it('reads compressed Unicode Word parts and checks their CRC', () => {
    const parts = readDocxArchive(fixture());
    expect(new TextDecoder().decode(parts['word/document.xml'])).toContain('Tiếng Việt 👋');
  });
  it('rejects non ZIP data and truncated archives', () => {
    expect(() => readDocxArchive(strToU8('plain text'))).toThrow('docxInvalid');
    expect(() => readDocxArchive(fixture().slice(0, -5))).toThrow('docxInvalid');
  });
  it('checks compressed expansion sizes before decompression', () => {
    const bytes = fixture();
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < bytes.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 33554433, true);
        break;
      }
    }
    expect(() => readDocxArchive(bytes)).toThrow('docxLimit');
  });
  it('rejects archives larger than the input bound', () => {
    expect(() => readDocxArchive(new Uint8Array(16777217))).toThrow('docxLimit');
  });
  it('rejects actual expansion beyond a forged declared size', () => {
    const bytes = fixture();
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < bytes.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 1, true);
        break;
      }
    }
    expect(() => readDocxArchive(bytes)).toThrow('docxInvalid');
  });
  it('rejects paths outside the Word package and embedded executable content', () => {
    expect(() => readDocxArchive(fixture({ '../escape': strToU8('bad') }))).toThrow('docxInvalid');
    expect(() => readDocxArchive(fixture({ 'word/vbaProject.bin': strToU8('bad') }))).toThrow(
      'docxUnsupported',
    );
  });
  it('rejects corrupt entry bytes instead of importing partial content', () => {
    const bytes = zipSync(
      {
        '[Content_Types].xml': strToU8('<Types/>'),
        'word/document.xml': strToU8('<document>text</document>'),
      },
      { level: 0 },
    );
    const marker = new TextDecoder().decode(bytes).indexOf('<document>');
    bytes[marker + 10] = bytes[marker + 10]! ^ 1;
    expect(() => readDocxArchive(bytes)).toThrow('docxInvalid');
  });
});

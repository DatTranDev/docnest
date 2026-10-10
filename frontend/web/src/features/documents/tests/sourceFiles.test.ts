import { describe, expect, it } from 'vitest';
import { decodeNative, encodeNative, exportTxt } from '@ted/editor-core';
import { readImportedFile } from '../model/importFile';
import { sourceFileType } from '../model/sourceFiles';

function file(name: string, text: string) {
  const bytes = new TextEncoder().encode(text);
  return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer } as File;
}
describe('managed source files', () => {
  it('identifies filenames and leaves rich/native files on the existing editor', () => {
    expect(sourceFileType('Guide.MD')).toBe('markdown');
    expect(sourceFileType('settings.json')).toBe('json');
    for (const extension of ['js', 'ts', 'jsx', 'tsx', 'py', 'html', 'css'])
      expect(sourceFileType(`code.${extension}`)).toBe('code');
    expect(sourceFileType('Notes')).toBeNull();
    expect(sourceFileType('Notes.tedoc')).toBeNull();
    expect(sourceFileType('file.exe')).toBeNull();
  });
  it('retains Unicode, BOM/CRLF, code and large JSON literals through the native codec', async () => {
    for (const [name, text] of [
      ['guide.md', '\uFEFF# Việt 👋\r\n\r\n```ts\r\nconst x = 1;\r\n```\r\n'],
      ['data.json', '{"id":900719925474099312345,"n":1.234567890123e+42}\n'],
      ['script.tsx', 'const App = () => <main>Việt</main>;\n'],
    ] as const) {
      const snapshot = await readImportedFile(file(name, text));
      const reopened = await decodeNative(await encodeNative(snapshot));
      expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(exportTxt(reopened))).toBe(text);
    }
  });
  it('rejects oversized or malformed UTF-8 source imports', async () => {
    await expect(readImportedFile({ name: 'data.json', size: 1048577 } as File)).rejects.toThrow();
    await expect(
      readImportedFile({
        name: 'data.json',
        size: 1,
        arrayBuffer: async () => Uint8Array.of(0xff).buffer,
      } as File),
    ).rejects.toThrow();
  });
});

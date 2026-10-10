import { decodeNative, importTxt, type Snapshot } from '@ted/editor-core';
import { MESSAGE } from '@/lib/i18n';
import { sourceFileType } from './sourceFiles';

export async function readImportedFile(file: File): Promise<Snapshot> {
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  const source = sourceFileType(file.name);
  if (!source && !['txt', 'tedoc', 'docx'].includes(extension ?? ''))
    throw new Error(MESSAGE.fileTypeUnsupported);
  if (file.size > (source ? 1048576 : extension === 'docx' ? 16777216 : 33554432))
    throw new Error(extension === 'docx' ? MESSAGE.docxLimit : MESSAGE.fileTooLarge);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (extension === 'tedoc') return decodeNative(bytes);
  if (extension === 'docx') {
    try {
      return await (await import('./importDocx')).importDocx(bytes);
    } catch (error) {
      if (
        error instanceof Error &&
        [MESSAGE.docxInvalid, MESSAGE.docxUnsupported, MESSAGE.docxLimit].includes(
          error.message as typeof MESSAGE.docxInvalid,
        )
      )
        throw error;
      throw new Error(MESSAGE.docxInvalid);
    }
  }
  return importTxt(bytes);
}

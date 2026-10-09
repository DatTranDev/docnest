import { MESSAGE } from '@/lib/i18n/messages';
export const EXPORT_FORMATS = {
  EXPORT_TXT: { extension: 'txt', mime: 'text/plain', label: MESSAGE.exportTxt },
  EXPORT_HTML: { extension: 'html', mime: 'text/html', label: MESSAGE.exportHtml },
  EXPORT_DOCX: {
    extension: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    label: MESSAGE.exportDocx,
  },
  EXPORT_PDF: { extension: 'pdf', mime: 'application/pdf', label: MESSAGE.exportPdf },
} as const;

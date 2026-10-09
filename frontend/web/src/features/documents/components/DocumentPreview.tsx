'use client';
import { MESSAGE, useI18n } from '@/lib/i18n';
import type { DocumentInfo } from '../model/types';
export function DocumentPreview({ document: d }: { document: DocumentInfo }) {
  const { t, countLabel } = useI18n();

  const summary = d.preview;
  if (!summary || typeof summary.sampleText !== 'string') return null;
  return (
    <span
      className="file-preview muted"
      aria-label={t(MESSAGE.previewOfValue, { p0: d.title })}
      title={summary.sampleText}
    >
      {Array.from(summary.sampleText).slice(0, 160).join('').replace(/\s+/g, ' ')}
      {typeof summary.wordCount === 'number' && (
        <small> · {countLabel(summary.wordCount, 'words')}</small>
      )}
    </span>
  );
}

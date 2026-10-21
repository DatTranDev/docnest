'use client';
import { Icon } from '@/components/ui/Icon';
import { MESSAGE, useI18n } from '@/lib/i18n';
import type { DocumentInfo } from '../model/types';
import { sourceFileType } from '../model/sourceFiles';
export function DocumentPreview({
  document: d,
  paper = false,
}: {
  document: DocumentInfo;
  paper?: boolean;
}) {
  const { t, countLabel } = useI18n();

  const summary = d.preview;
  if (!summary || typeof summary.sampleText !== 'string' || !summary.sampleText.trim()) {
    const kind = sourceFileType(d.title) ?? 'document';
    const emptyMessage = {
      document: MESSAGE.emptyDocument,
      markdown: MESSAGE.emptyMarkdown,
      code: MESSAGE.emptyCode,
      json: MESSAGE.emptyJson,
    }[kind];
    return paper ? (
      <span className={`preview-placeholder preview-placeholder-${kind}`}>
        <span className="preview-placeholder-icon" aria-hidden="true">
          <Icon name={kind} size={25} />
        </span>
        {t(d.headRevision === 0 ? emptyMessage : MESSAGE.previewUnavailable)}
      </span>
    ) : null;
  }
  return (
    <span
      className={paper ? 'document-paper' : 'file-preview muted'}
      aria-label={t(MESSAGE.previewOfValue, { p0: d.title })}
      title={summary.sampleText}
    >
      {paper
        ? Array.from(summary.sampleText).slice(0, 600).join('')
        : Array.from(summary.sampleText).slice(0, 160).join('').replace(/\s+/g, ' ')}
      {!paper && typeof summary.wordCount === 'number' && (
        <small> · {countLabel(summary.wordCount, 'words')}</small>
      )}
    </span>
  );
}

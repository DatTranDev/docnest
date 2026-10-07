import type { DocumentInfo } from '../model/types';
export function DocumentPreview({ document: d }: { document: DocumentInfo }) {
  const summary = d.preview;
  if (!summary || typeof summary.sampleText !== 'string') return null;
  return (
    <span
      className="file-preview muted"
      aria-label={`Bản xem trước ${d.title}`}
      title={summary.sampleText}
    >
      {Array.from(summary.sampleText).slice(0, 160).join('').replace(/\s+/g, ' ')}
      {typeof summary.wordCount === 'number' && (
        <small> · {summary.wordCount.toLocaleString()} từ</small>
      )}
    </span>
  );
}

'use client';
import { MESSAGE, useI18n } from '@/lib/i18n';

import { useEffect, useRef, useState } from 'react';
import { PAGE_PREVIEW } from '../model/constants';
import Image from 'next/image';
import { listOrdinal, type EditorModel, type PlacedImage } from '@ted/editor-core';

const MAX_PREVIEW_UNITS = PAGE_PREVIEW.maxTextUnits;
const PAGE_PITCH = PAGE_PREVIEW.widthPx + PAGE_PREVIEW.gapPx;

export function PagedPreview({
  model,
  imageUrl,
  onClose,
}: {
  model: EditorModel;
  imageUrl: (image: PlacedImage) => string;
  onClose: () => void;
}) {
  const { t, countLabel } = useI18n();

  const ref = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(1);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () =>
      setPages(
        Math.max(1, Math.ceil((node.scrollWidth - PAGE_PREVIEW.horizontalPaddingPx) / PAGE_PITCH)),
      );
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, []);
  if (model.text.length > MAX_PREVIEW_UNITS)
    return (
      <div className="page-preview-limit" role="dialog" aria-label={t(MESSAGE.pagePreview)}>
        <button onClick={onClose}>{t(MESSAGE.closePagePreview)}</button>
        <p>{t(MESSAGE.thisFileIsTooLongToPaginateIn)} </p>
      </div>
    );
  const lines = [];
  for (let number = 1; number <= model.text.lines; number++) {
    const line = model.text.text.line(number);
    const points = new Set([line.from, line.to]);
    for (const run of model.styles.queryRuns(line.from, line.to)) {
      points.add(run.from);
      points.add(run.to);
    }
    for (const run of model.formatting.query(line.from, line.to)) {
      points.add(run.from);
      points.add(run.to);
    }
    for (const image of model.images.query(line.from, line.to)) {
      points.add(image.from);
      points.add(image.from + 1);
    }
    const boundaries = [...points].sort((a, b) => a - b);
    const segments = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const from = boundaries[i]!,
        to = boundaries[i + 1]!;
      const image = model.images.at(from);
      if (image) {
        segments.push(
          <Image
            key={from}
            className="page-preview-image"
            alt={t(MESSAGE.imageInDocument)}
            src={imageUrl(image)}
            width={image.width}
            height={image.height}
            unoptimized
          />,
        );
        continue;
      }
      const mask = model.styles.maskAt(from),
        rich = model.formatting.at(from);
      const segment = (
        <span
          key={from}
          style={{
            fontFamily: rich.font,
            fontSize: rich.script
              ? rich.size
                ? `${rich.size * 0.75}pt`
                : '0.75em'
              : rich.size
                ? `${rich.size}pt`
                : undefined,
            color: rich.color,
            backgroundColor: rich.background ?? undefined,
            verticalAlign: rich.script === 'normal' ? undefined : rich.script,
            fontWeight: mask & 1 ? 700 : undefined,
            fontStyle: mask & 2 ? 'italic' : undefined,
            textDecoration:
              [mask & 4 ? 'underline' : '', rich.strike ? 'line-through' : '']
                .filter(Boolean)
                .join(' ') || undefined,
          }}
        >
          {model.text.slice(from, to)}
        </span>
      );
      segments.push(
        rich.link ? (
          <a key={from} href={rich.link} target="_blank" rel="noopener noreferrer">
            {segment}
          </a>
        ) : (
          segment
        ),
      );
    }
    const paragraph = model.formatting.paragraphAt(line.from);
    lines.push(
      <div
        className="page-preview-line"
        key={number}
        style={{
          textAlign: paragraph.align,
          paddingLeft: `${(paragraph.indent ?? 0) * 24}px`,
          lineHeight: paragraph.lineSpacing ?? 1.15,
          marginTop: `${paragraph.spaceBefore ?? 0}pt`,
          marginBottom: `${paragraph.spaceAfter ?? 0}pt`,
          breakBefore: paragraph.pageBreak && !paragraph.table ? 'column' : undefined,
        }}
      >
        {paragraph.list && (
          <span className="page-list-marker">
            {paragraph.list === 'bullet'
              ? '•'
              : `${listOrdinal(model.formatting.paragraphs, model.text, line.from)}.`}{' '}
          </span>
        )}
        {segments.length ? segments : '\u00a0'}
      </div>,
    );
  }
  const blocks = [];
  for (let i = 0; i < lines.length;) {
    const p = model.formatting.paragraphAt(model.text.text.line(i + 1).from);
    if (!p.table) {
      blocks.push(lines[i++]);
      continue;
    }
    const table = p.table,
      cells: import('react').ReactNode[] = [];
    let j = i;
    while (
      j < lines.length &&
      model.formatting.paragraphAt(model.text.text.line(j + 1).from).table?.id === table.id &&
      (j === i || !model.formatting.paragraphAt(model.text.text.line(j + 1).from).pageBreak)
    )
      cells.push(lines[j++]);
    const rows = [];
    for (let c = 0; c < cells.length; c += table.columns)
      rows.push(
        <tr key={c}>
          {Array.from({ length: table.columns }, (_, k) => (
            <td key={k}>{cells[c + k] ?? '\u00a0'}</td>
          ))}
        </tr>,
      );
    blocks.push(
      <table
        key={`table-${i}`}
        className="page-preview-table"
        style={{ breakBefore: p.pageBreak ? 'column' : undefined }}
      >
        <tbody>{rows}</tbody>
      </table>,
    );
    i = j;
  }
  return (
    <div className="page-preview" role="dialog" aria-label={t(MESSAGE.pagePreview)}>
      <div className="page-preview-bar">
        <strong>{t(MESSAGE.pagePreview)}</strong>
        <span>{countLabel(pages, 'pages')}</span>
        <button onClick={onClose}>{t(MESSAGE.backToEditing)}</button>
      </div>
      <div className="page-preview-scroll">
        <div className="page-preview-stage" style={{ width: pages * PAGE_PITCH }}>
          {Array.from({ length: pages }, (_, index) => (
            <div className="page-preview-sheet" key={index} style={{ left: index * PAGE_PITCH }}>
              <header>{model.formatting.page.header}</header>
              <footer>
                <span>{model.formatting.page.footer}</span>
                {model.formatting.page.pageNumbers && <span>{index + 1}</span>}
              </footer>
            </div>
          ))}
          <div className="page-preview-flow" ref={ref}>
            {blocks}
          </div>
        </div>
      </div>
    </div>
  );
}

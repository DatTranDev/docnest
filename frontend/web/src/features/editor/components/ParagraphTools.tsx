'use client';
import { useState, type RefObject } from 'react';
import type { ParagraphFormat, PageSettings } from '@ted/editor-core';
import { MESSAGE, useI18n } from '@/lib/i18n';
import type { EditorController } from '../model/EditorController';
export function ParagraphTools({
  controller,
  paragraph,
  page,
  readOnly,
  onError,
}: {
  controller: RefObject<EditorController | null>;
  paragraph: Readonly<ParagraphFormat>;
  page: Readonly<PageSettings>;
  readOnly: boolean;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<'link' | 'table' | 'page' | null>(null);
  const [link, setLink] = useState(''),
    [rows, setRows] = useState(2),
    [columns, setColumns] = useState(2);
  const [header, setHeader] = useState(''),
    [footer, setFooter] = useState(''),
    [numbers, setNumbers] = useState(false);
  const run = (action: () => void) => {
    try {
      action();
      setDialog(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'INVALID_FORMAT');
    }
  };
  return (
    <>
      <div className="tool-group paragraph-tools" aria-label={t(MESSAGE.paragraphFormat)}>
        <button
          disabled={readOnly}
          aria-pressed={paragraph.list === 'bullet'}
          title={t(MESSAGE.bulletList)}
          aria-label={t(MESSAGE.bulletList)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            controller.current?.formatParagraph({
              list: paragraph.list === 'bullet' ? undefined : 'bullet',
            })
          }
        >
          • ≡
        </button>
        <button
          disabled={readOnly}
          aria-pressed={paragraph.list === 'number'}
          title={t(MESSAGE.numberedList)}
          aria-label={t(MESSAGE.numberedList)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            controller.current?.formatParagraph({
              list: paragraph.list === 'number' ? undefined : 'number',
            })
          }
        >
          1. ≡
        </button>
        <button
          disabled={readOnly || !paragraph.indent}
          aria-label={t(MESSAGE.decreaseIndent)}
          title={t(MESSAGE.decreaseIndent)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            controller.current?.formatParagraph({
              indent: Math.max(0, (paragraph.indent ?? 0) - 1),
            })
          }
        >
          ← ≡
        </button>
        <button
          disabled={readOnly || (paragraph.indent ?? 0) >= 8}
          aria-label={t(MESSAGE.increaseIndent)}
          title={t(MESSAGE.increaseIndent)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            controller.current?.formatParagraph({
              indent: Math.min(8, (paragraph.indent ?? 0) + 1),
            })
          }
        >
          → ≡
        </button>
        <select
          disabled={readOnly}
          aria-label={t(MESSAGE.lineSpacing)}
          value={paragraph.lineSpacing ?? 1.15}
          onChange={(e) =>
            controller.current?.formatParagraph({ lineSpacing: Number(e.target.value) })
          }
        >
          {[1, 1.15, 1.5, 2, 2.5, 3].map((n) => (
            <option key={n} value={n}>
              {n}×
            </option>
          ))}
        </select>
        <select
          disabled={readOnly}
          aria-label={t(MESSAGE.paragraphSpacing)}
          value={paragraph.spaceAfter ?? 0}
          onChange={(e) =>
            controller.current?.formatParagraph({ spaceAfter: Number(e.target.value) })
          }
        >
          {[0, 6, 12, 18, 24].map((n) => (
            <option key={n} value={n}>
              {n} pt
            </option>
          ))}
        </select>
      </div>
      <details className="tool-menu">
        <summary>{t(MESSAGE.insertContent)}</summary>
        <div
          className="tool-menu-panel"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('button'))
              event.currentTarget.parentElement?.removeAttribute('open');
          }}
        >
          <button
            disabled={readOnly}
            onClick={() => {
              setLink(String(controller.current?.model.pendingFormat.link ?? ''));
              setDialog('link');
            }}
          >
            {t(MESSAGE.hyperlink)}
          </button>
          <button disabled={readOnly} onClick={() => setDialog('table')}>
            {t(MESSAGE.insertTable)}
          </button>
          <button
            disabled={readOnly}
            onClick={() => run(() => controller.current?.insertPageBreak())}
          >
            {t(MESSAGE.pageBreak)}
          </button>
          <button
            disabled={readOnly || !paragraph.pageBreak}
            onClick={() => controller.current?.formatParagraph({ pageBreak: false })}
          >
            {t(MESSAGE.removePageBreak)}
          </button>
          <button
            disabled={readOnly}
            onClick={() => {
              setHeader(page.header ?? '');
              setFooter(page.footer ?? '');
              setNumbers(page.pageNumbers ?? false);
              setDialog('page');
            }}
          >
            {t(MESSAGE.headerFooter)}
          </button>
          <button
            disabled={readOnly || !paragraph.table}
            onClick={() => controller.current?.formatParagraph({ table: null })}
          >
            {t(MESSAGE.removeTableCell)}
          </button>
        </div>
      </details>
      {dialog && (
        <div className="modal">
          <form
            className="dialog structure-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t(
              dialog === 'link'
                ? MESSAGE.hyperlink
                : dialog === 'table'
                  ? MESSAGE.insertTable
                  : MESSAGE.headerFooter,
            )}
            onSubmit={(e) => {
              e.preventDefault();
              run(() => {
                if (dialog === 'link') controller.current?.formatCharacter({ link: link || null });
                if (dialog === 'table') controller.current?.insertTable(rows, columns);
                if (dialog === 'page')
                  controller.current?.setPage({ header, footer, pageNumbers: numbers });
              });
            }}
          >
            <h2>
              {t(
                dialog === 'link'
                  ? MESSAGE.hyperlink
                  : dialog === 'table'
                    ? MESSAGE.insertTable
                    : MESSAGE.headerFooter,
              )}
            </h2>
            {dialog === 'link' && (
              <>
                <label>
                  {t(MESSAGE.linkAddress)}
                  <input
                    autoFocus
                    type="url"
                    value={link}
                    placeholder="https://example.com"
                    maxLength={2048}
                    onChange={(e) => setLink(e.target.value)}
                  />
                </label>
                <p>{t(MESSAGE.linkHint)}</p>
              </>
            )}
            {dialog === 'table' && (
              <>
                <label>
                  {t(MESSAGE.tableRows)}
                  <input
                    autoFocus
                    type="number"
                    min={1}
                    max={20}
                    value={rows}
                    onChange={(e) => setRows(Number(e.target.value))}
                  />
                </label>
                <label>
                  {t(MESSAGE.tableColumns)}
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={columns}
                    onChange={(e) => setColumns(Number(e.target.value))}
                  />
                </label>
                <p>{t(MESSAGE.tableHint)}</p>
              </>
            )}
            {dialog === 'page' && (
              <>
                <label>
                  {t(MESSAGE.pageHeader)}
                  <input
                    autoFocus
                    maxLength={500}
                    value={header}
                    onChange={(e) => setHeader(e.target.value)}
                  />
                </label>
                <label>
                  {t(MESSAGE.pageFooter)}
                  <input
                    maxLength={500}
                    value={footer}
                    onChange={(e) => setFooter(e.target.value)}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={numbers}
                    onChange={(e) => setNumbers(e.target.checked)}
                  />
                  {t(MESSAGE.pageNumbers)}
                </label>
              </>
            )}
            <div className="dialog-actions">
              <button type="button" onClick={() => setDialog(null)}>
                {t(MESSAGE.cancel)}
              </button>
              <button className="primary" type="submit">
                {t(MESSAGE.applyFormat)}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

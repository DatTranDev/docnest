'use client';
import { useEffect, useMemo, useRef, useState, type RefObject, type ReactNode } from 'react';
import { EditorState } from '@codemirror/state';
import { lineNumbers } from '@codemirror/view';
import { syntaxHighlighting } from '@codemirror/language';
import { classHighlighter } from '@lezer/highlight';
import { exportTxt } from '@ted/editor-core';
import type { ActiveDocument } from '@/features/documents';
import type { EditorController } from '@/features/editor';
import { MESSAGE, useI18n } from '@/lib/i18n';
import { download } from '@/lib/http';
import { useToolsCopy } from '../model/copy';
import { languageSupport } from '../model/syntax';
import { SOURCE_LIMIT } from '../model/json';
import type { SourceHandle } from './SourceEditor';
import { MarkdownPreview } from './MarkdownPreview';
import { useMarkdownScrollSync } from './useMarkdownScrollSync';
import { JsonPanels } from './JsonPanels';

export function SourceFilePane({
  active,
  status,
  saving,
  online,
  controllerRef,
  hostRef,
  onSave,
  onHistory,
  onShare,
  onError,
  recovery,
}: {
  active: ActiveDocument;
  status: string;
  saving: boolean;
  online: boolean;
  controllerRef: RefObject<EditorController | null>;
  hostRef: RefObject<HTMLDivElement | null>;
  onSave: () => Promise<void>;
  onHistory: () => void;
  onShare: () => void;
  onError: (value: string) => void;
  recovery: ReactNode;
}) {
  const copy = useToolsCopy(),
    { t, localize } = useI18n();
  const extension = active.document.title.split('.').at(-1)?.toLowerCase() ?? '';
  const kind = ['md', 'markdown'].includes(extension)
    ? 'markdown'
    : extension === 'json'
      ? 'json'
      : 'code';
  const [view, setView] = useState('split');
  const [ready, setReady] = useState(0),
    [notice, setNotice] = useState('');
  const geometryRef = useRef<Pick<SourceHandle, 'scrollDOM' | 'lineTop'> | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const scratchDirty = useRef(false);
  const text = active.model.text;
  const source = useMemo(() => text.slice(), [text]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const controller = controllerRef.current;
      if (!controller || controller.model !== active.model) return;
      controller.setSourceSyntax([
        languageSupport(extension) ?? [],
        lineNumbers(),
        syntaxHighlighting(classHighlighter),
        EditorState.transactionFilter.of((transaction) => {
          if (transaction.docChanged && transaction.newDoc.length > SOURCE_LIMIT) {
            queueMicrotask(() => onError(copy.sourceLimit));
            return [];
          }
          return transaction;
        }),
      ]);
      const editor = controller.view;
      geometryRef.current = {
        scrollDOM: editor.scrollDOM,
        lineTop: (line) =>
          editor.lineBlockAt(
            editor.state.doc.line(Math.max(1, Math.min(line, editor.state.doc.lines))).from,
          ).top + editor.documentPadding.top,
      };
      setReady((value) => value + 1);
    });
    return () => {
      cancelAnimationFrame(frame);
      geometryRef.current = null;
    };
  }, [controllerRef, active.model, active.readOnly, extension, onError, copy.sourceLimit]);
  useMarkdownScrollSync(
    geometryRef,
    previewRef,
    `${ready}:${source}`,
    kind === 'markdown' && view === 'split' && ready > 0 && source.length <= 200_000,
  );
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (active.model.dirty || scratchDirty.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [active.model]);
  const editor = <div className="source-editor cloud-source-editor" ref={hostRef} />;
  function replace(value: string) {
    if (active.readOnly) return;
    const controller = controllerRef.current;
    if (controller)
      controller.view.dispatch({
        changes: { from: 0, to: controller.view.state.doc.length, insert: value },
        userEvent: 'input',
      });
  }
  return (
    <section
      className="source-file-pane local-site"
      aria-label={active.document.title}
      inert={status === MESSAGE.opening}
    >
      <div className="source-file-heading">
        <div>
          <h2>{active.document.title}</h2>
          <span role="status">{localize(status)}</span>
        </div>
        <button
          className="primary"
          disabled={active.readOnly || saving || !online}
          onClick={() => void onSave()}
        >
          {t(MESSAGE.save)}
        </button>
        <button
          onClick={() =>
            download(
              exportTxt(active.model.snapshot()),
              active.document.title,
              kind === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8',
            )
          }
        >
          {copy.download}
        </button>
        <button onClick={onHistory}>{t(MESSAGE.versionHistory)}</button>
        <button onClick={onShare}>{t(MESSAGE.share)}</button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {recovery}
      {kind === 'json' ? (
        <JsonPanels
          source={source}
          name={active.document.title}
          readOnly={active.readOnly}
          onApply={replace}
          onError={onError}
          onStatus={setNotice}
          onDirty={() => {
            scratchDirty.current = true;
          }}
        >
          {editor}
        </JsonPanels>
      ) : (
        <>
          <div className="source-toolbar">
            <button disabled={active.readOnly} onClick={() => controllerRef.current?.undo()}>
              {copy.undo}
            </button>
            <button disabled={active.readOnly} onClick={() => controllerRef.current?.redo()}>
              {copy.redo}
            </button>
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText(source)
                  .then(() => setNotice(copy.copied))
                  .catch(() => onError(copy.error))
              }
            >
              {copy.clipboard}
            </button>
            {kind === 'markdown' && (
              <div className="local-view-switch">
                {(['source', 'split', 'preview'] as const).map((value) => (
                  <button key={value} aria-pressed={view === value} onClick={() => setView(value)}>
                    {copy[value]}
                  </button>
                ))}
              </div>
            )}
          </div>
          {kind === 'markdown' ? (
            <div className={`markdown-split view-${view}`}>
              <div className="source-pane" hidden={view === 'preview'}>
                <div className="pane-label">{copy.source}</div>
                {editor}
              </div>
              <div className="preview-column" hidden={view === 'source'}>
                <div className="pane-label">{copy.preview}</div>
                <div className="preview-pane" ref={previewRef}>
                  {source.length <= 200_000 ? (
                    <MarkdownPreview source={source} sourceMap />
                  ) : (
                    <p>{copy.sourceLimit}</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            editor
          )}
        </>
      )}
    </section>
  );
}

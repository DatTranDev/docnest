'use client';
import { useEffect, useMemo, useRef, useState, type RefObject, type ReactNode } from 'react';
import { EditorState } from '@codemirror/state';
import { lineNumbers } from '@codemirror/view';
import { syntaxHighlighting } from '@codemirror/language';
import { classHighlighter } from '@lezer/highlight';
import { exportTxt, type Snapshot } from '@ted/editor-core';
import type { ActiveDocument } from '@/features/documents';
import type { EditorController } from '@/features/editor';
import { MESSAGE, useI18n } from '@/lib/i18n';
import { EditableTitle } from '@/components/ui/EditableTitle';
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
  onCopy,
  onHistory,
  onBackToCurrent,
  onShare,
  onRename,
  onError,
  recovery,
  kindOverride,
}: {
  active: ActiveDocument;
  status: string;
  saving: boolean;
  online: boolean;
  controllerRef: RefObject<EditorController | null>;
  hostRef: RefObject<HTMLDivElement | null>;
  onSave: () => Promise<void>;
  onCopy: (snapshot: Snapshot, suggestedTitle?: string) => Promise<void>;
  onHistory: () => void;
  onBackToCurrent: () => void;
  onShare: () => void;
  onRename: (title: string) => Promise<void>;
  onError: (value: string) => void;
  recovery: ReactNode;
  kindOverride?: 'markdown' | 'code' | 'json';
}) {
  const copy = useToolsCopy(),
    { t, localize } = useI18n();
  const extension = active.document.title.split('.').at(-1)?.toLowerCase() ?? '';
  const kind =
    kindOverride ??
    (['md', 'markdown'].includes(extension) ? 'markdown' : extension === 'json' ? 'json' : 'code');
  const [view, setView] = useState('split');
  const [syntaxLanguage, setSyntaxLanguage] = useState(
    kind === 'code' && ['js', 'ts', 'jsx', 'tsx', 'py', 'html', 'css'].includes(extension)
      ? extension
      : kind === 'code'
        ? 'javascript'
        : kind,
  );
  useEffect(() => {
    const mobile = matchMedia('(max-width: 650px)');
    const selectSource = () => {
      if (mobile.matches) setView((current) => (current === 'split' ? 'source' : current));
    };
    selectSource();
    mobile.addEventListener('change', selectSource);
    return () => mobile.removeEventListener('change', selectSource);
  }, []);
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
        languageSupport(syntaxLanguage) ?? [],
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
  }, [controllerRef, active.model, active.readOnly, syntaxLanguage, onError, copy.sourceLimit]);
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
  function wrapMarkdown(before: string, after = '', placeholder = '') {
    const controller = controllerRef.current;
    if (!controller || active.readOnly) return;
    const editor = controller.view;
    const selection = editor.state.selection.main;
    const text = editor.state.sliceDoc(selection.from, selection.to) || placeholder;
    editor.dispatch({
      changes: { from: selection.from, to: selection.to, insert: before + text + after },
      selection: {
        anchor: selection.from + before.length,
        head: selection.from + before.length + text.length,
      },
      userEvent: 'input',
    });
    editor.focus();
    setView('source');
  }
  function prefixMarkdown(prefix: string) {
    const controller = controllerRef.current;
    if (!controller || active.readOnly) return;
    const editor = controller.view;
    const selection = editor.state.selection.main;
    const from = editor.state.doc.lineAt(selection.from).from;
    const text = editor.state.sliceDoc(from, selection.to).replace(/^/gm, prefix);
    editor.dispatch({ changes: { from, to: selection.to, insert: text }, userEvent: 'input' });
    editor.focus();
    setView('source');
  }
  return (
    <section
      className={`source-file-pane local-site${active.revision !== undefined ? ' historical-view' : ''}`}
      aria-label={active.document.title}
      inert={status === MESSAGE.opening}
    >
      <div className="source-file-heading">
        <div>
          <EditableTitle
            title={active.document.title}
            label={t(MESSAGE.rename)}
            level={2}
            editable={!active.readOnly && active.revision === undefined}
            onRename={onRename}
          />
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
        {active.revision !== undefined && (
          <>
            <button onClick={onBackToCurrent}>{t(MESSAGE.backToCurrent)}</button>
            <button
              onClick={() => {
                const dot = active.document.title.lastIndexOf('.');
                const title =
                  dot > 0
                    ? `${t(MESSAGE.valueCopy, { p0: active.document.title.slice(0, dot) })}${active.document.title.slice(dot)}`
                    : t(MESSAGE.valueCopy, { p0: active.document.title });
                void onCopy(active.model.snapshot(), title);
              }}
            >
              {t(MESSAGE.saveAsNewDocument)}
            </button>
          </>
        )}
        {active.revision === undefined && active.document.effectiveRole === 'OWNER' && (
          <button onClick={onShare}>{t(MESSAGE.share)}</button>
        )}
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
            {kind === 'markdown' && (
              <div className="markdown-format-buttons">
                <button
                  disabled={active.readOnly}
                  aria-label={copy.bold}
                  onClick={() => wrapMarkdown('**', '**', 'text')}
                >
                  <b>B</b>
                </button>
                <button
                  disabled={active.readOnly}
                  aria-label={copy.italic}
                  onClick={() => wrapMarkdown('*', '*', 'text')}
                >
                  <i>I</i>
                </button>
                <button
                  disabled={active.readOnly}
                  aria-label={copy.heading}
                  onClick={() => prefixMarkdown('## ')}
                >
                  {copy.heading}
                </button>
                <button
                  disabled={active.readOnly}
                  aria-label={copy.list}
                  onClick={() => prefixMarkdown('- ')}
                >
                  • ≡
                </button>
                <button
                  disabled={active.readOnly}
                  aria-label={copy.link}
                  onClick={() => wrapMarkdown('[', '](https://)', 'link')}
                >
                  ↗
                </button>
              </div>
            )}
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
            {kind === 'code' && (
              <select
                aria-label={copy.codeLanguage}
                value={syntaxLanguage}
                onChange={(event) => setSyntaxLanguage(event.target.value)}
              >
                {[
                  ['js', 'JavaScript'],
                  ['jsx', 'JSX'],
                  ['ts', 'TypeScript'],
                  ['tsx', 'TSX'],
                  ['py', 'Python'],
                  ['html', 'HTML'],
                  ['css', 'CSS'],
                  ['txt', 'Plain text'],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
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

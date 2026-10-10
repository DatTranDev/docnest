'use client';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Icon } from '@/components/ui/Icon';
import { useI18n } from '@/lib/i18n';
import { download, errorMessage } from '@/lib/http';
import { sourceFileType } from '@/features/documents';
import { SOURCE_LIMIT } from '../model/json';
import { codeLanguages, type CodeLanguage } from '../model/syntax';
import { htmlFile, printHtml } from '../model/documentExport';
import { markdownSample, useToolsCopy } from '../model/copy';
import { SiteHeader } from './SiteHeader';
import { SourceEditor, type SourceHandle } from './SourceEditor';
import { LocalDocument, type DocumentHandle } from './LocalDocument';
import { MarkdownPreview } from './MarkdownPreview';
import { useMarkdownScrollSync } from './useMarkdownScrollSync';
import { JsonPanels } from './JsonPanels';
type Mode = 'document' | 'markdown' | 'code' | 'json';
const modes: Mode[] = ['document', 'markdown', 'code', 'json'];
const initial = {
  markdown: markdownSample,
  code: 'const draft = { title: "docsnest", local: true };\n\nfunction saveDraft(name) {\n  return `${name}.md`;\n}\n\nconsole.log(saveDraft(draft.title));\n',
  json: '{"name":"docsnest","local":true,"tools":["Markdown","Code","JSON"]}',
};
const extensions: Record<string, [Mode, CodeLanguage?]> = {
  md: ['markdown'],
  markdown: ['markdown'],
  json: ['json'],
  js: ['code', 'javascript'],
  ts: ['code', 'typescript'],
  jsx: ['code', 'javascript'],
  tsx: ['code', 'typescript'],
  py: ['code', 'python'],
  html: ['code', 'html'],
  css: ['code', 'css'],
};
export default function LocalWorkbench({ standalone = false }: { standalone?: boolean }) {
  const copy = useToolsCopy(),
    { locale, errorText } = useI18n();
  const [mode, setMode] = useState<Mode>(() => {
    const requested = new URLSearchParams(window.location.search).get('mode');
    return modes.includes(requested as Mode) ? (requested as Mode) : 'markdown';
  });
  const [content, setContent] = useState(initial);
  const [names, setNames] = useState({
    document: 'Ban-thao.tedoc',
    markdown: 'Ban-thao.md',
    code: 'snippet.js',
    json: 'data.json',
  });
  const [language, setLanguage] = useState<CodeLanguage>('javascript');
  const [view, setView] = useState('split');
  const [error, setError] = useState(''),
    [status, setStatus] = useState('');
  const dirty = useRef<Record<Mode, boolean>>({
    document: false,
    markdown: false,
    code: false,
    json: false,
  });
  const markdown = useRef<SourceHandle | null>(null),
    code = useRef<SourceHandle | null>(null),
    json = useRef<SourceHandle | null>(null);
  const documentRef = useRef<DocumentHandle | null>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const handles = { markdown, code, json };
  const preview = useDeferredValue(content.markdown);
  const previewRef = useRef<HTMLDivElement>(null);
  useMarkdownScrollSync(
    markdown,
    previewRef,
    preview,
    mode === 'markdown' &&
      view === 'split' &&
      preview === content.markdown &&
      preview.length <= 200_000,
  );
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (Object.values(dirty.current).some(Boolean)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  function update(target: Exclude<Mode, 'document'>, value: string) {
    setContent((previous) => ({ ...previous, [target]: value }));
    dirty.current[target] = true;
    setStatus('');
  }
  async function open(file: File) {
    setError('');
    setStatus('');
    try {
      const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
      if (['txt', 'tedoc', 'docx'].includes(extension)) {
        if (!(await documentRef.current?.open(file))) return;
        setNames((previous) => ({ ...previous, document: file.name }));
        setMode('document');
        return;
      }
      const target = Object.hasOwn(extensions, extension) ? extensions[extension] : undefined;
      if (!target) throw new Error(copy.unsupported);
      if (file.size > SOURCE_LIMIT) throw new Error(copy.sourceLimit);
      const value = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      const next = target[0] as Exclude<Mode, 'document'>;
      if (dirty.current[next] && !window.confirm(copy.replace)) return;
      handles[next].current?.replace(value);
      dirty.current[next] = false;
      setNames((previous) => ({ ...previous, [next]: file.name }));
      if (target[1]) setLanguage(target[1]);
      setMode(next);
      setStatus(copy.opened);
    } catch (failure) {
      setError(errorText(errorMessage(failure)));
    }
  }
  function saveSource() {
    if (mode === 'document') return;
    const suffix =
      mode === 'markdown'
        ? 'md'
        : mode === 'json'
          ? 'json'
          : {
              javascript: 'js',
              typescript: 'ts',
              python: 'py',
              html: 'html',
              css: 'css',
              json: 'json',
              text: 'txt',
            }[language];
    const name = names[mode].replace(/\.[^.]+$/, '') || 'draft';
    download(
      new TextEncoder().encode(content[mode]),
      sourceFileType(names[mode]) === mode ? names[mode] : `${name}.${suffix}`,
      mode === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8',
    );
    dirty.current[mode] = false;
    setStatus(copy.downloaded);
  }
  async function exportMarkdown(print = false) {
    try {
      if (content.markdown.length > 200_000) throw new Error(copy.sourceLimit);
      const html = htmlFile(
        renderToStaticMarkup(<MarkdownPreview source={content.markdown} />),
        names.markdown,
        locale,
      );
      if (print) {
        setStatus(copy.printNote);
        await printHtml(html);
      } else {
        download(
          new TextEncoder().encode(html),
          names.markdown.replace(/\.[^.]+$/, '') + '.html',
          'text/html;charset=utf-8',
        );
        setStatus(copy.downloaded);
      }
    } catch {
      setError(copy.error);
    }
  }
  return (
    <div className="local-site">
      <SiteHeader standalone={standalone} editor />
      <main className="local-workbench">
        <div className="local-heading">
          <div>
            <h1>{copy.local}</h1>
            <p>{copy.deviceNote}</p>
          </div>
          <button className="primary" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" />
            {copy.upload}
          </button>
          <input
            hidden
            type="file"
            ref={fileInput}
            aria-label={copy.upload}
            accept=".txt,.tedoc,.docx,.md,.markdown,.json,.js,.ts,.jsx,.tsx,.py,.html,.css"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void open(file);
            }}
          />
        </div>
        <div className="local-tabs" role="tablist" aria-label={copy.local}>
          {modes.map((item) => (
            <button
              key={item}
              role="tab"
              aria-selected={mode === item}
              aria-controls={`local-${item}`}
              id={`tab-${item}`}
              onClick={() => {
                setMode(item);
                setError('');
                setStatus('');
              }}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const index = modes.indexOf(mode),
                  next =
                    event.key === 'Home'
                      ? modes[0]!
                      : event.key === 'End'
                        ? modes.at(-1)!
                        : modes[(index + (event.key === 'ArrowRight' ? 1 : 3)) % 4]!;
                setMode(next);
                window.document.getElementById(`tab-${next}`)?.focus();
              }}
              tabIndex={mode === item ? 0 : -1}
            >
              {copy[item]}
            </button>
          ))}
        </div>
        <div className="local-filebar">
          <label>
            {copy.filename}
            <input
              aria-label={copy.filename}
              value={names[mode]}
              maxLength={120}
              onChange={(event) =>
                setNames((previous) => ({ ...previous, [mode]: event.target.value }))
              }
            />
          </label>
          {mode !== 'document' && (
            <button onClick={saveSource}>
              <Icon name="download" />
              {copy.download}
            </button>
          )}
          {mode === 'markdown' && (
            <>
              <button onClick={() => void exportMarkdown()}>{copy.downloadHtml}</button>
              <button onClick={() => void exportMarkdown(true)}>{copy.printPdf}</button>
            </>
          )}
        </div>
        {error && (
          <p className="local-error" role="alert">
            {errorText(error)}
          </p>
        )}
        {status && (
          <p className="local-status" role="status">
            {status}
          </p>
        )}
        <section
          id="local-document"
          role="tabpanel"
          aria-labelledby="tab-document"
          hidden={mode !== 'document'}
        >
          <LocalDocument
            name={names.document}
            handle={documentRef}
            onDirty={(value) => {
              dirty.current.document = value;
            }}
            onError={setError}
            onStatus={setStatus}
          />
        </section>
        <section
          id="local-markdown"
          role="tabpanel"
          aria-labelledby="tab-markdown"
          hidden={mode !== 'markdown'}
        >
          <div className="source-toolbar" role="toolbar" aria-label={copy.markdown}>
            <button onClick={() => markdown.current?.wrap('**', '**', 'text')}>
              <b>{copy.bold}</b>
            </button>
            <button onClick={() => markdown.current?.wrap('_', '_', 'text')}>
              <i>{copy.italic}</i>
            </button>
            <button onClick={() => markdown.current?.prefix('## ')}>{copy.heading}</button>
            <button onClick={() => markdown.current?.prefix('> ')}>{copy.quote}</button>
            <button onClick={() => markdown.current?.prefix('- ')}>{copy.list}</button>
            <button onClick={() => markdown.current?.prefix('- [ ] ')}>{copy.task}</button>
            <button onClick={() => markdown.current?.wrap('[', '](https://example.com)', 'link')}>
              {copy.link}
            </button>
            <button
              onClick={() =>
                markdown.current?.wrap('\n```javascript\n', '\n```\n', 'const draft = "docsnest";')
              }
            >
              {copy.codeBlock}
            </button>
            <button
              onClick={() =>
                markdown.current?.wrap('\n| A | B |\n| --- | --- |\n| ', ' | Value |\n', 'Item')
              }
            >
              {copy.table}
            </button>
            <button onClick={() => markdown.current?.undo()} aria-label={copy.undo}>
              <Icon name="undo" />
            </button>
            <button onClick={() => markdown.current?.redo()} aria-label={copy.redo}>
              <Icon name="redo" />
            </button>
            <div className="local-view-switch">
              {(['source', 'split', 'preview'] as const).map((value) => (
                <button key={value} aria-pressed={view === value} onClick={() => setView(value)}>
                  {copy[value]}
                </button>
              ))}
            </div>
          </div>
          <div className={`markdown-split view-${view}`}>
            <div className="source-pane" hidden={view === 'preview'}>
              <div className="pane-label">{copy.source}</div>
              <SourceEditor
                initial={initial.markdown}
                handleRef={markdown}
                language="markdown"
                label={copy.toolSource}
                onChange={(value) => update('markdown', value)}
                onLimit={() => setError(copy.sourceLimit)}
              />
            </div>
            <div className="preview-column" hidden={view === 'source'}>
              <div className="pane-label">{copy.preview}</div>
              <div className="preview-pane" ref={previewRef}>
                {preview.length <= 200_000 ? (
                  <MarkdownPreview source={preview} sourceMap />
                ) : (
                  <p>{copy.sourceLimit}</p>
                )}
              </div>
            </div>
          </div>
        </section>
        <section
          id="local-code"
          role="tabpanel"
          aria-labelledby="tab-code"
          hidden={mode !== 'code'}
        >
          <div className="source-toolbar">
            <label>
              {copy.codeLanguage}
              <select
                aria-label={copy.codeLanguage}
                value={language}
                onChange={(event) => setLanguage(event.target.value as CodeLanguage)}
              >
                {codeLanguages.map((value) => (
                  <option key={value} value={value}>
                    {value === 'text' ? 'Plain text' : value}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={() => code.current?.undo()}>{copy.undo}</button>
            <button onClick={() => code.current?.redo()}>{copy.redo}</button>
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText(content.code)
                  .then(() => setStatus(copy.copied))
                  .catch(() => setError(copy.error))
              }
            >
              {copy.clipboard}
            </button>
          </div>
          <SourceEditor
            initial={initial.code}
            handleRef={code}
            language={
              language === 'typescript' && names.code.toLowerCase().endsWith('.tsx')
                ? 'tsx'
                : language === 'javascript' && names.code.toLowerCase().endsWith('.jsx')
                  ? 'jsx'
                  : language
            }
            label={copy.toolSource}
            onChange={(value) => update('code', value)}
            onLimit={() => setError(copy.sourceLimit)}
          />
        </section>
        <section
          id="local-json"
          role="tabpanel"
          aria-labelledby="tab-json"
          hidden={mode !== 'json'}
        >
          <JsonPanels
            source={content.json}
            name={names.json}
            onApply={(value) => json.current?.replace(value)}
            onError={setError}
            onStatus={setStatus}
            onDirty={() => {
              dirty.current.json = true;
            }}
          >
            <SourceEditor
              initial={initial.json}
              handleRef={json}
              language="json"
              label={copy.toolSource}
              onChange={(value) => update('json', value)}
              onLimit={() => setError(copy.sourceLimit)}
            />
          </JsonPanels>
        </section>
      </main>
    </div>
  );
}

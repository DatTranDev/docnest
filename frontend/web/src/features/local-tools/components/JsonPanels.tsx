'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { download } from '@/lib/http';
import { useToolsCopy } from '../model/copy';
import { formatJson, JsonProblem, jsonLocation } from '../model/json';
import { SourceEditor, type SourceHandle } from './SourceEditor';

export function JsonPanels({
  source,
  name,
  children,
  readOnly = false,
  onApply,
  onError,
  onStatus,
  onDirty,
}: {
  source: string;
  name: string;
  children: ReactNode;
  readOnly?: boolean;
  onApply: (value: string) => void;
  onError: (value: string) => void;
  onStatus: (value: string) => void;
  onDirty?: () => void;
}) {
  const copy = useToolsCopy();
  const [indent, setIndent] = useState<2 | 4>(2);
  const [output, setOutput] = useState('');
  const [resultTouched, setResultTouched] = useState(false);
  const [resultProblem, setResultProblem] = useState('');
  const [resultValid, setResultValid] = useState(false);
  const [view, setView] = useState<'source' | 'result'>('source');
  const [collapsed, setCollapsed] = useState<'none' | 'source' | 'result'>('none');
  const [validation, setValidation] = useState<{
    source: string;
    message: string;
    valid: boolean;
  } | null>(null);
  const outputRef = useRef<SourceHandle | null>(null);
  const automatic = useRef(false);
  const scratchEdited = useRef(false);
  useEffect(() => {
    if (scratchEdited.current) return;
    const timer = setTimeout(() => {
      try {
        const formatted = formatJson(source, indent);
        automatic.current = true;
        outputRef.current?.replace(formatted, false);
        automatic.current = false;
        setOutput(formatted);
        setResultTouched(false);
        setResultProblem('');
        setResultValid(true);
        setValidation({ source, message: copy.validJson, valid: true });
      } catch (failure) {
        automatic.current = false;
        const position =
          failure instanceof JsonProblem ? jsonLocation(source, failure.offset) : null;
        setValidation({
          source,
          valid: false,
          message:
            failure instanceof Error && failure.message === 'JSON_DEPTH'
              ? copy.depth
              : `${copy.invalidJson}${position ? ` — ${copy.line} ${position.line}, ${copy.column} ${position.column}` : ''}`,
        });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [source, indent, copy]);
  function action(kind: 'format' | 'minify' | 'validate') {
    try {
      const value = formatJson(source, kind === 'minify' ? 0 : indent);
      if (kind !== 'validate') {
        automatic.current = true;
        outputRef.current?.replace(value, false);
        automatic.current = false;
        scratchEdited.current = kind === 'minify';
        setOutput(value);
        setResultTouched(kind === 'minify');
        setResultProblem('');
        setResultValid(true);
      }
      setValidation({ source, message: copy.validJson, valid: true });
      onError('');
    } catch (failure) {
      const position = failure instanceof JsonProblem ? jsonLocation(source, failure.offset) : null;
      setValidation({
        source,
        valid: false,
        message:
          failure instanceof Error && failure.message === 'JSON_DEPTH'
            ? copy.depth
            : `${copy.invalidJson}${position ? ` — ${copy.line} ${position.line}, ${copy.column} ${position.column}` : ''}`,
      });
      if (failure instanceof Error && failure.message === 'SOURCE_LIMIT') onError(copy.sourceLimit);
    }
  }
  function applyResult() {
    if (readOnly || (!output && !resultTouched)) return;
    if (!output && source && !window.confirm(copy.confirmEmptyResult)) return;
    try {
      if (output) formatJson(output, 0);
      setResultProblem('');
      setResultValid(true);
      onApply(output);
      scratchEdited.current = false;
      onStatus(copy.appliedResult);
    } catch {
      setResultProblem(copy.invalidJson);
      setResultValid(false);
    }
  }
  return (
    <div className="json-workbench">
      <div className="source-toolbar">
        {resultTouched && <button onClick={() => action('format')}>{copy.format}</button>}
        <button onClick={() => action('minify')}>{copy.minify}</button>
        <button onClick={() => action('validate')}>{copy.validate}</button>
        <label>
          {copy.indent}
          <select
            aria-label={copy.indent}
            value={indent}
            onChange={(event) => setIndent(Number(event.target.value) as 2 | 4)}
          >
            <option value={2}>2</option>
            <option value={4}>4</option>
          </select>
        </label>
      </div>
      {validation?.source === source && (
        <p
          className={validation.valid ? 'json-valid' : 'local-error'}
          role="status"
          aria-label={copy.jsonStatus}
        >
          {validation.message}
        </p>
      )}
      <div className="json-mobile-switch" role="group" aria-label={copy.formattedJson}>
        <button aria-pressed={view === 'source'} onClick={() => setView('source')}>
          {copy.source}
        </button>
        <button aria-pressed={view === 'result'} onClick={() => setView('result')}>
          {copy.formattedJson}
        </button>
      </div>
      <div className="json-split" data-view={view} data-collapsed={collapsed}>
        <div className="json-source">
          <div className="pane-label">
            <span>{copy.source}</span>
            <button
              className="json-collapse"
              aria-label={`${collapsed === 'source' ? copy.expand : copy.collapse} ${copy.source}`}
              aria-expanded={collapsed !== 'source'}
              onClick={() => setCollapsed(collapsed === 'source' ? 'none' : 'source')}
            >
              <Icon name="chevron-down" size={16} />
            </button>
          </div>
          <div className="json-panel-content">{children}</div>
        </div>
        <div className="json-output">
          <div className="pane-label">
            <span>{copy.formattedJson}</span>
            <button
              className="json-collapse"
              aria-label={`${collapsed === 'result' ? copy.expand : copy.collapse} ${copy.formattedJson}`}
              aria-expanded={collapsed !== 'result'}
              onClick={() => setCollapsed(collapsed === 'result' ? 'none' : 'result')}
            >
              <Icon name="chevron-down" size={16} />
            </button>
          </div>
          <div className="json-panel-content">
            <SourceEditor
              initial=""
              handleRef={outputRef}
              language="json"
              label={copy.jsonOutput}
              onChange={(value) => {
                setOutput(value);
                if (automatic.current) return;
                scratchEdited.current = true;
                setResultTouched(true);
                setResultProblem('');
                setResultValid(false);
                onDirty?.();
              }}
              onLimit={() => onError(copy.sourceLimit)}
            />
            <p className="json-scratch-note">{copy.resultScratch}</p>
            {resultProblem && (
              <p className="local-error" role="alert">
                {resultProblem}
              </p>
            )}
            {resultValid && !resultProblem && (
              <p className="json-valid" role="status">
                {copy.validJson}
              </p>
            )}
            <div className="pane-actions json-result-actions">
              <button
                disabled={readOnly || (!output && !resultTouched)}
                title={!output && !resultTouched ? copy.emptyResult : undefined}
                onClick={applyResult}
              >
                {copy.applyResult}
              </button>
              <button
                disabled={!output}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(output)
                    .then(() => onStatus(copy.copied))
                    .catch(() => onError(copy.error))
                }
              >
                {copy.clipboard}
              </button>
              <button
                disabled={!output}
                onClick={() => {
                  download(
                    new TextEncoder().encode(output),
                    name.replace(/\.[^.]+$/, '') + '.json',
                    'application/json;charset=utf-8',
                  );
                  onStatus(copy.downloaded);
                }}
              >
                {copy.downloadResult}
              </button>
              <button
                disabled={!output}
                onClick={() => {
                  try {
                    formatJson(output, 0);
                    setResultProblem('');
                    setResultValid(true);
                  } catch {
                    setResultProblem(copy.invalidJson);
                    setResultValid(false);
                  }
                }}
              >
                {copy.validateResult}
              </button>
              <button aria-label={copy.undoResult} onClick={() => outputRef.current?.undo()}>
                ↶
              </button>
              <button aria-label={copy.redoResult} onClick={() => outputRef.current?.redo()}>
                ↷
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

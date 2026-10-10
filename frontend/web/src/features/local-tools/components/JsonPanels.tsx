'use client';
import { useRef, useState, type ReactNode } from 'react';
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
  const [validation, setValidation] = useState<{
    source: string;
    message: string;
    valid: boolean;
  } | null>(null);
  const outputRef = useRef<SourceHandle | null>(null);
  function action(kind: 'format' | 'minify' | 'validate') {
    try {
      const value = formatJson(source, kind === 'minify' ? 0 : indent);
      if (kind !== 'validate') outputRef.current?.replace(value);
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
  return (
    <div className="json-workbench">
      <div className="source-toolbar">
        <button className="primary" onClick={() => action('format')}>
          {copy.format}
        </button>
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
      <div className="json-split">
        <div className="json-source">
          <div className="pane-label">{copy.source}</div>
          {children}
        </div>
        <div className="json-output">
          <div className="pane-label pane-actions">
            <span>{copy.formattedJson}</span>
            <button disabled={readOnly} onClick={() => onApply(output)}>
              {copy.applyResult}
            </button>
            <button
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
            <button aria-label={copy.undoResult} onClick={() => outputRef.current?.undo()}>
              ↶
            </button>
            <button aria-label={copy.redoResult} onClick={() => outputRef.current?.redo()}>
              ↷
            </button>
          </div>
          <SourceEditor
            initial=""
            handleRef={outputRef}
            language="json"
            label={copy.jsonOutput}
            onChange={(value) => {
              setOutput(value);
              onDirty?.();
            }}
            onLimit={() => onError(copy.sourceLimit)}
          />
        </div>
      </div>
    </div>
  );
}

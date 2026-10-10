'use client';
import { useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react';
import { EditorModel, encodeNative, exportTxt, type Snapshot } from '@ted/editor-core';
import { EditorController, EditorPane } from '@/features/editor';
import { readImportedFile } from '@/features/documents';
import { MESSAGE, useI18n } from '@/lib/i18n';
import { download, errorMessage } from '@/lib/http';
import { htmlFile, printHtml, richHtml } from '../model/documentExport';
import { useToolsCopy } from '../model/copy';
export interface DocumentHandle {
  open: (file: File) => Promise<boolean>;
}
export function LocalDocument({
  name,
  handle,
  onDirty,
  onError,
  onStatus,
}: {
  name: string;
  handle: RefObject<DocumentHandle | null>;
  onDirty: (dirty: boolean) => void;
  onError: (error: string) => void;
  onStatus: (status: string) => void;
}) {
  const { locale } = useI18n(),
    copy = useToolsCopy();
  const [model, setModel] = useState(() => new EditorModel());
  const [tick, setTick] = useState(0);
  const host = useRef<HTMLDivElement>(null),
    controller = useRef<EditorController | null>(null);
  const savedToken = useRef(model.contentToken);
  const callbacks = useRef({ onDirty, onError });
  useEffect(() => {
    callbacks.current = { onDirty, onError };
  }, [onDirty, onError]);
  useEffect(() => {
    const editor = new EditorController(
      model,
      host.current!,
      () => {
        setTick((t) => t + 1);
        callbacks.current.onDirty(model.contentToken !== savedToken.current);
      },
      false,
      () => setTick((t) => t + 1),
    );
    controller.current = editor;
    const failure = (event: Event) =>
      callbacks.current.onError((event as CustomEvent<string>).detail);
    window.addEventListener('editor-error', failure);
    return () => {
      window.removeEventListener('editor-error', failure);
      controller.current = null;
      editor.destroy();
    };
  }, [model]);
  async function open(file: File) {
    const snapshot = await readImportedFile(file);
    if (model.contentToken !== savedToken.current && !window.confirm(copy.replace)) return false;
    savedToken.current = snapshot.contentToken;
    setModel(EditorModel.loaded(snapshot));
    onDirty(false);
    onStatus(copy.opened);
    return true;
  }
  useImperativeHandle(handle, () => ({ open }));
  async function save(snapshot = model.snapshot()) {
    download(await encodeNative(snapshot), name.replace(/\.[^.]+$/, '') + '.tedoc');
    savedToken.current = snapshot.contentToken;
    onDirty(model.contentToken !== savedToken.current);
    onStatus(copy.downloaded);
    setTick((t) => t + 1);
  }
  async function exportFile(type: 'EXPORT_TXT' | 'EXPORT_HTML' | 'EXPORT_DOCX' | 'EXPORT_PDF') {
    try {
      const snapshot = model.snapshot(),
        title = name.replace(/\.[^.]+$/, '') || copy.newDocument;
      if (type === 'EXPORT_TXT')
        download(exportTxt(snapshot), title + '.txt', 'text/plain;charset=utf-8');
      else if (type === 'EXPORT_DOCX') {
        const { exportLocalDocx } = await import('../model/exportDocx');
        download(
          await exportLocalDocx(snapshot, title),
          title + '.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        );
      } else {
        const html = htmlFile(richHtml(snapshot), title, locale);
        if (type === 'EXPORT_HTML')
          download(new TextEncoder().encode(html), title + '.html', 'text/html;charset=utf-8');
        else {
          onStatus(copy.printNote);
          await printHtml(html);
          return;
        }
      }
      onStatus(copy.downloaded);
    } catch (error) {
      onError(errorMessage(error));
    }
  }
  return (
    <EditorPane
      localOnly
      active={{
        model,
        readOnly: false,
        document: { title: name, effectiveRole: 'OWNER', headRevision: 0 },
      }}
      tick={tick}
      status={MESSAGE.localOnly}
      online
      saving={false}
      host={host}
      controller={controller}
      recovery={null}
      onSave={() => save().catch((error) => onError(errorMessage(error)))}
      onCollaborate={async () => {}}
      onCopy={(snapshot: Snapshot) => save(snapshot).catch((error) => onError(errorMessage(error)))}
      onImport={(file) =>
        open(file)
          .then(() => {})
          .catch((error) => onError(errorMessage(error)))
      }
      onExport={exportFile}
      onHistory={() => {}}
      onShare={() => {}}
      onClearHistory={() => {
        model.clearHistory();
        setTick((t) => t + 1);
      }}
      onError={onError}
    />
  );
}

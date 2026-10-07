'use client';
import { useState, useEffect, useRef } from 'react';
import { decodeNative, EditorModel, encodeNative, exportTxt } from '@ted/editor-core';
import { download } from '@/lib/http';
import { EditorController } from '@/features/editor';
import { publicShare, publicContent } from '../api/sharing';
export default function PublicViewer({ token }: { token: string }) {
  const [title, setTitle] = useState(''),
    [model, setModel] = useState<EditorModel | null>(null),
    [error, setError] = useState(''),
    host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    void publicShare(token)
      .then(async (d) => {
        const snapshot = d.empty ? null : await decodeNative(await publicContent(d.contentPath!));
        if (disposed) return;
        setTitle(d.title);
        setModel(snapshot ? EditorModel.loaded(snapshot) : new EditorModel());
      })
      .catch(() => {
        if (!disposed) setError('Liên kết không hợp lệ, đã hết hạn hoặc đã thu hồi.');
      });
    return () => {
      disposed = true;
    };
  }, [token]);
  useEffect(() => {
    if (model && host.current) {
      const c = new EditorController(model, host.current, () => {}, true);
      return () => c.destroy();
    }
  }, [model]);
  return (
    <main className="public">
      <h1>{title || 'Tài liệu chia sẻ'}</h1>
      <p>Chỉ đọc</p>
      {error && <p role="alert">{error}</p>}
      {model && (
        <div className="toolbar">
          <button
            onClick={() => {
              void encodeNative(model.snapshot()).then((b) => download(b, `${title}.tedoc`));
            }}
          >
            Tải native
          </button>
          <button onClick={() => download(exportTxt(model.snapshot()), `${title}.txt`)}>
            Tải TXT
          </button>
        </div>
      )}
      <div className="editor-host" ref={host} />
    </main>
  );
}

'use client';
import { useState, type ReactNode, type RefObject } from 'react';
import { encodeNative, exportTxt, type EditorModel, type Snapshot } from '@ted/editor-core';
import { download, errorMessage } from '@/lib/http';
import type { EditorController } from '../model/EditorController';
interface EditorSurface {
  model: EditorModel;
  readOnly: boolean;
  revision?: number;
  document: { title: string; effectiveRole: string; headRevision: number };
}
interface EditorPaneProps {
  active: EditorSurface;
  tick: number;
  status: string;
  online: boolean;
  saving: boolean;
  controller: RefObject<EditorController | null>;
  host: RefObject<HTMLDivElement | null>;
  recovery: ReactNode;
  onSave: () => Promise<void>;
  onCopy: (snapshot: Snapshot) => Promise<void>;
  onImport: (file: File) => Promise<void>;
  onExport: (type: 'EXPORT_TXT' | 'EXPORT_HTML') => Promise<void>;
  onHistory: () => void;
  onShare: () => void;
  onClearHistory: () => void;
  onError: (message: string) => void;
}
export function EditorPane({
  active,
  tick,
  status,
  online,
  saving,
  controller,
  host,
  recovery,
  onSave,
  onCopy,
  onImport,
  onExport,
  onHistory,
  onShare,
  onClearHistory,
  onError,
}: EditorPaneProps) {
  const [query, setQuery] = useState(''),
    [replacement, setReplacement] = useState(''),
    [count, setCount] = useState<number | null>(null),
    [ignoreCase, setIgnoreCase] = useState(false);
  return (
    <section className="editor-section" inert={status === 'Đang mở'}>
      <div className="row">
        <h2>
          {active.document.title}
          {active.revision !== undefined && ` — phiên bản ${active.revision}`}
        </h2>
        <span className="badge">
          {active.document.effectiveRole}
          {active.readOnly ? ' · chỉ đọc' : ''}
        </span>
        <span role="status" aria-live="polite">
          {!online ? 'Ngoại tuyến' : status}
        </span>
      </div>
      <div className="toolbar">
        <button
          aria-label="In đậm"
          disabled={active.readOnly}
          onClick={() => controller.current?.format(1)}
        >
          <b>B</b>
        </button>
        <button
          aria-label="In nghiêng"
          disabled={active.readOnly}
          onClick={() => controller.current?.format(2)}
        >
          <i>I</i>
        </button>
        <button
          aria-label="Gạch chân"
          disabled={active.readOnly}
          onClick={() => controller.current?.format(4)}
        >
          <u>U</u>
        </button>
        <button disabled={active.readOnly} onClick={() => controller.current?.undo()}>
          Hoàn tác
        </button>
        <button disabled={active.readOnly} onClick={() => controller.current?.redo()}>
          Làm lại
        </button>
        <button disabled={active.readOnly} onClick={onClearHistory}>
          Xóa lịch sử hoàn tác
        </button>
        <button
          className="primary"
          disabled={active.readOnly || saving || status === 'Xung đột'}
          onClick={() => {
            void onSave();
          }}
        >
          Lưu
        </button>
        <label className="button">
          Nhập tệp
          <input
            aria-label="Nhập tệp"
            type="file"
            accept=".txt,.tedoc"
            disabled={active.readOnly}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onImport(file);
              event.target.value = '';
            }}
          />
        </label>
        <button
          onClick={() => {
            void encodeNative(active.model.snapshot())
              .then((bytes) => download(bytes, `${active.document.title}.tedoc`))
              .catch((error) => onError(errorMessage(error)));
          }}
        >
          Tải native
        </button>
        <button
          onClick={() =>
            download(
              exportTxt(active.model.snapshot()),
              `${active.document.title}.txt`,
              'text/plain;charset=utf-8',
            )
          }
        >
          Tải TXT
        </button>
        <button
          disabled={!active.document.headRevision}
          onClick={() => {
            void onExport('EXPORT_TXT');
          }}
        >
          Xuất TXT
        </button>
        <button
          disabled={!active.document.headRevision}
          onClick={() => {
            void onExport('EXPORT_HTML');
          }}
        >
          Xuất HTML
        </button>
        <button onClick={onHistory}>Lịch sử</button>
        <button
          onClick={() => {
            void onCopy(active.model.snapshot());
          }}
        >
          Lưu bản sao
        </button>
        {active.document.effectiveRole === 'OWNER' && <button onClick={onShare}>Chia sẻ</button>}
      </div>
      <div className="search">
        <input
          aria-label="Tìm kiếm"
          placeholder="Tìm trong tài liệu"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={ignoreCase}
            onChange={(event) => setIgnoreCase(event.target.checked)}
          />
          Bỏ qua hoa/thường ASCII
        </label>
        <button
          onClick={() => {
            void controller.current
              ?.find(query, ignoreCase)
              .then(setCount)
              .catch((error) => onError(errorMessage(error)));
          }}
        >
          Tìm
        </button>
        {count !== null && <span>{count} kết quả</span>}
        <input
          aria-label="Thay thế"
          placeholder="Thay bằng"
          value={replacement}
          onChange={(event) => setReplacement(event.target.value)}
        />
        <button
          disabled={active.readOnly || !query}
          onClick={() => {
            try {
              controller.current?.replaceAll(query, replacement, ignoreCase);
            } catch (error) {
              onError(errorMessage(error));
            }
          }}
        >
          Thay tất cả
        </button>
      </div>
      {recovery}
      <div className="editor-host" ref={host} />
      <footer>
        {active.model.text.utf8Bytes.toLocaleString()} byte ·{' '}
        {active.model.text.lines.toLocaleString()} dòng · {tick >= 0 && active.model.localRevision}{' '}
        thay đổi
        <p className="muted">
          Tệp lớn, nhiều định dạng hoặc một dòng rất dài có thể dùng nhiều bộ nhớ, cuộn chậm và hoàn
          tác chậm trên thiết bị này. Hãy dùng tìm kiếm hoặc tải tệp xuống khi cần.
        </p>
      </footer>
    </section>
  );
}

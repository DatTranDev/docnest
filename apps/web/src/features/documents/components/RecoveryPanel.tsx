import { encodeNative, type Snapshot } from '@ted/editor-core';
import type { DraftMeta } from '@/features/editor';
import { download, errorMessage } from '@/lib/http';
import type { ActiveDocument } from '../model/types';
export function RecoveryPanel({
  active,
  draft,
  status,
  onRecover,
  onDiscard,
  onOpenLatest,
  onCopy,
  onError,
}: {
  active: ActiveDocument;
  draft: DraftMeta | null;
  status: string;
  onRecover: () => Promise<void>;
  onDiscard: () => void;
  onOpenLatest: () => Promise<void>;
  onCopy: (snapshot: Snapshot) => Promise<void>;
  onError: (message: string) => void;
}) {
  return (
    <>
      {draft && (
        <div className="recovery" role="alert">
          Có bản nháp trên thiết bị{' '}
          {draft.baseHeadRevision !== active.document.headRevision
            ? 'từ phiên bản khác. Khôi phục sẽ giữ trạng thái xung đột.'
            : ''}
          <button
            onClick={() => {
              void onRecover().catch((error) => onError(errorMessage(error)));
            }}
          >
            Khôi phục bản nháp
          </button>
          <button onClick={onDiscard}>Bỏ bản nháp</button>
        </div>
      )}
      {status === 'Xung đột' && (
        <div className="recovery">
          Phiên bản máy chủ đã thay đổi.
          <button
            onClick={() => {
              void onOpenLatest();
            }}
          >
            Mở mới nhất
          </button>
          <button
            onClick={() => {
              void onCopy(active.model.snapshot());
            }}
          >
            Lưu thay đổi thành tài liệu mới
          </button>
          <button
            onClick={() => {
              void encodeNative(active.model.snapshot())
                .then((bytes) => download(bytes, 'ban-nhap.tedoc'))
                .catch((error) => onError(errorMessage(error)));
            }}
          >
            Tải bản nháp
          </button>
          <button onClick={() => onError('Bản nháp vẫn được giữ; lưu tạm dừng khi có xung đột.')}>
            Hủy
          </button>
        </div>
      )}
    </>
  );
}

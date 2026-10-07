import type { Version } from '../model/types';
export function VersionDialog({
  versions,
  onOpen,
  onClose,
}: {
  versions: Version[];
  onOpen: (revision: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal" role="dialog" aria-label="Lịch sử phiên bản">
      <div className="panel">
        <h2>Lịch sử phiên bản</h2>
        {versions.map((version) => (
          <div className="row" key={version.id}>
            Phiên bản {version.revision} · {new Date(version.createdAt).toLocaleString('vi-VN')}
            <button onClick={() => onOpen(version.revision)}>Mở chỉ đọc</button>
          </div>
        ))}
        <button onClick={onClose}>Đóng</button>
      </div>
    </div>
  );
}

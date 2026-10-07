import type { Folder } from '../model/types';
export function FolderRows({
  folders,
  onOpen,
  onRename,
  onMove,
  onDelete,
}: {
  folders: Folder[];
  onOpen: (folder: Folder) => void;
  onRename: (folder: Folder) => void;
  onMove: (folder: Folder) => void;
  onDelete: (folder: Folder) => void;
}) {
  return (
    <>
      {folders.map((folder) => (
        <div className="file" key={folder.id}>
          <button className="file-name" onClick={() => onOpen(folder)}>
            📁 {folder.name}
          </button>
          <button onClick={() => onRename(folder)}>Đổi tên</button>
          <button onClick={() => onMove(folder)}>Di chuyển</button>
          <button onClick={() => onDelete(folder)}>Xóa</button>
        </div>
      ))}
    </>
  );
}

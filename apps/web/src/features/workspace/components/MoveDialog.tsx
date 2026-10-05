import { useState } from 'react';
import type { Folder } from '@/features/folders';
import type { MoveTarget } from '../model/types';
export function MoveDialog({
  destination,
  folders,
  onMove,
  onClose,
}: {
  destination: MoveTarget;
  folders: Folder[];
  onMove: (target: string | null) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState('');
  return (
    <div className="modal" role="dialog" aria-label="Di chuyển">
      <div className="panel">
        <h2>Di chuyển</h2>
        <select
          aria-label="Thư mục đích"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        >
          <option value="">Gốc</option>
          {folders
            .filter((folder) => destination.kind !== 'folder' || folder.id !== destination.item.id)
            .map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
        </select>
        <button onClick={() => onMove(target || null)}>Di chuyển</button>
        <button onClick={onClose}>Hủy</button>
      </div>
    </div>
  );
}

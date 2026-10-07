import { DocumentPreview } from './DocumentPreview';
import type { DocumentInfo } from '../model/types';
export function DocumentRows({
  documents,
  trash,
  onOpen,
  onRename,
  onMove,
  onTrash,
  onRestore,
}: {
  documents: DocumentInfo[];
  trash: boolean;
  onOpen: (document: DocumentInfo) => void;
  onRename: (document: DocumentInfo) => void;
  onMove: (document: DocumentInfo) => void;
  onTrash: (document: DocumentInfo) => void;
  onRestore: (document: DocumentInfo) => void;
}) {
  return (
    <>
      {documents.map((document) => (
        <div className="file" key={document.id}>
          <button className="file-name" disabled={trash} onClick={() => onOpen(document)}>
            📄 {document.title}
          </button>
          <span className="badge">{document.effectiveRole}</span>
          <DocumentPreview document={document} />
          {document.effectiveRole === 'OWNER' &&
            (trash ? (
              <button onClick={() => onRestore(document)}>Khôi phục</button>
            ) : (
              <>
                <button onClick={() => onRename(document)}>Đổi tên</button>
                <button onClick={() => onMove(document)}>Di chuyển</button>
                <button onClick={() => onTrash(document)}>Bỏ vào thùng rác</button>
              </>
            ))}
        </div>
      ))}
    </>
  );
}

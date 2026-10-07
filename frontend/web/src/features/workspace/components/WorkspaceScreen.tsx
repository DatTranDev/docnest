'use client';
import { useCallback, useState } from 'react';
import Link from 'next/link';
import { AuthForm, useSession } from '@/features/auth';
import {
  DocumentRows,
  RecoveryPanel,
  VersionDialog,
  listVersions,
  moveDocument,
  renameDocument,
  restoreDocument,
  trashDocument,
  useDocumentSession,
  type Version,
} from '@/features/documents';
import { EditorPane } from '@/features/editor';
import { ExportJobsPanel, useExportJobs } from '@/features/export-jobs';
import {
  FolderRows,
  createFolder,
  deleteFolder,
  listAllFolders,
  moveFolder,
  renameFolder,
  type Folder,
} from '@/features/folders';
import { ShareDialog } from '@/features/sharing';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
import { errorMessage } from '@/lib/http';
import { useOnlineStatus } from '@/lib/react/useOnlineStatus';
import { MoveDialog } from './MoveDialog';
import { useWorkspaceContents } from '../hooks/useWorkspaceContents';
import type { MoveTarget, Scope } from '../model/types';
export default function WorkspaceScreen() {
  const session = useSession();
  const [error, setError] = useState(''),
    [scope, setScope] = useState<Scope>('mine'),
    [path, setPath] = useState<Folder[]>([]),
    [share, setShare] = useState(false),
    [versions, setVersions] = useState<Version[] | null>(null),
    [destination, setDestination] = useState<MoveTarget | null>(null),
    [allFolders, setAllFolders] = useState<Folder[]>([]);
  const online = useOnlineStatus();
  const parent = scope === 'mine' ? (path.at(-1)?.id ?? null) : null;
  const contents = useWorkspaceContents(session.user?.id, scope, parent, online, setError);
  const { reload } = contents;
  const documentSession = useDocumentSession(session.user, parent, contents.reload, setError),
    { active } = documentSession;
  const exports = useExportJobs(documentSession.activeRef, documentSession.save, setError);
  const mutate = useCallback(
    async (operation: () => Promise<unknown>) => {
      setError('');
      try {
        await operation();
        await reload();
      } catch (failure) {
        setError(errorMessage(failure));
      }
    },
    [reload],
  );
  const chooseMove = useCallback(async (target: MoveTarget) => {
    try {
      setAllFolders(await listAllFolders());
      setDestination(target);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }, []);
  if (session.loading) return <LoadingIndicator />;
  if (!session.user)
    return <AuthForm onLogin={session.onLogin} error={error} setError={setError} />;
  return (
    <div className="app">
      <header>
        <Link className="brand" href="/">
          Trang viết
        </Link>
        <span>{session.user.displayName}</span>
        <button
          onClick={() => {
            documentSession.clearActive();
            void session.signOut().catch((failure) => setError(errorMessage(failure)));
          }}
        >
          Đăng xuất
        </button>
      </header>
      <div className="body">
        <aside>
          <button
            className={scope === 'mine' ? 'selected' : ''}
            onClick={() => {
              setScope('mine');
              setPath([]);
            }}
          >
            Tài liệu của tôi
          </button>
          <button
            className={scope === 'shared' ? 'selected' : ''}
            onClick={() => setScope('shared')}
          >
            Được chia sẻ
          </button>
          <button className={scope === 'trash' ? 'selected' : ''} onClick={() => setScope('trash')}>
            Thùng rác
          </button>
          <p className="muted">Thùng rác giữ tài liệu 14 ngày.</p>
        </aside>
        <main>
          <ErrorNotice message={error} onClose={() => setError('')} />
          <ErrorNotice message={documentSession.recoveryError} />
          <div className="workspace">
            <nav aria-label="Đường dẫn">
              <button onClick={() => setPath([])}>Gốc</button>
              {path.map((folder, index) => (
                <button key={folder.id} onClick={() => setPath(path.slice(0, index + 1))}>
                  / {folder.name}
                </button>
              ))}
            </nav>
            <div className="row">
              <h2>
                {scope === 'mine'
                  ? 'Tài liệu'
                  : scope === 'shared'
                    ? 'Được chia sẻ với tôi'
                    : 'Thùng rác'}
              </h2>
              {scope === 'mine' && (
                <>
                  <button
                    onClick={() => {
                      const name = window.prompt('Tên thư mục');
                      if (name) void mutate(() => createFolder(name, parent));
                    }}
                  >
                    Thư mục mới
                  </button>
                  <button
                    className="primary"
                    onClick={() => {
                      void documentSession.newDoc();
                    }}
                  >
                    Tài liệu mới
                  </button>
                </>
              )}
            </div>
            <div className="file-list">
              <FolderRows
                folders={contents.folders}
                onOpen={(folder) => setPath([...path, folder])}
                onRename={(folder) => {
                  const name = window.prompt('Tên thư mục', folder.name);
                  if (name) void mutate(() => renameFolder(folder, name));
                }}
                onMove={(folder) => {
                  void chooseMove({ kind: 'folder', item: folder });
                }}
                onDelete={(folder) => {
                  void mutate(() => deleteFolder(folder));
                }}
              />
              <DocumentRows
                documents={contents.documents}
                trash={scope === 'trash'}
                onOpen={(document) => {
                  void documentSession.open(document);
                }}
                onRename={(document) => {
                  const title = window.prompt('Tên tài liệu', document.title);
                  if (title) void mutate(() => renameDocument(document, title));
                }}
                onMove={(document) => {
                  void chooseMove({ kind: 'document', item: document });
                }}
                onTrash={(document) => {
                  void mutate(() => trashDocument(document));
                  if (active?.document.id === document.id) documentSession.clearActive();
                }}
                onRestore={(document) => {
                  void mutate(() => restoreDocument(document));
                }}
              />
              {!contents.folders.length && !contents.documents.length && (
                <p className="muted">Chưa có tài liệu.</p>
              )}
              {contents.cursor && (
                <button
                  onClick={() => {
                    void contents.reload(contents.cursor!);
                  }}
                >
                  Xem thêm
                </button>
              )}
            </div>
          </div>
          {active && (
            <EditorPane
              active={active}
              tick={documentSession.tick}
              status={documentSession.status}
              online={documentSession.online}
              saving={documentSession.saving}
              controller={documentSession.controller}
              host={documentSession.editorElement}
              onSave={documentSession.save}
              onCopy={documentSession.newDoc}
              onImport={documentSession.importFile}
              onExport={exports.start}
              onHistory={() => {
                void listVersions(active.document.id)
                  .then((page) => setVersions(page.items))
                  .catch((failure) => setError(errorMessage(failure)));
              }}
              onShare={() => setShare(true)}
              onClearHistory={documentSession.clearHistory}
              onError={setError}
              recovery={
                <RecoveryPanel
                  active={active}
                  draft={documentSession.draft}
                  status={documentSession.status}
                  onRecover={documentSession.recoverLocal}
                  onDiscard={documentSession.discardDraft}
                  onOpenLatest={async () => {
                    await documentSession.preserve(active);
                    await documentSession.open(active.document);
                  }}
                  onCopy={documentSession.newDoc}
                  onError={setError}
                />
              }
            />
          )}
          <ExportJobsPanel jobs={exports.jobs} onUpdate={exports.setJobs} onError={setError} />
        </main>
      </div>
      {share && active && (
        <ShareDialog
          documentId={active.document.id}
          onClose={() => setShare(false)}
          setError={setError}
        />
      )}
      {versions && active && (
        <VersionDialog
          versions={versions}
          onOpen={(revision) => {
            void documentSession.open(active.document, revision);
            setVersions(null);
          }}
          onClose={() => setVersions(null)}
        />
      )}
      {destination && (
        <MoveDialog
          destination={destination}
          folders={allFolders}
          onMove={(target) => {
            void mutate(() =>
              destination.kind === 'folder'
                ? moveFolder(destination.item, target)
                : moveDocument(destination.item, target),
            );
            setDestination(null);
          }}
          onClose={() => setDestination(null)}
        />
      )}
    </div>
  );
}

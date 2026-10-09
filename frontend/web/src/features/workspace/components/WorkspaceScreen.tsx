'use client';
import { LanguageSelector } from '@/components/ui/LanguageSelector';
import { MESSAGE, useI18n } from '@/lib/i18n';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { AuthForm, useSession } from '@/features/auth';
import { BillingPanel } from '@/features/billing';
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
import { Icon } from '@/components/ui/Icon';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
import { errorMessage } from '@/lib/http';
import { useOnlineStatus } from '@/lib/react/useOnlineStatus';
import { MoveDialog } from './MoveDialog';
import { useWorkspaceContents } from '../hooks/useWorkspaceContents';
import type { MoveTarget, Scope } from '../model/types';
export default function WorkspaceScreen() {
  const { t } = useI18n();

  const session = useSession();
  const [error, setError] = useState(''),
    [scope, setScope] = useState<Scope>('mine'),
    [path, setPath] = useState<Folder[]>([]),
    [share, setShare] = useState(false),
    [versions, setVersions] = useState<Version[] | null>(null),
    [showFiles, setShowFiles] = useState(true),
    [destination, setDestination] = useState<MoveTarget | null>(null),
    [allFolders, setAllFolders] = useState<Folder[]>([]);
  const online = useOnlineStatus();
  const [billing, setBilling] = useState(false);
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
    <div className={`app${active && !showFiles ? ' app-editing' : ''}`}>
      <header className="app-header">
        <Link className="brand" href="/">
          <span className="brand-icon">
            <Icon name="document" size={21} />
          </span>
          <span>{t(MESSAGE.writingRoom)}</span>
        </Link>
        <span className="header-subtitle">{t(MESSAGE.documentWorkspace)}</span>
        <LanguageSelector />
        <span className="account-name">{session.user.displayName}</span>
        <button onClick={() => setBilling(true)}>{t(MESSAGE.subscriptionPlans)}</button>
        <button
          className="sign-out"
          onClick={() => {
            documentSession.clearActive();
            void session.signOut().catch((failure) => setError(errorMessage(failure)));
          }}
        >
          {t(MESSAGE.signOut)}{' '}
        </button>
      </header>
      <div className="body">
        <aside className="sidebar">
          <p className="sidebar-label">{t(MESSAGE.library)}</p>
          <button
            className={scope === 'mine' ? 'selected' : ''}
            onClick={() => {
              setScope('mine');
              setPath([]);
              setShowFiles(true);
            }}
          >
            <Icon name="folder" /> {t(MESSAGE.myDocuments)}{' '}
          </button>
          <button
            className={scope === 'shared' ? 'selected' : ''}
            onClick={() => {
              setScope('shared');
              setShowFiles(true);
            }}
          >
            <Icon name="shared" /> {t(MESSAGE.sharedWithMe)}{' '}
          </button>
          <button
            className={scope === 'trash' ? 'selected' : ''}
            onClick={() => {
              setScope('trash');
              setShowFiles(true);
            }}
          >
            <Icon name="trash" /> {t(MESSAGE.trash)}{' '}
          </button>
          <div className="sidebar-note">{t(MESSAGE.deletedDocumentsAreRetainedFor14Days)}</div>
        </aside>
        <main>
          <ErrorNotice message={error} onClose={() => setError('')} />
          <ErrorNotice message={documentSession.recoveryError} />
          {active && !showFiles && (
            <button className="back-to-files" onClick={() => setShowFiles(true)}>
              <Icon name="chevron" size={15} /> {t(MESSAGE.documentList)}{' '}
            </button>
          )}
          {(!active || showFiles) && (
            <div className="workspace">
              <nav aria-label={t(MESSAGE.breadcrumb)}>
                <button onClick={() => setPath([])}>{t(MESSAGE.root)}</button>
                {path.map((folder, index) => (
                  <button key={folder.id} onClick={() => setPath(path.slice(0, index + 1))}>
                    / {folder.name}
                  </button>
                ))}
              </nav>
              <div className="row workspace-heading">
                <h2>
                  {scope === 'mine'
                    ? t(MESSAGE.documents)
                    : scope === 'shared'
                      ? t(MESSAGE.sharedDocuments)
                      : t(MESSAGE.trash)}
                </h2>
                {active && (
                  <button onClick={() => setShowFiles(false)}>{t(MESSAGE.returnToEditor)}</button>
                )}
                {scope === 'mine' && (
                  <>
                    <button
                      className="folder-action"
                      onClick={() => {
                        const name = window.prompt(t(MESSAGE.folderName));
                        if (name) void mutate(() => createFolder(name, parent));
                      }}
                    >
                      {t(MESSAGE.newFolder)}{' '}
                    </button>
                    <button
                      className="primary"
                      onClick={() => {
                        void documentSession.newDoc().then(() => {
                          if (documentSession.activeRef.current) setShowFiles(false);
                        });
                      }}
                    >
                      {t(MESSAGE.newDocument)}{' '}
                    </button>
                  </>
                )}
              </div>
              <div className="file-list">
                <FolderRows
                  folders={contents.folders}
                  onOpen={(folder) => setPath([...path, folder])}
                  onRename={(folder) => {
                    const name = window.prompt(t(MESSAGE.folderName), folder.name);
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
                    void documentSession.open(document).then(() => {
                      if (documentSession.activeRef.current?.document.id === document.id)
                        setShowFiles(false);
                    });
                  }}
                  onRename={(document) => {
                    const title = window.prompt(t(MESSAGE.documentName), document.title);
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
                  <p className="muted">{t(MESSAGE.noDocumentsYet)}</p>
                )}
                {contents.cursor && (
                  <button
                    onClick={() => {
                      void contents.reload(contents.cursor!);
                    }}
                  >
                    {t(MESSAGE.loadMore)}{' '}
                  </button>
                )}
              </div>
            </div>
          )}
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
              onCollaborate={documentSession.collaborate}
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
      {billing && <BillingPanel userId={session.user.id} onClose={() => setBilling(false)} />}
    </div>
  );
}

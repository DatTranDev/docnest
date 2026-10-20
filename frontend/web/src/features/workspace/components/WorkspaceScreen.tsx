'use client';
import { LanguageSelector } from '@/components/ui/LanguageSelector';
import { MESSAGE, useI18n } from '@/lib/i18n';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthForm, useSession } from '@/features/auth';
import { BillingPanel } from '@/features/billing';
import {
  readImportedFile,
  sourceFileType,
  RecoveryPanel,
  VersionDialog,
  listVersions,
  listDocuments,
  moveDocument,
  renameDocument,
  restoreDocument,
  trashDocument,
  useDocumentSession,
  type Version,
  type DocumentInfo,
  type DocumentSortBy,
  type SortDirection,
} from '@/features/documents';
import { EditorPane } from '@/features/editor';
import { SourceFilePane } from '@/features/local-tools';
import { useToolsCopy } from '@/lib/i18n/tools';
import { importTxt } from '@ted/editor-core';
import { ExportJobsPanel, useExportJobs } from '@/features/export-jobs';
import {
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
import { Avatar } from '@/components/ui/Avatar';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
import { ModalDialog } from '@/components/ui/ModalDialog';
import { errorMessage } from '@/lib/http';
import { useOnlineStatus } from '@/lib/react/useOnlineStatus';
import { useLatest } from '@/lib/react/useLatest';
import { MoveDialog } from './MoveDialog';
import { NameDialog } from './NameDialog';
import { ImportDialog } from './ImportDialog';
import { SettingsDialog } from './SettingsDialog';
import { usePreferences } from '../hooks/usePreferences';
import { WorkspaceLibrary } from './WorkspaceLibrary';
import { useWorkspaceContents } from '../hooks/useWorkspaceContents';
import type { MoveTarget, Scope } from '../model/types';
export default function WorkspaceScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const toolsCopy = useToolsCopy();

  const session = useSession();
  const importUser = useLatest(session.user?.id);
  const preferences = usePreferences(session.user?.id);
  const [settings, setSettings] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState(''),
    [scope, setScope] = useState<Scope>('mine'),
    [path, setPath] = useState<Folder[]>([]),
    [share, setShare] = useState(false),
    [versions, setVersions] = useState<Version[] | null>(null),
    [showFiles, setShowFiles] = useState(true),
    [destination, setDestination] = useState<MoveTarget | null>(null),
    [allFolders, setAllFolders] = useState<Folder[]>([]),
    [nameAction, setNameAction] = useState<{
      title: string;
      initial: string;
      submit: (name: string) => Promise<void>;
    } | null>(null),
    [trashUndo, setTrashUndo] = useState<{ id: string; title: string } | null>(null),
    [undoBusy, setUndoBusy] = useState(false),
    [restoreTarget, setRestoreTarget] = useState<DocumentInfo | null>(null),
    [restoreBusy, setRestoreBusy] = useState(false);
  const online = useOnlineStatus();
  const importScope = useLatest(scope);
  const [billing, setBilling] = useState(false);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<DocumentSortBy>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const parent = scope === 'mine' ? (path.at(-1)?.id ?? null) : null;
  const contents = useWorkspaceContents(
    session.user?.id,
    scope,
    parent,
    online,
    setError,
    searchQuery,
    sortBy,
    sortDirection,
  );
  const { reload } = contents;
  const documentSession = useDocumentSession(session.user, parent, contents.reload, setError),
    { active } = documentSession;
  const editMode = (active && sourceFileType(active.document.title)) || 'document';
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
  const createDefaultDocument = () => {
    if (scope !== 'mine') {
      setScope('mine');
      setPath([]);
    }
    setQuery('');
    void documentSession.newDoc().then(() => {
      if (documentSession.activeRef.current) setShowFiles(false);
    });
  };
  const handleImport = async (file: File) => {
    const importingUser = session.user?.id;
    const snapshot = await readImportedFile(file);
    if (importUser.current !== importingUser) return;
    if (importScope.current !== 'mine') setPath([]);
    setScope('mine');
    setQuery('');
    await documentSession.newDoc(snapshot, file.name, {
      skipTitlePrompt: true,
      throwOnError: true,
    });
    if (documentSession.activeRef.current) setShowFiles(false);
  };
  const renameCurrent = async (title: string) => {
    try {
      await documentSession.renameActive(title);
    } catch (failure) {
      setError(errorMessage(failure));
      throw failure;
    }
  };
  const editorBack = (
    <button
      className="back-to-files"
      aria-label={t(MESSAGE.documentList)}
      title={t(MESSAGE.documentList)}
      onClick={() => setShowFiles(true)}
    >
      <Icon name="chevron" size={17} />
    </button>
  );
  const editorNavigation = active ? (
    <nav className="editor-navigation" aria-label={t(MESSAGE.editorNavigation)}>
      {editorBack}
    </nav>
  ) : null;
  if (session.loading) return <LoadingIndicator />;
  const accountUser = session.user;
  if (!accountUser) return <AuthForm onLogin={session.onLogin} error={error} setError={setError} />;
  const mergedEditorHeader = Boolean(active && !showFiles && editMode === 'document');
  const brand = (
    <Link className="brand" href="/">
      <span className="brand-icon">
        <Icon name="document" size={21} />
      </span>
      <span>{t(MESSAGE.writingRoom)}</span>
    </Link>
  );
  const headerAccount = () => (
    <div className="header-account">
      <LanguageSelector iconOnly onLocale={(locale) => preferences.update({ locale })} />
      <ActionMenu
        className="account-menu"
        label={t(MESSAGE.accountActions, { p0: accountUser.displayName })}
        actions={[
          { label: t(MESSAGE.settings), icon: 'settings', onSelect: () => setSettings(true) },
          {
            label: t(MESSAGE.subscriptionPlans),
            icon: 'credit-card',
            onSelect: () => setBilling(true),
          },
          {
            label: t(MESSAGE.aboutDocsnest),
            icon: 'info',
            onSelect: () => router.push('/intro#editor'),
          },
          {
            label: t(MESSAGE.signOut),
            icon: 'sign-out',
            onSelect: () => {
              documentSession.clearActive();
              void session.signOut().catch((failure) => setError(errorMessage(failure)));
            },
          },
        ]}
      >
        <Avatar name={accountUser.displayName} src={accountUser.avatarUrl} size={32} />
        <span className="account-name">{accountUser.displayName}</span>
        <Icon name="chevron-down" size={15} />
      </ActionMenu>
    </div>
  );
  return (
    <div className={`app${active && !showFiles ? ' app-editing' : ''}`}>
      <a className="skip-to-main" href="#workspace-main">
        {toolsCopy.skipToContent}
      </a>
      {!mergedEditorHeader && (
        <header className="app-header">
          {brand}
          <div className="workspace-search" role="search">
            <Icon name="search" size={22} />
            <input
              type="search"
              aria-label={t(MESSAGE.searchCurrentLibrary)}
              placeholder={t(
                scope === 'mine'
                  ? MESSAGE.searchInMine
                  : scope === 'shared'
                    ? MESSAGE.searchInShared
                    : MESSAGE.searchInTrash,
              )}
              value={query}
              maxLength={200}
              onChange={(event) => {
                setQuery(event.target.value);
                setShowFiles(true);
              }}
            />
            {query && (
              <button aria-label={t(MESSAGE.clearSearch)} onClick={() => setQuery('')}>
                <Icon name="close" size={18} />
              </button>
            )}
          </div>
          {headerAccount()}
        </header>
      )}
      <div className="body">
        <aside className="sidebar">
          <ActionMenu
            className="new-menu"
            label={t(MESSAGE.createOrImport)}
            actions={[
              {
                label: t(MESSAGE.newDocument),
                icon: 'document',
                onSelect: createDefaultDocument,
              },
              ...(['markdown', 'json', 'code'] as const).map((kind) => ({
                label:
                  kind === 'markdown'
                    ? toolsCopy.newMarkdown
                    : kind === 'json'
                      ? toolsCopy.newJson
                      : toolsCopy.newCode,
                onSelect: () => {
                  if (scope !== 'mine') {
                    setScope('mine');
                    setPath([]);
                  }
                  setQuery('');
                  void documentSession
                    .newDoc(
                      importTxt(new TextEncoder().encode(kind === 'json' ? '{}\n' : '')),
                      kind === 'markdown'
                        ? 'Ban-thao.md'
                        : kind === 'json'
                          ? 'data.json'
                          : 'snippet.js',
                    )
                    .then(() => {
                      if (documentSession.activeRef.current) setShowFiles(false);
                    });
                },
              })),
              {
                label: t(MESSAGE.newFolder),
                icon: 'folder',
                onSelect: () => {
                  setNameAction({
                    title: t(MESSAGE.newFolder),
                    initial: '',
                    submit: async (name) => {
                      await createFolder(name, scope === 'mine' ? parent : null);
                      if (scope !== 'mine') {
                        setScope('mine');
                        setPath([]);
                      }
                      setQuery('');
                      await reload();
                    },
                  });
                },
              },
              {
                label: t(MESSAGE.importTxtNative),
                icon: 'upload',
                onSelect: () => setImportOpen(true),
              },
            ]}
          >
            <Icon name="plus" size={25} />
            <span>{t(MESSAGE.newItem)}</span>
            <Icon name="chevron-down" size={15} />
          </ActionMenu>
          <input
            ref={importInput}
            type="file"
            hidden
            aria-label={t(MESSAGE.importFile)}
            accept=".txt,.tedoc,.docx,.md,.markdown,.json,.js,.ts,.jsx,.tsx,.py,.html,.css"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              void handleImport(file).catch((failure) => setError(errorMessage(failure)));
            }}
          />
          <p className="sidebar-label">{t(MESSAGE.library)}</p>
          <select
            className="mobile-library-scope"
            aria-label={t(MESSAGE.library)}
            value={scope}
            onChange={(event) => {
              const next = event.target.value as Scope;
              setScope(next);
              if (next === 'mine') setPath([]);
              setQuery('');
              setShowFiles(true);
            }}
          >
            <option value="mine">{t(MESSAGE.myDocuments)}</option>
            <option value="shared">{t(MESSAGE.sharedWithMe)}</option>
            <option value="trash">{t(MESSAGE.trash)}</option>
          </select>
          <button
            className={scope === 'mine' ? 'selected' : ''}
            aria-current={scope === 'mine' ? 'page' : undefined}
            onClick={() => {
              setScope('mine');
              setPath([]);
              setQuery('');
              setShowFiles(true);
            }}
          >
            <Icon name="folder" /> {t(MESSAGE.myDocuments)}{' '}
          </button>
          <button
            className={scope === 'shared' ? 'selected' : ''}
            aria-current={scope === 'shared' ? 'page' : undefined}
            onClick={() => {
              setScope('shared');
              setQuery('');
              setShowFiles(true);
            }}
          >
            <Icon name="shared" /> {t(MESSAGE.sharedWithMe)}{' '}
          </button>
          <button
            className={scope === 'trash' ? 'selected' : ''}
            aria-current={scope === 'trash' ? 'page' : undefined}
            onClick={() => {
              setScope('trash');
              setQuery('');
              setShowFiles(true);
            }}
          >
            <Icon name="trash" /> {t(MESSAGE.trash)}{' '}
          </button>
          {scope === 'trash' && (
            <div className="sidebar-bottom">
              <p className="sidebar-note">{t(MESSAGE.deletedDocumentsAreRetainedFor14Days)}</p>
            </div>
          )}
        </aside>
        <main id="workspace-main" tabIndex={-1}>
          <ErrorNotice message={error} onClose={() => setError('')} />
          <ErrorNotice message={documentSession.recoveryError} />
          {(!active || showFiles) && (
            <WorkspaceLibrary
              key={scope}
              scope={scope}
              path={path}
              folders={contents.folders}
              documents={contents.documents}
              sortBy={sortBy}
              sortDirection={sortDirection}
              onSortBy={(next) => {
                setSortBy(next);
                setSortDirection(next === 'name' ? 'asc' : 'desc');
              }}
              onSortDirection={() =>
                setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
              }
              query={searchQuery}
              loading={contents.loading}
              loadError={contents.loadError}
              hasMore={!!contents.cursor}
              onRetry={() => void contents.reload()}
              onLoadMore={() => {
                if (contents.cursor) void contents.reload(contents.cursor);
              }}
              onPath={(next) => {
                setPath(next);
                setQuery('');
              }}
              onClearSearch={() => setQuery('')}
              folderActions={{
                onOpen: (folder) => {
                  setPath([...path, folder]);
                  setQuery('');
                },
                onRename: (folder) => {
                  setNameAction({
                    title: t(MESSAGE.rename),
                    initial: folder.name,
                    submit: async (name) => {
                      await renameFolder(folder, name);
                      await reload();
                    },
                  });
                },
                onMove: (folder) => {
                  void chooseMove({ kind: 'folder', item: folder });
                },
                onDelete: (folder) => {
                  void mutate(() => deleteFolder(folder));
                },
              }}
              documentActions={{
                onOpen: (document) => {
                  void documentSession.open(document).then(() => {
                    if (documentSession.activeRef.current?.document.id === document.id)
                      setShowFiles(false);
                  });
                },
                onRename: (document) => {
                  setNameAction({
                    title: t(MESSAGE.rename),
                    initial: document.title,
                    submit: async (name) => {
                      await renameDocument(document, name);
                      await reload();
                    },
                  });
                },
                onMove: (document) => {
                  void chooseMove({ kind: 'document', item: document });
                },
                onTrash: (document) => {
                  setError('');
                  void trashDocument(document)
                    .then(async () => {
                      await reload();
                      setTrashUndo({ id: document.id, title: document.title });
                      if (active?.document.id === document.id) documentSession.clearActive();
                    })
                    .catch((failure) => setError(errorMessage(failure)));
                },
                onRestore: (document) => {
                  setRestoreTarget(document);
                },
              }}
            />
          )}
          {active && (
            <div hidden={showFiles}>
              <div id="cloud-editor-panel" role="region" aria-label={toolsCopy[editMode]}>
                {editMode !== 'document' ? (
                  <SourceFilePane
                    key={`${active.document.id}:${editMode}`}
                    active={active}
                    navigation={editorNavigation}
                    collaborators={documentSession.collaborators}
                    status={documentSession.status}
                    saving={documentSession.saving}
                    online={documentSession.online}
                    controllerRef={documentSession.controller}
                    hostRef={documentSession.editorElement}
                    onSave={documentSession.save}
                    onCopy={documentSession.newDoc}
                    onHistory={() => {
                      void listVersions(active.document.id)
                        .then((page) => setVersions(page.items))
                        .catch((failure) => setError(errorMessage(failure)));
                    }}
                    onBackToCurrent={() => void documentSession.open(active.document)}
                    onShare={() => setShare(true)}
                    onRename={renameCurrent}
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
                ) : (
                  <EditorPane
                    active={active}
                    headerAccount={headerAccount()}
                    navigation={editorNavigation}
                    tick={documentSession.tick}
                    collaborators={documentSession.collaborators}
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
                    onBackToCurrent={() => void documentSession.open(active.document)}
                    onShare={() => setShare(true)}
                    onRename={renameCurrent}
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
              </div>
            </div>
          )}
          <ExportJobsPanel jobs={exports.jobs} onUpdate={exports.setJobs} onError={setError} />
        </main>
      </div>
      {trashUndo && (
        <div className="trash-undo" role="status">
          <span>
            {t(MESSAGE.movedToTrash)} {trashUndo.title}
          </span>
          <button
            disabled={undoBusy}
            onClick={() => {
              const target = trashUndo;
              setUndoBusy(true);
              void (async () => {
                let cursor: string | undefined;
                do {
                  const page = await listDocuments('TRASH', null, cursor, target.title);
                  const found = page.items.find((item) => item.id === target.id);
                  if (found) {
                    await restoreDocument(found);
                    await reload();
                    setTrashUndo(null);
                    return;
                  }
                  cursor = page.nextCursor ?? undefined;
                } while (cursor);
                throw new Error(MESSAGE.documentNotFound);
              })()
                .catch((failure) => setError(errorMessage(failure)))
                .finally(() => setUndoBusy(false));
            }}
          >
            {t(MESSAGE.undo)}
          </button>
          <button
            aria-label={t(MESSAGE.close)}
            disabled={undoBusy}
            onClick={() => setTrashUndo(null)}
          >
            ×
          </button>
        </div>
      )}
      {share && active && (
        <ShareDialog
          documentId={active.document.id}
          documentTitle={active.document.title}
          ownerName={accountUser.displayName}
          ownerAvatarUrl={accountUser.avatarUrl}
          onClose={() => setShare(false)}
        />
      )}
      {versions && active && (
        <VersionDialog
          versions={versions}
          activeRevision={active.revision}
          onOpen={(revision) => {
            void documentSession.open(active.document, revision);
          }}
          onBack={() => void documentSession.open(active.document)}
          onCopy={() => {
            void documentSession.newDoc(active.model.snapshot());
            setVersions(null);
          }}
          onClose={() => setVersions(null)}
        />
      )}
      {destination && (
        <MoveDialog
          destination={destination}
          folders={allFolders}
          onMove={async (target) => {
            if (destination.kind === 'folder') await moveFolder(destination.item, target);
            else await moveDocument(destination.item, target);
            await reload();
          }}
          onClose={() => setDestination(null)}
        />
      )}
      {nameAction && (
        <NameDialog
          title={nameAction.title}
          initial={nameAction.initial}
          onSubmit={nameAction.submit}
          onClose={() => setNameAction(null)}
        />
      )}
      {importOpen && <ImportDialog onImport={handleImport} onClose={() => setImportOpen(false)} />}
      {restoreTarget && (
        <ModalDialog
          title={t(MESSAGE.restore)}
          onClose={() => setRestoreTarget(null)}
          className="restore-dialog"
        >
          <h2>
            {t(MESSAGE.restore)} {restoreTarget.title}?
          </h2>
          <p>{t(MESSAGE.restoreAccessWarning)}</p>
          <div className="dialog-actions">
            <button disabled={restoreBusy} onClick={() => setRestoreTarget(null)}>
              {t(MESSAGE.cancel)}
            </button>
            <button
              className="primary"
              disabled={restoreBusy}
              onClick={() => {
                setRestoreBusy(true);
                void restoreDocument(restoreTarget)
                  .then(async () => {
                    await reload();
                    setRestoreTarget(null);
                  })
                  .catch((failure) => setError(errorMessage(failure)))
                  .finally(() => setRestoreBusy(false));
              }}
            >
              {t(MESSAGE.restore)}
            </button>
          </div>
        </ModalDialog>
      )}
      {settings && (
        <SettingsDialog
          user={accountUser}
          onUserUpdated={session.onProfileUpdate}
          theme={preferences.theme}
          sessionOnly={preferences.sessionOnly}
          onLocale={(locale) => preferences.update({ locale })}
          onTheme={(theme) => preferences.update({ theme })}
          onClose={() => setSettings(false)}
        />
      )}
      {billing && <BillingPanel userId={accountUser.id} onClose={() => setBilling(false)} />}
    </div>
  );
}

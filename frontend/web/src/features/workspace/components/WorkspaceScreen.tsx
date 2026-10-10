'use client';
import { LanguageSelector } from '@/components/ui/LanguageSelector';
import { MESSAGE, useI18n } from '@/lib/i18n';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AuthForm, useSession } from '@/features/auth';
import { BillingPanel } from '@/features/billing';
import {
  readImportedFile,
  sourceFileType,
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
import { ActionMenu } from '@/components/ui/ActionMenu';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
import { errorMessage } from '@/lib/http';
import { useOnlineStatus } from '@/lib/react/useOnlineStatus';
import { useLatest } from '@/lib/react/useLatest';
import { MoveDialog } from './MoveDialog';
import { SettingsDialog } from './SettingsDialog';
import { usePreferences } from '../hooks/usePreferences';
import { WorkspaceLibrary } from './WorkspaceLibrary';
import { useWorkspaceContents } from '../hooks/useWorkspaceContents';
import type { MoveTarget, Scope } from '../model/types';
export default function WorkspaceScreen() {
  const { t } = useI18n();
  const toolsCopy = useToolsCopy();

  const session = useSession();
  const importUser = useLatest(session.user?.id);
  const preferences = usePreferences(session.user?.id);
  const [settings, setSettings] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState(''),
    [scope, setScope] = useState<Scope>('mine'),
    [path, setPath] = useState<Folder[]>([]),
    [share, setShare] = useState(false),
    [versions, setVersions] = useState<Version[] | null>(null),
    [showFiles, setShowFiles] = useState(true),
    [destination, setDestination] = useState<MoveTarget | null>(null),
    [allFolders, setAllFolders] = useState<Folder[]>([]);
  const online = useOnlineStatus();
  const importScope = useLatest(scope);
  const [billing, setBilling] = useState(false);
  const [query, setQuery] = useState('');
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
  );
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
        <div className="workspace-search" role="search">
          <Icon name="search" size={22} />
          <input
            type="search"
            aria-label={t(MESSAGE.searchCurrentLibrary)}
            placeholder={t(MESSAGE.searchCurrentLibrary)}
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
        <div className="header-account">
          <LanguageSelector onLocale={(locale) => preferences.update({ locale })} />
          <ActionMenu
            className="account-menu"
            label={t(MESSAGE.accountActions, { p0: session.user.displayName })}
            actions={[
              { label: t(MESSAGE.settings), onSelect: () => setSettings(true) },
              { label: t(MESSAGE.subscriptionPlans), onSelect: () => setBilling(true) },
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
            <span className="account-avatar">
              {Array.from(session.user.displayName.trim())[0]?.toLocaleUpperCase()}
            </span>
            <span className="account-name">{session.user.displayName}</span>
            <Icon name="chevron-down" size={15} />
          </ActionMenu>
        </div>
      </header>
      <div className="body">
        <aside className="sidebar">
          <Link className="sidebar-tools-link" href="/local">
            {t(MESSAGE.localTools)}
          </Link>
          <ActionMenu
            className="new-menu"
            label={t(MESSAGE.newItem)}
            actions={[
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
                label: t(MESSAGE.newDocument),
                icon: 'document',
                onSelect: () => {
                  if (scope !== 'mine') {
                    setScope('mine');
                    setPath([]);
                  }
                  setQuery('');
                  void documentSession.newDoc().then(() => {
                    if (documentSession.activeRef.current) setShowFiles(false);
                  });
                },
              },
              {
                label: t(MESSAGE.newFolder),
                icon: 'folder',
                onSelect: () => {
                  const name = window.prompt(t(MESSAGE.folderName));
                  if (name) {
                    if (scope !== 'mine') {
                      setScope('mine');
                      setPath([]);
                    }
                    setQuery('');
                    void mutate(() => createFolder(name, parent));
                  }
                },
              },
              {
                label: t(MESSAGE.importTxtNative),
                icon: 'upload',
                onSelect: () => importInput.current?.click(),
              },
            ]}
          >
            <Icon name="plus" size={25} />
            <span>{t(MESSAGE.newItem)}</span>
          </ActionMenu>
          <input
            ref={importInput}
            type="file"
            hidden
            aria-label={t(MESSAGE.importFile)}
            accept=".txt,.tedoc,.docx,.md,.markdown,.json,.js,.ts,.jsx,.tsx,.py,.html,.css"
            onChange={(event) => {
              const file = event.target.files?.[0];
              const importingUser = session.user?.id;
              event.target.value = '';
              if (!file) return;
              void readImportedFile(file)
                .then(async (snapshot) => {
                  if (importUser.current !== importingUser) return;
                  if (importScope.current !== 'mine') setPath([]);
                  setScope('mine');
                  setQuery('');
                  await documentSession.newDoc(
                    snapshot,
                    sourceFileType(file.name) ? file.name : undefined,
                  );
                  if (documentSession.activeRef.current) setShowFiles(false);
                })
                .catch((failure) => setError(errorMessage(failure)));
            }}
          />
          <p className="sidebar-label">{t(MESSAGE.library)}</p>
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
          <div className="sidebar-bottom">
            <button onClick={() => setBilling(true)}>
              <Icon name="document" />
              {t(MESSAGE.subscriptionPlans)}
            </button>
            {scope === 'trash' && (
              <p className="sidebar-note">{t(MESSAGE.deletedDocumentsAreRetainedFor14Days)}</p>
            )}
          </div>
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
            <WorkspaceLibrary
              key={scope}
              scope={scope}
              path={path}
              folders={contents.folders}
              documents={contents.documents}
              query={searchQuery}
              loading={contents.loading}
              hasMore={!!contents.cursor}
              onLoadMore={() => {
                if (contents.cursor) void contents.reload(contents.cursor);
              }}
              onPath={(next) => {
                setPath(next);
                setQuery('');
              }}
              onClearSearch={() => setQuery('')}
              onReturnToEditor={active ? () => setShowFiles(false) : undefined}
              folderActions={{
                onOpen: (folder) => {
                  setPath([...path, folder]);
                  setQuery('');
                },
                onRename: (folder) => {
                  const name = window.prompt(t(MESSAGE.folderName), folder.name);
                  if (name) void mutate(() => renameFolder(folder, name));
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
                  const title = window.prompt(t(MESSAGE.documentName), document.title);
                  if (title) void mutate(() => renameDocument(document, title));
                },
                onMove: (document) => {
                  void chooseMove({ kind: 'document', item: document });
                },
                onTrash: (document) => {
                  void mutate(() => trashDocument(document));
                  if (active?.document.id === document.id) documentSession.clearActive();
                },
                onRestore: (document) => {
                  void mutate(() => restoreDocument(document));
                },
              }}
            />
          )}
          {active && (
            <div hidden={showFiles}>
              {sourceFileType(active.document.title) ? (
                <SourceFilePane
                  key={active.document.id}
                  active={active}
                  status={documentSession.status}
                  saving={documentSession.saving}
                  online={documentSession.online}
                  controllerRef={documentSession.controller}
                  hostRef={documentSession.editorElement}
                  onSave={documentSession.save}
                  onHistory={() => {
                    void listVersions(active.document.id)
                      .then((page) => setVersions(page.items))
                      .catch((failure) => setError(errorMessage(failure)));
                  }}
                  onShare={() => setShare(true)}
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
            </div>
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
      {settings && (
        <SettingsDialog
          locale={preferences.locale}
          theme={preferences.theme}
          onLocale={(locale) => preferences.update({ locale })}
          onTheme={(theme) => preferences.update({ theme })}
          onClose={() => setSettings(false)}
        />
      )}
      {billing && <BillingPanel userId={session.user.id} onClose={() => setBilling(false)} />}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import type { DocumentInfo } from '@/features/documents';
import type { Folder } from '@/features/folders';
import { errorMessage } from '@/lib/http';
import { useLatest } from '@/lib/react/useLatest';
import { useRef } from 'react';
import type { Scope } from '../model/types';
import { workspaceContents } from '../api/contents';
export function useWorkspaceContents(
  userId: string | undefined,
  scope: Scope,
  parent: string | null,
  online: boolean,
  onError: (message: string) => void,
) {
  const [documents, setDocuments] = useState<DocumentInfo[]>([]),
    [folders, setFolders] = useState<Folder[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loadedContext, setLoadedContext] = useState('');
  const context = `${userId}/${scope}/${parent ?? 'root'}`,
    currentContext = useLatest(context),
    sequence = useRef(0);
  const reload = useCallback(
    (next?: string): Promise<void> => {
      if (!userId || context !== currentContext.current) return Promise.resolve();
      const requestSequence = ++sequence.current;
      return workspaceContents(scope, parent, next)
        .then(({ listing, folders: entries }) => {
          if (requestSequence !== sequence.current || context !== currentContext.current) return;
          setDocuments(next ? (previous) => [...previous, ...listing.items] : listing.items);
          setCursor(listing.nextCursor);
          setFolders(entries);
          setLoadedContext(context);
        })
        .catch((error) => {
          if (requestSequence === sequence.current && context === currentContext.current)
            onError(errorMessage(error));
        });
    },
    [context, currentContext, onError, parent, scope, userId],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (
      !online ||
      scope === 'trash' ||
      documents.length > 50 ||
      !documents.some((document) => document.headRevision > 0 && !document.preview)
    )
      return;
    const timer = setInterval(() => {
      void reload();
    }, 5000);
    return () => clearInterval(timer);
  }, [documents, online, reload, scope]);
  return {
    documents: loadedContext === context ? documents : [],
    folders: loadedContext === context ? folders : [],
    cursor: loadedContext === context ? cursor : null,
    reload,
  };
}

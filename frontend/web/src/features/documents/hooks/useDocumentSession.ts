'use client';
import { DOCUMENT_TIMING } from '../model/constants';
import { MESSAGE, useI18n } from '@/lib/i18n';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  decodeNative,
  EditorModel,
  encodeNative,
  importTxt,
  sha256,
  type Snapshot,
} from '@ted/editor-core';
import type { User } from '@/features/auth';
import {
  checkpoint,
  clearDraft,
  recover,
  restoreDraft,
  DraftWriter,
  EditorController,
  type DraftMeta,
} from '@/features/editor';
import { ApiError, errorMessage } from '@/lib/http';
import { useOnlineStatus } from '@/lib/react/useOnlineStatus';
import { useLatest } from '@/lib/react/useLatest';
import { createDocument, getDocument, versionContent } from '../api/documents';
import { saveNativeVersion } from '../api/saveDocument';
import type { ActiveDocument, DocumentInfo } from '../model/types';
export function useDocumentSession(
  user: User | null,
  folderId: string | null,
  onDocumentsChanged: () => Promise<void>,
  setError: (message: string) => void,
) {
  const { t, locale } = useI18n();
  const translation = useLatest(t);
  const currentLocale = useLatest(locale);
  const [active, setActive] = useState<ActiveDocument | null>(null),
    [tick, setTick] = useState(0),
    [status, setStatus] = useState<string>(MESSAGE.saved),
    [draft, setDraft] = useState<DraftMeta | null>(null),
    [recoveryError, setRecoveryError] = useState(''),
    [saving, setSaving] = useState(false);
  const online = useOnlineStatus();
  const activeRef = useLatest(active),
    userRef = useLatest(user),
    statusRef = useLatest(status),
    reload = useLatest(onDocumentsChanged),
    parentFolder = useLatest(folderId);
  const editorElement = useRef<HTMLDivElement>(null),
    controller = useRef<EditorController | null>(null),
    saveBusy = useRef(false),
    savePending = useRef(false),
    saveAgain = useRef<() => Promise<void>>(async () => {}),
    lastAuto = useRef(0),
    dirtySince = useRef(0),
    lastEdit = useRef(0),
    changeCount = useRef(0),
    draftWriter = useRef<DraftWriter | null>(null),
    openingSequence = useRef(0);
  useEffect(() => {
    const off = () => {
        setStatus(MESSAGE.offline);
      },
      err = (event: Event) => setError((event as CustomEvent<string>).detail);
    window.addEventListener('offline', off);
    window.addEventListener('editor-error', err);
    return () => {
      window.removeEventListener('offline', off);
      window.removeEventListener('editor-error', err);
    };
  }, [setError]);
  const preserve = useCallback(
    async (a: ActiveDocument, draftUserId = userRef.current?.id): Promise<void> => {
      if (draftUserId && a.model.dirty)
        try {
          await checkpoint(draftUserId, a.document.id, a.document.headRevision, a.model.snapshot());
        } catch (e) {
          setRecoveryError(errorMessage(e));
        }
    },
    [userRef],
  );
  const checkAccess = useCallback(async (): Promise<void> => {
    const a = activeRef.current;
    if (!a) return;
    try {
      const d = await getDocument(a.document.id);
      if (activeRef.current?.model !== a.model) return;
      if (d.effectiveRole === 'VIEWER' && !a.readOnly)
        setActive({ ...a, readOnly: true, document: { ...a.document, effectiveRole: 'VIEWER' } });
      if (
        !controller.current?.collaboration &&
        a.model.dirty &&
        d.headRevision !== a.document.headRevision
      ) {
        setStatus(MESSAGE.conflict);
        await preserve(a);
      }
    } catch (e) {
      if (activeRef.current?.model !== a.model) return;
      if (e instanceof ApiError && [403, 404].includes(e.status)) {
        await preserve(a);
        if (activeRef.current?.model !== a.model) return;
        setActive({ ...a, readOnly: true });
        setError(MESSAGE.accessWasRevokedYourDraftIsRetained);
      }
    }
  }, [activeRef, preserve, setError]);
  const open = useCallback(
    async (d: DocumentInfo, revision?: number): Promise<void> => {
      const user = userRef.current;
      const sequence = ++openingSequence.current;
      setError('');
      setStatus(MESSAGE.opening);
      setDraft(null);
      try {
        if (activeRef.current) await preserve(activeRef.current);
        const latest = await getDocument(d.id),
          rev = revision ?? latest.headRevision,
          s = rev
            ? await decodeNative(await versionContent(d.id, rev))
            : new EditorModel().snapshot();
        if (sequence !== openingSequence.current) return;
        const model = EditorModel.loaded(s);
        setActive({
          document: latest,
          model,
          readOnly: latest.effectiveRole === 'VIEWER' || revision !== undefined,
          revision,
        });
        setStatus(MESSAGE.saved);
        dirtySince.current = 0;
        if (user && revision === undefined) {
          const saved = await recover(user.id, d.id);
          if (saved) {
            const local = await restoreDraft(saved),
              native = await encodeNative(s);
            if (
              (await sha256(native)) !== (await sha256(await encodeNative(local))) &&
              sequence === openingSequence.current
            )
              setDraft(saved);
          }
        }
      } catch (e) {
        if (sequence !== openingSequence.current) return;
        setError(errorMessage(e));
        setStatus(MESSAGE.unableToOpen);
      }
    },
    [activeRef, preserve, setError, userRef],
  );
  const save = useCallback(async (): Promise<void> => {
    const user = userRef.current;
    const initial = activeRef.current;
    if (!initial || initial.readOnly || !initial.model.dirty) return;
    if (saveBusy.current) {
      savePending.current = true;
      return;
    }
    if (!navigator.onLine) {
      setStatus(MESSAGE.offline);
      await preserve(initial, user?.id);
      return;
    }
    if (statusRef.current === MESSAGE.conflict) return;
    saveBusy.current = true;
    setSaving(true);
    setStatus(MESSAGE.saving);
    let s = initial.model.snapshot();
    const base = initial.document.headRevision;
    try {
      await checkAccess();
      if (activeRef.current?.readOnly) throw new Error(MESSAGE.youCannotEditThisDocument);
      const collaborative = controller.current?.collaboration;
      let revision: number;
      if (collaborative) {
        const saved = await controller.current!.saveCollaboration();
        s = saved.snapshot;
        revision = saved.revision;
      } else {
        const native = await (controller.current?.model === initial.model
            ? controller.current.replica.snapshotFor(s)
            : encodeNative(s)),
          result = await saveNativeVersion(initial.document.id, base, native);
        revision = result.version.revision;
      }
      initial.model.savedContentToken = s.contentToken;
      const current = activeRef.current;
      if (current?.model === initial.model) {
        draftWriter.current?.reset(initial.model.snapshot());
        const updated = {
          ...current,
          document: { ...current.document, headRevision: revision },
        };
        setActive(updated);
        activeRef.current = updated;
        setStatus(initial.model.dirty ? MESSAGE.unsaved : MESSAGE.saved);
        dirtySince.current = initial.model.dirty ? Date.now() : 0;
        if (!initial.model.dirty && user) await clearDraft(user.id, initial.document.id);
      }
      await reload.current();
    } catch (e) {
      await preserve(initial, user?.id);
      if (activeRef.current?.model !== initial.model) return;
      if (e instanceof ApiError && e.status === 423) {
        setStatus(MESSAGE.unsaved);
      } else if (e instanceof ApiError && e.status === 409) {
        setStatus(MESSAGE.conflict);
        setError(MESSAGE.aNewerVersionExistsOnTheServerYour);
      } else if (e instanceof ApiError && [403, 404].includes(e.status)) {
        setActive({ ...initial, readOnly: true });
        setError(MESSAGE.editAccessWasRevokedYouCanDownloadThe);
      } else {
        setStatus(navigator.onLine ? MESSAGE.unsaved : MESSAGE.offline);
        setError(errorMessage(e));
      }
    } finally {
      saveBusy.current = false;
      setSaving(false);
      if (savePending.current) {
        savePending.current = false;
        if (statusRef.current !== MESSAGE.conflict) void saveAgain.current();
      }
    }
  }, [activeRef, checkAccess, controller, preserve, reload, setError, statusRef, userRef]);
  const newDoc = useCallback(
    async (snapshot?: Snapshot): Promise<void> => {
      const active = activeRef.current;
      const title = window.prompt(
        translation.current(MESSAGE.documentName),
        snapshot
          ? translation.current(MESSAGE.valueCopy, {
              p0: active?.document.title ?? translation.current(MESSAGE.draft),
            })
          : translation.current(MESSAGE.newDocumentLabel),
      );
      if (!title) return;
      try {
        const d = await createDocument(title, parentFolder.current);
        if (snapshot) {
          const m = EditorModel.loaded(snapshot);
          m.savedContentToken = 'unsaved-copy';
          setActive({ document: d, model: m, readOnly: false });
          setStatus(MESSAGE.unsaved);
          dirtySince.current = Date.now();
          lastEdit.current = Date.now();
        } else await open(d);
        await reload.current();
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [activeRef, open, parentFolder, reload, setError, translation],
  );

  useLayoutEffect(() => {
    saveAgain.current = save;
  }, [save]);
  const selectedModel = active?.model,
    selectedReadOnly = active?.readOnly;
  useEffect(() => {
    const document = activeRef.current;
    if (!document || document.model !== selectedModel || !editorElement.current) return;
    if (userRef.current)
      draftWriter.current = new DraftWriter(
        userRef.current.id,
        document.document.id,
        () => activeRef.current?.document.headRevision ?? document.document.headRevision,
        document.model.snapshot(),
      );
    const instance = new EditorController(
      document.model,
      editorElement.current,
      (delta) => {
        if (delta) draftWriter.current?.track(delta, document.model.snapshot());
        setTick((value) => value + 1);
        lastEdit.current = Date.now();
        dirtySince.current = document.model.dirty ? dirtySince.current || Date.now() : 0;
        changeCount.current++;
        setStatus(
          navigator.onLine
            ? document.model.dirty
              ? MESSAGE.unsaved
              : MESSAGE.saved
            : MESSAGE.offline,
        );
      },
      selectedReadOnly,
      () => {
        const current = activeRef.current;
        const head = controller.current?.collaboration?.headRevision;
        if (
          current?.model === document.model &&
          head !== undefined &&
          head !== current.document.headRevision
        ) {
          const updated = { ...current, document: { ...current.document, headRevision: head } };
          activeRef.current = updated;
          setActive(updated);
        }
        setTick((value) => value + 1);
      },
    );
    instance.setLanguage(currentLocale.current);
    controller.current = instance;
    return () => {
      instance.destroy();
      if (controller.current === instance) controller.current = null;
    };
  }, [activeRef, selectedModel, selectedReadOnly, userRef, currentLocale]);
  useEffect(() => {
    const timer = setInterval(() => {
      const document = activeRef.current,
        currentUser = userRef.current;
      if (!document || !currentUser || !document.model.dirty) return;
      if (
        Date.now() - lastEdit.current >= DOCUMENT_TIMING.draftIdleMs ||
        changeCount.current >= DOCUMENT_TIMING.draftChangeCount
      ) {
        changeCount.current = 0;
        lastEdit.current = Date.now();
        void (
          draftWriter.current?.flush() ??
          checkpoint(
            currentUser.id,
            document.document.id,
            document.document.headRevision,
            document.model.snapshot(),
          )
        ).catch(() => setRecoveryError(MESSAGE.draftRecoveryFailed));
      }
    }, DOCUMENT_TIMING.tickMs);
    return () => clearInterval(timer);
  }, [activeRef, userRef]);
  useEffect(() => {
    const timer = setInterval(() => {
      const document = activeRef.current;
      if (
        !document ||
        !document.model.dirty ||
        document.readOnly ||
        !navigator.onLine ||
        saveBusy.current ||
        statusRef.current === MESSAGE.conflict
      )
        return;
      const now = Date.now();
      if (
        now - lastAuto.current >= DOCUMENT_TIMING.autosaveIntervalMs &&
        (now - lastEdit.current >= DOCUMENT_TIMING.autosaveIdleMs ||
          now - dirtySince.current >= DOCUMENT_TIMING.autosaveMaxDirtyMs)
      ) {
        lastAuto.current = now;
        void saveAgain.current();
      }
    }, DOCUMENT_TIMING.tickMs);
    return () => clearInterval(timer);
  }, [activeRef, statusRef]);
  const activeId = active?.document.id;
  useEffect(() => {
    if (!activeId) return;
    const timer = setInterval(() => {
        void checkAccess();
      }, DOCUMENT_TIMING.accessPollMs),
      focus = () => {
        void checkAccess();
      };
    window.addEventListener('focus', focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [activeId, checkAccess]);
  const clearActive = useCallback(() => {
    openingSequence.current++;
    setActive(null);
  }, []);
  const importFile = useCallback(
    async (file: File) => {
      const document = activeRef.current;
      if (!document || document.readOnly) return;
      if (controller.current?.collaboration) {
        setError(MESSAGE.importIntoANewDocumentWhileCollaborationIs);
        return;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer()),
          snapshot = file.name.endsWith('.tedoc') ? await decodeNative(bytes) : importTxt(bytes);
        await preserve(document);
        if (activeRef.current?.model !== document.model) return;
        const model = EditorModel.loaded(snapshot);
        model.savedContentToken = 'imported';
        setActive({ ...document, model });
        setStatus(MESSAGE.unsaved);
        lastEdit.current = Date.now();
        dirtySince.current = Date.now();
      } catch (error) {
        setError(errorMessage(error));
      }
    },
    [activeRef, preserve, setError],
  );
  const recoverLocal = useCallback(async () => {
    const document = activeRef.current;
    if (!document || !draft) return;
    if (controller.current?.collaboration) {
      setError(MESSAGE.collaborativeDraftsSyncAutomaticallyCreateACopyTo);
      return;
    }
    const snapshot = await restoreDraft(draft),
      model = EditorModel.loaded(snapshot);
    if (activeRef.current?.model !== document.model) return;
    model.savedContentToken = 'recovered';
    setActive({
      ...document,
      model,
      document: { ...document.document, headRevision: draft.baseHeadRevision },
    });
    setStatus(
      draft.baseHeadRevision === document.document.headRevision
        ? MESSAGE.unsaved
        : MESSAGE.conflict,
    );
    setDraft(null);
  }, [activeRef, draft, setError]);
  const discardDraft = useCallback(() => {
    setDraft(null);
    const currentUser = userRef.current,
      document = activeRef.current;
    if (currentUser && document) void clearDraft(currentUser.id, document.document.id);
  }, [activeRef, userRef]);
  const clearHistory = useCallback(() => {
    const document = activeRef.current;
    if (
      document &&
      window.confirm(translation.current(MESSAGE.clearUndoHistoryCurrentContentWillBeRetained))
    ) {
      document.model.clearHistory();
      controller.current?.collaboration?.shared.undoManager.clear();
      setTick((value) => value + 1);
    }
  }, [activeRef, translation]);
  const collaborate = useCallback(async () => {
    const a = activeRef.current,
      user = userRef.current;
    if (!a || !user || a.readOnly || !controller.current) return;
    try {
      if (a.model.dirty) await save();
      if (a.model.dirty) throw new Error(MESSAGE.saveTheDocumentBeforeStartingCollaboration);
      await controller.current.startCollaboration(
        a.document.id,
        user.id,
        activeRef.current!.document.headRevision,
      );
      setTick((value) => value + 1);
    } catch (error) {
      setError(errorMessage(error));
    }
  }, [activeRef, userRef, save, setError]);
  return {
    active,
    activeRef,
    tick,
    status,
    online,
    draft,
    recoveryError,
    saving,
    editorElement,
    controller,
    open,
    save,
    newDoc,
    preserve,
    clearActive,
    importFile,
    recoverLocal,
    discardDraft,
    clearHistory,
    collaborate,
  };
}

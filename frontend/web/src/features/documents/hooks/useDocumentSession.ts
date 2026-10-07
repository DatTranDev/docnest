'use client';
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
  const [active, setActive] = useState<ActiveDocument | null>(null),
    [tick, setTick] = useState(0),
    [status, setStatus] = useState('Đã lưu'),
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
        setStatus('Ngoại tuyến');
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
      if (a.model.dirty && d.headRevision !== a.document.headRevision) {
        setStatus('Xung đột');
        await preserve(a);
      }
    } catch (e) {
      if (activeRef.current?.model !== a.model) return;
      if (e instanceof ApiError && [403, 404].includes(e.status)) {
        await preserve(a);
        if (activeRef.current?.model !== a.model) return;
        setActive({ ...a, readOnly: true });
        setError('Quyền truy cập đã bị thu hồi. Bản nháp của bạn vẫn được giữ.');
      }
    }
  }, [activeRef, preserve, setError]);
  const open = useCallback(
    async (d: DocumentInfo, revision?: number): Promise<void> => {
      const user = userRef.current;
      const sequence = ++openingSequence.current;
      setError('');
      setStatus('Đang mở');
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
        setStatus('Đã lưu');
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
        setStatus('Không mở được');
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
      setStatus('Ngoại tuyến');
      await preserve(initial, user?.id);
      return;
    }
    if (statusRef.current === 'Xung đột') return;
    saveBusy.current = true;
    setSaving(true);
    setStatus('Đang lưu');
    const s = initial.model.snapshot(),
      base = initial.document.headRevision;
    try {
      await checkAccess();
      if (activeRef.current?.readOnly) throw new Error('Bạn không có quyền sửa tài liệu này.');
      const native = await (controller.current?.model === initial.model
          ? controller.current.replica.snapshotFor(s)
          : encodeNative(s)),
        result = await saveNativeVersion(initial.document.id, base, native);
      initial.model.savedContentToken = s.contentToken;
      const current = activeRef.current;
      if (current?.model === initial.model) {
        draftWriter.current?.reset(initial.model.snapshot());
        const updated = {
          ...current,
          document: { ...current.document, headRevision: result.version.revision },
        };
        setActive(updated);
        activeRef.current = updated;
        setStatus(initial.model.dirty ? 'Chưa lưu' : 'Đã lưu');
        dirtySince.current = initial.model.dirty ? Date.now() : 0;
        if (!initial.model.dirty && user) await clearDraft(user.id, initial.document.id);
      }
      await reload.current();
    } catch (e) {
      await preserve(initial, user?.id);
      if (activeRef.current?.model !== initial.model) return;
      if (e instanceof ApiError && e.status === 409) {
        setStatus('Xung đột');
        setError('Có phiên bản mới trên máy chủ. Bản nháp được giữ để bạn chọn cách xử lý.');
      } else if (e instanceof ApiError && [403, 404].includes(e.status)) {
        setActive({ ...initial, readOnly: true });
        setError('Quyền sửa đã bị thu hồi. Bạn có thể tải xuống hoặc tạo bản sao.');
      } else {
        setStatus(navigator.onLine ? 'Chưa lưu' : 'Ngoại tuyến');
        setError(errorMessage(e));
      }
    } finally {
      saveBusy.current = false;
      setSaving(false);
      if (savePending.current) {
        savePending.current = false;
        if (statusRef.current !== 'Xung đột') void saveAgain.current();
      }
    }
  }, [activeRef, checkAccess, controller, preserve, reload, setError, statusRef, userRef]);
  const newDoc = useCallback(
    async (snapshot?: Snapshot): Promise<void> => {
      const active = activeRef.current;
      const title = window.prompt(
        'Tên tài liệu',
        snapshot ? `${active?.document.title ?? 'Bản nháp'} — bản sao` : 'Tài liệu mới',
      );
      if (!title) return;
      try {
        const d = await createDocument(title, parentFolder.current);
        if (snapshot) {
          const m = EditorModel.loaded(snapshot);
          m.savedContentToken = 'unsaved-copy';
          setActive({ document: d, model: m, readOnly: false });
          setStatus('Chưa lưu');
          dirtySince.current = Date.now();
          lastEdit.current = Date.now();
        } else await open(d);
        await reload.current();
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [activeRef, open, parentFolder, reload, setError],
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
        if (!dirtySince.current) dirtySince.current = Date.now();
        changeCount.current++;
        setStatus(navigator.onLine ? 'Chưa lưu' : 'Ngoại tuyến');
      },
      selectedReadOnly,
    );
    controller.current = instance;
    return () => {
      instance.destroy();
      if (controller.current === instance) controller.current = null;
    };
  }, [activeRef, selectedModel, selectedReadOnly, userRef]);
  useEffect(() => {
    const timer = setInterval(() => {
      const document = activeRef.current,
        currentUser = userRef.current;
      if (!document || !currentUser || !document.model.dirty) return;
      if (Date.now() - lastEdit.current >= 2000 || changeCount.current >= 50) {
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
        ).catch((error) =>
          setRecoveryError(
            `Không thể khôi phục bản nháp: ${errorMessage(error)}. Hãy tải bản nháp xuống.`,
          ),
        );
      }
    }, 1000);
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
        statusRef.current === 'Xung đột'
      )
        return;
      const now = Date.now();
      if (
        now - lastAuto.current >= 15000 &&
        (now - lastEdit.current >= 5000 || now - dirtySince.current >= 60000)
      ) {
        lastAuto.current = now;
        void saveAgain.current();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [activeRef, statusRef]);
  const activeId = active?.document.id;
  useEffect(() => {
    if (!activeId) return;
    const timer = setInterval(() => {
        void checkAccess();
      }, 30000),
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
      try {
        const bytes = new Uint8Array(await file.arrayBuffer()),
          snapshot = file.name.endsWith('.tedoc') ? await decodeNative(bytes) : importTxt(bytes);
        await preserve(document);
        if (activeRef.current?.model !== document.model) return;
        const model = EditorModel.loaded(snapshot);
        model.savedContentToken = 'imported';
        setActive({ ...document, model });
        setStatus('Chưa lưu');
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
    const snapshot = await restoreDraft(draft),
      model = EditorModel.loaded(snapshot);
    if (activeRef.current?.model !== document.model) return;
    model.savedContentToken = 'recovered';
    setActive({
      ...document,
      model,
      document: { ...document.document, headRevision: draft.baseHeadRevision },
    });
    setStatus(draft.baseHeadRevision === document.document.headRevision ? 'Chưa lưu' : 'Xung đột');
    setDraft(null);
  }, [activeRef, draft]);
  const discardDraft = useCallback(() => {
    setDraft(null);
    const currentUser = userRef.current,
      document = activeRef.current;
    if (currentUser && document) void clearDraft(currentUser.id, document.document.id);
  }, [activeRef, userRef]);
  const clearHistory = useCallback(() => {
    const document = activeRef.current;
    if (document && window.confirm('Xóa lịch sử hoàn tác? Nội dung hiện tại được giữ.')) {
      document.model.clearHistory();
      setTick((value) => value + 1);
    }
  }, [activeRef]);
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
  };
}

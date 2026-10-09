'use client';
import { MESSAGE, useI18n } from '@/lib/i18n';
import { encodeNative, type Snapshot } from '@ted/editor-core';
import type { DraftMeta } from '@/features/editor';
import { download, errorMessage } from '@/lib/http';
import type { ActiveDocument } from '../model/types';
export function RecoveryPanel({
  active,
  draft,
  status,
  onRecover,
  onDiscard,
  onOpenLatest,
  onCopy,
  onError,
}: {
  active: ActiveDocument;
  draft: DraftMeta | null;
  status: string;
  onRecover: () => Promise<void>;
  onDiscard: () => void;
  onOpenLatest: () => Promise<void>;
  onCopy: (snapshot: Snapshot) => Promise<void>;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();

  return (
    <>
      {draft && (
        <div className="recovery" role="alert">
          {t(MESSAGE.aDraftIsAvailableOnThisDevice)}{' '}
          {draft.baseHeadRevision !== active.document.headRevision
            ? t(MESSAGE.fromAnotherVersionRecoveringItWillPreserveThe)
            : ''}
          <button
            onClick={() => {
              void onRecover().catch((error) => onError(errorMessage(error)));
            }}
          >
            {t(MESSAGE.recoverDraft)}{' '}
          </button>
          <button onClick={onDiscard}>{t(MESSAGE.discardDraft)}</button>
        </div>
      )}
      {status === MESSAGE.conflict && (
        <div className="recovery">
          {t(MESSAGE.theServerVersionHasChanged)}{' '}
          <button
            onClick={() => {
              void onOpenLatest();
            }}
          >
            {t(MESSAGE.openLatest)}{' '}
          </button>
          <button
            onClick={() => {
              void onCopy(active.model.snapshot());
            }}
          >
            {t(MESSAGE.saveChangesAsANewDocument)}{' '}
          </button>
          <button
            onClick={() => {
              void encodeNative(active.model.snapshot())
                .then((bytes) => download(bytes, 'ban-nhap.tedoc'))
                .catch((error) => onError(errorMessage(error)));
            }}
          >
            {t(MESSAGE.downloadDraft)}{' '}
          </button>
          <button onClick={() => onError(MESSAGE.yourDraftIsRetainedSavingIsPausedDuring)}>
            {t(MESSAGE.cancel)}{' '}
          </button>
        </div>
      )}
    </>
  );
}

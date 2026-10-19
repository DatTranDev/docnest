'use client';

import { encodeNative, exportTxt, type EditorModel } from '@ted/editor-core';
import { Icon } from '@/components/ui/Icon';
import { ToolMenu } from '@/components/ui/ToolMenu';
import { download, errorMessage } from '@/lib/http';
import { MESSAGE, useI18n } from '@/lib/i18n';

export function CloudExportMenu({
  model,
  title,
  headRevision,
  onExport,
  onError,
}: {
  model: EditorModel;
  title: string;
  headRevision: number;
  onExport: (type: 'EXPORT_HTML' | 'EXPORT_DOCX' | 'EXPORT_PDF') => Promise<void>;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  return (
    <ToolMenu label={t(MESSAGE.exportDocument)} icon="upload">
      <button
        onClick={() => {
          void encodeNative(model.snapshot())
            .then((bytes) => download(bytes, `${title}.tedoc`))
            .catch((error) => onError(errorMessage(error)));
        }}
      >
        <Icon name="download" /> {t(MESSAGE.downloadNativeFile)}
      </button>
      <button
        onClick={() =>
          download(exportTxt(model.snapshot()), `${title}.txt`, 'text/plain;charset=utf-8')
        }
      >
        <Icon name="download" /> {t(MESSAGE.downloadTxt)}
      </button>
      <div className="menu-divider" />
      <button disabled={!headRevision} onClick={() => void onExport('EXPORT_HTML')}>
        {t(MESSAGE.exportHtmlOnServer)}
      </button>
      <button disabled={!headRevision} onClick={() => void onExport('EXPORT_DOCX')}>
        {t(MESSAGE.exportDocx)}
      </button>
      <button disabled={!headRevision} onClick={() => void onExport('EXPORT_PDF')}>
        {t(MESSAGE.exportPdf)}
      </button>
    </ToolMenu>
  );
}

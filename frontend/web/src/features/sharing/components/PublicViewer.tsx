'use client';
import { LanguageSelector } from '@/components/ui/LanguageSelector';
import { Icon } from '@/components/ui/Icon';
import Link from 'next/link';
import { MESSAGE, useI18n } from '@/lib/i18n';

import { useState, useEffect, useRef } from 'react';
import { decodeNative, EditorModel, encodeNative, exportTxt } from '@ted/editor-core';
import { useLatest } from '@/lib/react/useLatest';
import { download } from '@/lib/http';
import { EditorController } from '@/features/editor';
import { sourceFileType } from '@/features/documents';
import { MarkdownPreview } from '@/features/local-tools';
import { publicShare, publicContent } from '../api/sharing';
function DownloadOptions({
  model,
  title,
  sourceType,
  className,
}: {
  model: EditorModel;
  title: string;
  sourceType: string | null;
  className: string;
}) {
  const { t } = useI18n();
  return (
    <details className={`public-download ${className}`}>
      <summary className="primary">{t(MESSAGE.downloadFormats)} ▾</summary>
      <div className="public-download-menu">
        {!sourceType && (
          <button
            onClick={() =>
              void encodeNative(model.snapshot()).then((bytes) => download(bytes, `${title}.tedoc`))
            }
          >
            {t(MESSAGE.downloadNative)} (.tedoc)
          </button>
        )}
        <button
          onClick={() => download(exportTxt(model.snapshot()), sourceType ? title : `${title}.txt`)}
        >
          {sourceType ? t(MESSAGE.downloadOriginalFormat) : t(MESSAGE.downloadTxt)}
        </button>
      </div>
    </details>
  );
}
export default function PublicViewer({ token }: { token: string }) {
  const { t, locale } = useI18n();

  const currentLocale = useLatest(locale);
  const controller = useRef<EditorController | null>(null);
  useEffect(() => {
    controller.current?.setLanguage(locale);
  }, [locale]);
  const [title, setTitle] = useState(''),
    [model, setModel] = useState<EditorModel | null>(null),
    [error, setError] = useState(''),
    host = useRef<HTMLDivElement>(null);
  const sourceType = sourceFileType(title);
  const sourceText = model?.text.slice() ?? '';
  useEffect(() => {
    let disposed = false;
    void publicShare(token)
      .then(async (d) => {
        const snapshot = d.empty ? null : await decodeNative(await publicContent(d.contentPath!));
        if (disposed) return;
        setTitle(d.title);
        setModel(snapshot ? EditorModel.loaded(snapshot) : new EditorModel());
      })
      .catch(() => {
        if (!disposed) setError(MESSAGE.thisLinkIsInvalidExpiredOrRevoked);
      });
    return () => {
      disposed = true;
    };
  }, [token]);
  useEffect(() => {
    if (model && host.current && !sourceFileType(title)) {
      const c = new EditorController(model, host.current, () => {}, true);
      controller.current = c;
      c.setLanguage(currentLocale.current);
      return () => {
        c.destroy();
        controller.current = null;
      };
    }
  }, [model, currentLocale, title]);
  return (
    <main className="public">
      <header className="public-header">
        <Link className="public-brand" href="/intro">
          <span className="brand-icon">
            <Icon name="document" size={21} />
          </span>
          {t(MESSAGE.writingRoom)}
        </Link>
        <div className="public-header-actions">
          {model && (
            <DownloadOptions
              model={model}
              title={title}
              sourceType={sourceType}
              className="public-download-desktop"
            />
          )}
          <Link href="/intro">{t(MESSAGE.aboutDocsnest)}</Link>
          <LanguageSelector />
        </div>
      </header>
      {error ? (
        <section className="public-unavailable" role="alert">
          <h1>{t(MESSAGE.thisLinkIsUnavailable)}</h1>
          <p>{t(MESSAGE.askSenderForNewLink)}</p>
          <Link href="/intro">{t(MESSAGE.aboutDocsnest)}</Link>
        </section>
      ) : model ? (
        <div className="public-main">
          <div className="public-title-row">
            <h1>{title || t(MESSAGE.sharedDocument)}</h1>
            <span className="public-readonly">{t(MESSAGE.readOnly)}</span>
          </div>
          <DownloadOptions
            model={model}
            title={title}
            sourceType={sourceType}
            className="public-download-mobile"
          />
          <article className="public-reading-surface">
            {sourceType ? (
              sourceText.length > 200_000 ? (
                <p>{t(MESSAGE.publicSourcePreviewLimit)}</p>
              ) : sourceType === 'markdown' ? (
                <MarkdownPreview source={sourceText} />
              ) : (
                <pre className="public-source">{sourceText}</pre>
              )
            ) : (
              <div className="editor-host" ref={host} />
            )}
          </article>
        </div>
      ) : (
        <p className="public-loading" role="status">
          {t(MESSAGE.loading)}
        </p>
      )}
    </main>
  );
}

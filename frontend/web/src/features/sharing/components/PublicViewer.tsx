'use client';
import { LanguageSelector } from '@/components/ui/LanguageSelector';
import { MESSAGE, useI18n } from '@/lib/i18n';

import { useState, useEffect, useRef } from 'react';
import { decodeNative, EditorModel, encodeNative, exportTxt } from '@ted/editor-core';
import { useLatest } from '@/lib/react/useLatest';
import { download } from '@/lib/http';
import { EditorController } from '@/features/editor';
import { publicShare, publicContent } from '../api/sharing';
export default function PublicViewer({ token }: { token: string }) {
  const { t, errorText, locale } = useI18n();

  const currentLocale = useLatest(locale);
  const controller = useRef<EditorController | null>(null);
  useEffect(() => {
    controller.current?.setLanguage(locale);
  }, [locale]);
  const [title, setTitle] = useState(''),
    [model, setModel] = useState<EditorModel | null>(null),
    [error, setError] = useState(''),
    host = useRef<HTMLDivElement>(null);
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
    if (model && host.current) {
      const c = new EditorController(model, host.current, () => {}, true);
      controller.current = c;
      c.setLanguage(currentLocale.current);
      return () => {
        c.destroy();
        controller.current = null;
      };
    }
  }, [model, currentLocale]);
  return (
    <main className="public">
      <LanguageSelector />
      <h1>{title || t(MESSAGE.sharedDocument)}</h1>
      <p>{t(MESSAGE.readOnly)}</p>
      {error && <p role="alert">{errorText(error)}</p>}
      {model && (
        <div className="toolbar">
          <button
            onClick={() => {
              void encodeNative(model.snapshot()).then((b) => download(b, `${title}.tedoc`));
            }}
          >
            {t(MESSAGE.downloadNative)}{' '}
          </button>
          <button onClick={() => download(exportTxt(model.snapshot()), `${title}.txt`)}>
            {t(MESSAGE.downloadTxt)}{' '}
          </button>
        </div>
      )}
      <div className="editor-host" ref={host} />
    </main>
  );
}

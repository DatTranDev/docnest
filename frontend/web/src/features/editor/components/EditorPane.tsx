'use client';
import { MESSAGE, useI18n } from '@/lib/i18n';

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { encodeNative, exportTxt, type EditorModel, type Snapshot } from '@ted/editor-core';
import { Icon } from '@/components/ui/Icon';
import { ToolMenu } from '@/components/ui/ToolMenu';
import { roleLabel } from '@/components/ui/roleLabel';
import { download, errorMessage } from '@/lib/http';
import type { EditorController } from '../model/EditorController';
import { STYLE_BITS } from '../model/constants';
import { ParagraphTools } from './ParagraphTools';
import { CharacterFormattingTools } from './CharacterFormattingTools';
import { PagedPreview } from './PagedPreview';

interface EditorSurface {
  model: EditorModel;
  readOnly: boolean;
  revision?: number;
  document: { title: string; effectiveRole: string; headRevision: number };
}
interface EditorPaneProps {
  localOnly?: boolean;
  active: EditorSurface;
  tick: number;
  status: string;
  online: boolean;
  saving: boolean;
  controller: RefObject<EditorController | null>;
  host: RefObject<HTMLDivElement | null>;
  recovery: ReactNode;
  onSave: () => Promise<void>;
  onCollaborate: () => Promise<void>;
  onCopy: (snapshot: Snapshot) => Promise<void>;
  onImport: (file: File) => Promise<void>;
  onExport: (type: 'EXPORT_TXT' | 'EXPORT_HTML' | 'EXPORT_DOCX' | 'EXPORT_PDF') => Promise<void>;
  onHistory: () => void;
  onShare: () => void;
  onClearHistory: () => void;
  onError: (message: string) => void;
}

function keepSelection(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

export function EditorPane({
  localOnly = false,
  active,
  tick,
  status,
  online,
  saving,
  controller,
  host,
  recovery,
  onSave,
  onCollaborate,
  onCopy,
  onImport,
  onExport,
  onHistory,
  onShare,
  onClearHistory,
  onError,
}: EditorPaneProps) {
  const { t, localize, locale, countLabel } = useI18n();

  const [query, setQuery] = useState(''),
    [replacement, setReplacement] = useState(''),
    [count, setCount] = useState<number | null>(null),
    [ignoreCase, setIgnoreCase] = useState(false),
    [searchOpen, setSearchOpen] = useState(false);
  const [pagePreview, setPagePreview] = useState(false);
  useEffect(() => {
    controller.current?.setLanguage(locale);
  }, [controller, locale, active.model, active.readOnly]);
  const importInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const mask = active.model.pendingMask;
  const character = active.model.pendingFormat;
  const lineStart = active.model.text.text.lineAt(active.model.selection.main.head).from;
  const alignment = active.model.formatting.alignAt(lineStart);
  const find = () => {
    void controller.current
      ?.find(query, ignoreCase)
      .then(setCount)
      .catch((error) => onError(errorMessage(error)));
  };

  return (
    <section
      className="editor-section"
      inert={status === MESSAGE.opening}
      aria-label={t(MESSAGE.textEditor)}
    >
      <div className="editor-heading">
        {!active.readOnly && !localOnly && (
          <button
            type="button"
            disabled={!!controller.current?.collaboration || !online || saving}
            onClick={() => void onCollaborate()}
          >
            {localize(controller.current?.collaboration?.status ?? MESSAGE.editTogether)}
          </button>
        )}
        <div className="editor-heading-main">
          <span className="document-mark">
            <Icon name="document" size={23} />
          </span>
          <div className="editor-identity">
            <h1>{active.document.title}</h1>
            <div className="editor-meta">
              {active.revision !== undefined && (
                <span>
                  {t(MESSAGE.version)} {active.revision} ·{' '}
                </span>
              )}
              {!localOnly && <span>{localize(roleLabel(active.document.effectiveRole))}</span>}
              {active.readOnly && <span> {t(MESSAGE.readOnlyLabel)}</span>}
              {!localOnly && (
                <span className="meta-dot" aria-hidden="true">
                  ·
                </span>
              )}
              <span className="save-status" role="status" aria-live="polite">
                {localize(!online ? MESSAGE.offline : status)}
              </span>
            </div>
          </div>
        </div>
        <div className="editor-heading-actions">
          <button
            className="editor-action"
            disabled={active.readOnly || saving || status === MESSAGE.conflict}
            onClick={() => {
              void onSave();
            }}
          >
            <Icon name="save" size={17} />{' '}
            {t(localOnly ? MESSAGE.downloadNativeFile : MESSAGE.save)}{' '}
          </button>
          {!localOnly && active.document.effectiveRole === 'OWNER' && (
            <button className="primary share-action" onClick={onShare}>
              <Icon name="share" size={17} /> {t(MESSAGE.share)}{' '}
            </button>
          )}
        </div>
      </div>

      <div className="editor-toolbar" role="toolbar" aria-label={t(MESSAGE.editorToolbar)}>
        <div className="tool-group" aria-label={t(MESSAGE.editHistory)}>
          <button
            className="tool-icon"
            title={t(MESSAGE.undoCtrlZ)}
            aria-label={t(MESSAGE.undo)}
            disabled={active.readOnly}
            onMouseDown={keepSelection}
            onClick={() => controller.current?.undo()}
          >
            <Icon name="undo" />
          </button>
          <button
            className="tool-icon"
            title={t(MESSAGE.redoCtrlShiftZ)}
            aria-label={t(MESSAGE.redo)}
            disabled={active.readOnly}
            onMouseDown={keepSelection}
            onClick={() => controller.current?.redo()}
          >
            <Icon name="redo" />
          </button>
        </div>
        <div className="tool-group format-group" aria-label={t(MESSAGE.textFormatting)}>
          <span className="tool-label">{t(MESSAGE.format)}</span>
          <button
            className="tool-icon format-button"
            title={t(MESSAGE.boldCtrlB)}
            aria-label={t(MESSAGE.bold)}
            aria-pressed={Boolean(mask & STYLE_BITS.bold)}
            disabled={active.readOnly}
            onMouseDown={keepSelection}
            onClick={() => controller.current?.format(STYLE_BITS.bold)}
          >
            <b>B</b>
          </button>
          <button
            className="tool-icon format-button"
            title={t(MESSAGE.italicCtrlI)}
            aria-label={t(MESSAGE.italic)}
            aria-pressed={Boolean(mask & STYLE_BITS.italic)}
            disabled={active.readOnly}
            onMouseDown={keepSelection}
            onClick={() => controller.current?.format(STYLE_BITS.italic)}
          >
            <i>I</i>
          </button>
          <button
            className="tool-icon format-button"
            title={t(MESSAGE.underlineCtrlU)}
            aria-label={t(MESSAGE.underline)}
            aria-pressed={Boolean(mask & STYLE_BITS.underline)}
            disabled={active.readOnly}
            onMouseDown={keepSelection}
            onClick={() => controller.current?.format(STYLE_BITS.underline)}
          >
            <u>U</u>
          </button>
        </div>
        <CharacterFormattingTools
          character={character}
          mask={mask}
          readOnly={active.readOnly}
          controller={controller}
        />
        <ParagraphTools
          controller={controller}
          paragraph={active.model.formatting.paragraphAt(lineStart)}
          page={active.model.formatting.page}
          readOnly={active.readOnly}
          onError={onError}
        />
        <div className="tool-group alignment-group" aria-label={t(MESSAGE.paragraphAlignment)}>
          {(
            [
              ['left', MESSAGE.alignLeft, 'align-left'],
              ['center', MESSAGE.alignCenter, 'align-center'],
              ['right', MESSAGE.alignRight, 'align-right'],
              ['justify', MESSAGE.alignJustify, 'align-justify'],
            ] as const
          ).map(([value, label, icon]) => (
            <button
              key={value}
              className={`tool-icon align-button align-button-${value}`}
              title={localize(label)}
              aria-label={localize(label)}
              aria-pressed={alignment === value}
              disabled={active.readOnly}
              onMouseDown={keepSelection}
              onClick={() => controller.current?.alignParagraph(value)}
            >
              <Icon name={icon} size={17} />
            </button>
          ))}
        </div>
        <div className="tool-group" aria-label={t(MESSAGE.insertContent)}>
          <button
            className="tool-text"
            disabled={active.readOnly}
            onMouseDown={keepSelection}
            onClick={() => imageInput.current?.click()}
          >
            {t(MESSAGE.insertImage)}{' '}
          </button>
          <input
            ref={imageInput}
            className="menu-file-input"
            type="file"
            accept="image/png,image/jpeg"
            aria-label={t(MESSAGE.chooseAPngOrJpegImage)}
            disabled={active.readOnly}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file)
                void controller.current
                  ?.addImage(file)
                  .catch((error) => onError(errorMessage(error)));
              event.target.value = '';
            }}
          />
        </div>
        <div className="tool-group">
          <button
            className={`tool-text${searchOpen ? ' is-active' : ''}`}
            aria-expanded={searchOpen}
            aria-controls="document-search"
            onClick={() => setSearchOpen(!searchOpen)}
          >
            <Icon name="search" /> {t(MESSAGE.findReplace)}{' '}
          </button>
        </div>
        <div className="tool-spacer" />
        <button
          className="tool-text"
          aria-pressed={pagePreview}
          onClick={() => setPagePreview(!pagePreview)}
        >
          {pagePreview ? t(MESSAGE.closePagePreview) : t(MESSAGE.pagePreview)}
        </button>
        {!localOnly && (
          <button className="tool-text" onClick={onHistory}>
            <Icon name="history" /> {t(MESSAGE.version)}{' '}
          </button>
        )}
        <ToolMenu label={t(MESSAGE.file)} icon="download">
          <button disabled={active.readOnly} onClick={() => importInput.current?.click()}>
            <Icon name="upload" /> {t(MESSAGE.importTxtNative)}{' '}
          </button>
          <input
            ref={importInput}
            className="menu-file-input"
            aria-label={t(MESSAGE.importFile)}
            type="file"
            accept=".txt,.tedoc,.docx"
            disabled={active.readOnly}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onImport(file);
              event.target.value = '';
            }}
          />
          <button
            onClick={() => {
              void encodeNative(active.model.snapshot())
                .then((bytes) => download(bytes, `${active.document.title}.tedoc`))
                .catch((error) => onError(errorMessage(error)));
            }}
          >
            <Icon name="download" /> {t(MESSAGE.downloadNativeFile)}{' '}
          </button>
          <button
            onClick={() =>
              download(
                exportTxt(active.model.snapshot()),
                `${active.document.title}.txt`,
                'text/plain;charset=utf-8',
              )
            }
          >
            <Icon name="download" /> {t(MESSAGE.downloadTxt)}{' '}
          </button>
          <div className="menu-divider" />
          <button
            disabled={!localOnly && !active.document.headRevision}
            onClick={() => {
              void onExport('EXPORT_TXT');
            }}
          >
            {t(localOnly ? MESSAGE.downloadTxt : MESSAGE.exportTxtOnServer)}{' '}
          </button>
          <button
            disabled={!localOnly && !active.document.headRevision}
            onClick={() => {
              void onExport('EXPORT_HTML');
            }}
          >
            {t(localOnly ? MESSAGE.downloadHtml : MESSAGE.exportHtmlOnServer)}{' '}
          </button>
          {(['EXPORT_DOCX', 'EXPORT_PDF'] as const).map((type) => (
            <button
              key={type}
              disabled={!localOnly && !active.document.headRevision}
              onClick={() => void onExport(type)}
            >
              {t(
                type === 'EXPORT_DOCX'
                  ? MESSAGE.exportDocx
                  : localOnly
                    ? MESSAGE.printPdf
                    : MESSAGE.exportPdf,
              )}
            </button>
          ))}
          <div className="menu-divider" />
          <button
            onClick={() => {
              void onCopy(active.model.snapshot());
            }}
          >
            <Icon name="copy" /> {t(MESSAGE.saveACopy)}{' '}
          </button>
          <button disabled={active.readOnly} onClick={onClearHistory}>
            {t(MESSAGE.clearUndoHistory)}{' '}
          </button>
        </ToolMenu>
      </div>

      {searchOpen && (
        <div className="search" id="document-search" role="search">
          <div className="search-fields">
            <input
              aria-label={t(MESSAGE.search)}
              placeholder={t(MESSAGE.findInDocument)}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCount(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') find();
              }}
            />
            <button disabled={!query} onClick={find}>
              {t(MESSAGE.find)}{' '}
            </button>
            {count !== null && <span className="search-count">{countLabel(count, 'matches')}</span>}
            <input
              aria-label={t(MESSAGE.replace)}
              placeholder={t(MESSAGE.replaceWith)}
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
            />
            <button
              disabled={active.readOnly || !query}
              onClick={() => {
                try {
                  controller.current?.replaceAll(query, replacement, ignoreCase);
                  setCount(null);
                } catch (error) {
                  onError(errorMessage(error));
                }
              }}
            >
              {t(MESSAGE.replaceAll)}{' '}
            </button>
          </div>
          <label className="search-option">
            <input
              type="checkbox"
              checked={ignoreCase}
              onChange={(event) => setIgnoreCase(event.target.checked)}
            />{' '}
            {t(MESSAGE.ignoreAsciiCase)}{' '}
          </label>
          <button
            className="tool-icon search-close"
            aria-label={t(MESSAGE.closeSearch)}
            onClick={() => setSearchOpen(false)}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {recovery}
      {pagePreview && (
        <PagedPreview
          model={active.model}
          imageUrl={(image) => controller.current!.imageUrl(image)}
          onClose={() => setPagePreview(false)}
        />
      )}
      <div className="editor-canvas" hidden={pagePreview}>
        <div className="editor-page">
          <div className="editor-host" ref={host} />
        </div>
      </div>
      <footer className="editor-footer">
        <span>{countLabel(active.model.text.utf8Bytes, 'bytes')}</span>
        <span>{countLabel(active.model.text.lines, 'lines')}</span>
        <span>{tick >= 0 && countLabel(active.model.localRevision, 'changes')}</span>
        <span className="editor-footer-note">{t(MESSAGE.largeFilesMayScrollAndUndoSlowlyOn)} </span>
      </footer>
    </section>
  );
}

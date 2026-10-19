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
import { exportTxt, type EditorModel, type Snapshot } from '@ted/editor-core';
import { Icon } from '@/components/ui/Icon';
import { EditableTitle } from '@/components/ui/EditableTitle';
import { ToolMenu } from '@/components/ui/ToolMenu';
import { roleLabel } from '@/components/ui/roleLabel';
import { download, errorMessage } from '@/lib/http';
import type { EditorController } from '../model/EditorController';
import { STYLE_BITS } from '../model/constants';
import { ParagraphTools } from './ParagraphTools';
import { CharacterFormattingTools } from './CharacterFormattingTools';
import { TextStyleSelect } from './TextStyleSelect';
import { PagedPreview } from './PagedPreview';
import { ImageSizeTools } from './ImageSizeTools';
import { CollaboratorList } from './CollaboratorList';
import { CloudExportMenu } from './CloudExportMenu';
import type { Collaborator } from '../model/CollaborationClient';

interface EditorSurface {
  model: EditorModel;
  readOnly: boolean;
  revision?: number;
  document: { title: string; effectiveRole: string; headRevision: number };
}
interface EditorPaneProps {
  localOnly?: boolean;
  navigation?: ReactNode;
  headerAccount?: ReactNode;
  modeControl?: ReactNode;
  active: EditorSurface;
  tick: number;
  collaborators?: Collaborator[];
  status: string;
  online: boolean;
  saving: boolean;
  controller: RefObject<EditorController | null>;
  host: RefObject<HTMLDivElement | null>;
  recovery: ReactNode;
  onSave: () => Promise<void>;
  onCopy: (snapshot: Snapshot) => Promise<void>;
  onImport: (file: File) => Promise<void>;
  onExport: (type: 'EXPORT_TXT' | 'EXPORT_HTML' | 'EXPORT_DOCX' | 'EXPORT_PDF') => Promise<void>;
  onHistory: () => void;
  onBackToCurrent?: () => void;
  onTitleChange?: (title: string) => void;
  onRename?: (title: string) => Promise<void>;
  onOpenFile?: () => void;
  onShare: () => void;
  onClearHistory: () => void;
  onError: (message: string) => void;
}

function keepSelection(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

export function EditorPane({
  localOnly = false,
  navigation,
  headerAccount,
  modeControl,
  active,
  tick,
  collaborators = [],
  status,
  online,
  saving,
  controller,
  host,
  recovery,
  onSave,
  onCopy,
  onImport,
  onExport,
  onHistory,
  onBackToCurrent,
  onTitleChange,
  onRename,
  onOpenFile,
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
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
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
      className={`editor-section${localOnly ? ' local-only-editor' : ''}${headerAccount ? ' merged-editor-header' : ''}${active.revision !== undefined ? ' historical-view' : ''}`}
      data-role={active.document.effectiveRole}
      aria-busy={status === MESSAGE.opening}
      aria-label={t(MESSAGE.textEditor)}
    >
      <header className="editor-heading">
        {navigation && (
          <div className="editor-heading-navigation" inert={status === MESSAGE.opening}>
            {navigation}
          </div>
        )}
        <div className="editor-heading-main" inert={status === MESSAGE.opening}>
          <span className="document-mark">
            <Icon name="document" size={23} />
          </span>
          <div className="editor-identity">
            {localOnly && onTitleChange ? (
              <input
                className="editor-title-input"
                aria-label={t(MESSAGE.documentName)}
                value={active.document.title}
                maxLength={120}
                onChange={(event) => onTitleChange(event.target.value)}
              />
            ) : onRename ? (
              <EditableTitle
                title={active.document.title}
                label={t(MESSAGE.rename)}
                editable={!active.readOnly && active.revision === undefined}
                onRename={onRename}
              />
            ) : (
              <h1>{active.document.title}</h1>
            )}
            <div className="editor-meta">
              {active.revision !== undefined && (
                <span>
                  {t(MESSAGE.version)} {active.revision} ·{' '}
                </span>
              )}
              {!localOnly && (
                <span className="editor-role">
                  {localize(roleLabel(active.document.effectiveRole))}
                </span>
              )}
              {active.readOnly && <span> {t(MESSAGE.readOnlyLabel)}</span>}
              {!localOnly && (
                <span className="meta-dot" aria-hidden="true">
                  ·
                </span>
              )}
              {!localOnly && (
                <span className="save-status" role="status" aria-live="polite">
                  {online && status === MESSAGE.saved && <Icon name="cloud" size={15} />}
                  {localize(
                    !online
                      ? MESSAGE.offline
                      : status === MESSAGE.saved
                        ? MESSAGE.savedToCloud
                        : status,
                  )}
                </span>
              )}
              {modeControl && <span className="editor-mode-control">{modeControl}</span>}
            </div>
          </div>
        </div>
        <div className="editor-document-actions" inert={status === MESSAGE.opening}>
          <ToolMenu label={t(MESSAGE.file)} icon="more">
            <button
              className={`tool-text${searchOpen ? ' is-active' : ''}`}
              aria-expanded={searchOpen}
              aria-controls="document-search"
              onClick={() => setSearchOpen(!searchOpen)}
            >
              <Icon name="search" /> {t(MESSAGE.findReplace)}{' '}
            </button>
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
            <div className="menu-divider" />
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
            <button onClick={() => void onCopy(active.model.snapshot())}>
              <Icon name="copy" /> {t(MESSAGE.saveACopy)}
            </button>
            <button disabled={active.readOnly} onClick={onClearHistory}>
              {t(MESSAGE.clearUndoHistory)}
            </button>
          </ToolMenu>
        </div>
        <div className="editor-heading-actions" inert={status === MESSAGE.opening}>
          {active.revision !== undefined && onBackToCurrent && (
            <button onClick={onBackToCurrent}>{t(MESSAGE.backToCurrent)}</button>
          )}
          {active.revision !== undefined && !localOnly && (
            <button onClick={() => void onCopy(active.model.snapshot())}>
              {t(MESSAGE.saveAsNewDocument)}
            </button>
          )}
          {localOnly ? (
            <>
              {onOpenFile && <button onClick={onOpenFile}>{t(MESSAGE.openFile)}</button>}
              <ToolMenu label={t(MESSAGE.downloadFormats)} icon="download">
                <button onClick={() => void onSave()}>{t(MESSAGE.downloadNativeFile)}</button>
                <button
                  onClick={() =>
                    download(
                      exportTxt(active.model.snapshot()),
                      `${active.document.title}.txt`,
                      'text/plain;charset=utf-8',
                    )
                  }
                >
                  {t(MESSAGE.downloadTxt)}
                </button>
                <button onClick={() => void onExport('EXPORT_DOCX')}>
                  {t(MESSAGE.exportDocx)}
                </button>
                <button onClick={() => void onExport('EXPORT_HTML')}>
                  {t(MESSAGE.downloadHtml)}
                </button>
                <button onClick={() => void onExport('EXPORT_PDF')}>{t(MESSAGE.printPdf)}</button>
              </ToolMenu>
              <span
                className="local-draft-status"
                data-pending={status === MESSAGE.localDraftNotDownloaded}
                role="status"
                aria-live="polite"
              >
                {localize(status)}
              </span>
            </>
          ) : null}
          {!localOnly && (active.model.dirty || saving || status === MESSAGE.conflict) && (
            <button
              className="editor-action"
              disabled={
                active.readOnly || saving || !active.model.dirty || status === MESSAGE.conflict
              }
              title={!active.model.dirty ? t(MESSAGE.saved) : undefined}
              onClick={() => {
                void onSave();
              }}
            >
              <Icon name="save" size={17} /> {t(MESSAGE.save)}
            </button>
          )}
          {!localOnly && active.revision === undefined && (
            <div className="editor-sharing-actions">
              <CollaboratorList members={collaborators} />
              <CloudExportMenu
                model={active.model}
                title={active.document.title}
                headRevision={active.document.headRevision}
                onExport={onExport}
                onError={onError}
              />
              {active.document.effectiveRole === 'OWNER' && (
                <button className="primary share-action" onClick={onShare}>
                  <Icon name="share" size={17} /> {t(MESSAGE.share)}{' '}
                </button>
              )}
            </div>
          )}
        </div>
        {headerAccount && <div className="editor-heading-account">{headerAccount}</div>}
      </header>

      <div className="editor-interaction-surface" inert={status === MESSAGE.opening}>
        <div className="mobile-editor-toolbar" role="toolbar" aria-label={t(MESSAGE.editorToolbar)}>
          <button
            disabled={active.readOnly}
            aria-label={t(MESSAGE.bold)}
            aria-pressed={Boolean(mask & STYLE_BITS.bold)}
            onMouseDown={keepSelection}
            onClick={() => controller.current?.format(STYLE_BITS.bold)}
          >
            <b>B</b>
          </button>
          <button
            disabled={active.readOnly}
            aria-label={t(MESSAGE.italic)}
            aria-pressed={Boolean(mask & STYLE_BITS.italic)}
            onMouseDown={keepSelection}
            onClick={() => controller.current?.format(STYLE_BITS.italic)}
          >
            <i>I</i>
          </button>
          <button
            disabled={active.readOnly}
            aria-label={t(MESSAGE.bulletList)}
            aria-pressed={active.model.formatting.paragraphAt(lineStart).list === 'bullet'}
            onMouseDown={keepSelection}
            onClick={() =>
              controller.current?.formatParagraph({
                list:
                  active.model.formatting.paragraphAt(lineStart).list === 'bullet'
                    ? undefined
                    : 'bullet',
              })
            }
          >
            • ≡
          </button>
          <button
            className="mobile-format-toggle"
            aria-expanded={mobileToolsOpen}
            onClick={() => setMobileToolsOpen((open) => !open)}
          >
            {t(MESSAGE.format)}
          </button>
        </div>
        <div
          className={`editor-toolbar${mobileToolsOpen ? ' mobile-open' : ''}`}
          role="toolbar"
          aria-label={t(MESSAGE.editorToolbar)}
        >
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
          <TextStyleSelect
            character={character}
            mask={mask}
            readOnly={active.readOnly}
            controller={controller}
          />
          <div className="tool-group format-group" aria-label={t(MESSAGE.textFormatting)}>
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
          <ToolMenu label={t(MESSAGE.format)} closeOnSelect={false}>
            <div className="advanced-format-tools">
              <CharacterFormattingTools
                character={character}
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
            </div>
          </ToolMenu>
          <button
            className="tool-icon bullet-tool"
            aria-label={t(MESSAGE.bulletList)}
            title={t(MESSAGE.bulletList)}
            aria-pressed={active.model.formatting.paragraphAt(lineStart).list === 'bullet'}
            disabled={active.readOnly}
            onMouseDown={keepSelection}
            onClick={() =>
              controller.current?.formatParagraph({
                list:
                  active.model.formatting.paragraphAt(lineStart).list === 'bullet'
                    ? undefined
                    : 'bullet',
              })
            }
          >
            • ≡
          </button>
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
              {count !== null && (
                <span className="search-count">{countLabel(count, 'matches')}</span>
              )}
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
        <ImageSizeTools
          model={active.model}
          tick={tick}
          readOnly={active.readOnly}
          controller={controller}
          onError={onError}
        />
        {recovery}
        {pagePreview && (
          <PagedPreview
            model={active.model}
            imageUrl={(image) => controller.current!.imageUrl(image)}
            readOnly={active.readOnly}
            onPageChange={(page) => controller.current?.setPage(page)}
            onClose={() => setPagePreview(false)}
          />
        )}
        <div className="editor-canvas" hidden={pagePreview}>
          <div className="editor-page">
            {!active.readOnly && active.model.text.text.length === 0 && (
              <span className="editor-empty-hint" aria-hidden="true">
                {t(MESSAGE.startWritingHere)}
              </span>
            )}
            <div className="editor-host" ref={host} />
          </div>
        </div>
        <footer className="editor-footer">
          <span>{countLabel(active.model.text.utf8Bytes, 'bytes')}</span>
          <span>{countLabel(active.model.text.lines, 'lines')}</span>
          <span>{tick >= 0 && countLabel(active.model.localRevision, 'changes')}</span>
          <span className="editor-footer-note">
            {t(MESSAGE.largeFilesMayScrollAndUndoSlowlyOn)}{' '}
          </span>
        </footer>
      </div>
    </section>
  );
}

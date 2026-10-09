'use client';
import { useState, type MouseEvent, type RefObject } from 'react';
import {
  FONT_FAMILIES,
  TEXT_STYLE_PRESETS,
  type TextStylePreset,
  type CharacterFormat,
} from '@ted/editor-core';
import { MESSAGE, useI18n } from '@/lib/i18n';
import type { EditorController } from '../model/EditorController';
import { FONT_SIZE_OPTIONS, DEFAULT_CHARACTER_STYLE } from '../model/constants';
function keepSelection(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}
export function CharacterFormattingTools({
  character,
  mask,
  readOnly,
  controller,
}: {
  character: CharacterFormat;
  mask: number;
  readOnly: boolean;
  controller: RefObject<EditorController | null>;
}) {
  const { t } = useI18n();
  const [highlightColor, setHighlightColor] = useState('#ffff00');
  const preset =
    (Object.keys(TEXT_STYLE_PRESETS) as TextStylePreset[]).find((key) => {
      const value = TEXT_STYLE_PRESETS[key];
      return (
        !character.background &&
        !character.strike &&
        (!character.script || character.script === 'normal') &&
        value.mask === mask &&
        value.font === (character.font ?? DEFAULT_CHARACTER_STYLE.font) &&
        value.size === (character.size ?? DEFAULT_CHARACTER_STYLE.size) &&
        value.color === (character.color ?? DEFAULT_CHARACTER_STYLE.color).toLowerCase()
      );
    }) ?? 'custom';
  const presetLabels = {
    normal: MESSAGE.normalText,
    title: MESSAGE.documentTitleStyle,
    subtitle: MESSAGE.subtitle,
    heading1: MESSAGE.heading1,
    heading2: MESSAGE.heading2,
    heading3: MESSAGE.heading3,
    heading4: MESSAGE.heading4,
    heading5: MESSAGE.heading5,
    heading6: MESSAGE.heading6,
  };

  return (
    <>
      {' '}
      <div className="tool-group rich-format-group" aria-label={t(MESSAGE.fontAndTextColor)}>
        <select
          aria-label={t(MESSAGE.textStyle)}
          value={preset}
          disabled={readOnly}
          onChange={(event) =>
            controller.current?.applyTextStyle(event.target.value as TextStylePreset)
          }
        >
          <option value="custom" disabled>
            {t(MESSAGE.customStyle)}
          </option>
          {(Object.keys(presetLabels) as TextStylePreset[]).map((key) => (
            <option key={key} value={key}>
              {t(presetLabels[key])}
            </option>
          ))}
        </select>
        <select
          aria-label={t(MESSAGE.font)}
          title={t(MESSAGE.font)}
          disabled={readOnly}
          value={character.font ?? DEFAULT_CHARACTER_STYLE.font}
          onChange={(event) =>
            controller.current?.formatCharacter({
              font: event.target.value as (typeof FONT_FAMILIES)[number],
            })
          }
        >
          {FONT_FAMILIES.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>
        <button
          className="tool-icon"
          aria-label={t(MESSAGE.decreaseFontSize)}
          title={t(MESSAGE.decreaseFontSize)}
          disabled={readOnly || (character.size ?? DEFAULT_CHARACTER_STYLE.size) <= 8}
          onMouseDown={keepSelection}
          onClick={() =>
            controller.current?.formatCharacter({
              size: Math.max(8, (character.size ?? DEFAULT_CHARACTER_STYLE.size) - 1),
            })
          }
        >
          −
        </button>
        <select
          aria-label={t(MESSAGE.fontSize)}
          title={t(MESSAGE.fontSize)}
          disabled={readOnly}
          value={character.size ?? DEFAULT_CHARACTER_STYLE.size}
          onChange={(event) =>
            controller.current?.formatCharacter({ size: Number(event.target.value) })
          }
        >
          {!FONT_SIZE_OPTIONS.some(
            (size) => size === (character.size ?? DEFAULT_CHARACTER_STYLE.size),
          ) && <option value={character.size}>{character.size}</option>}
          {FONT_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <button
          className="tool-icon"
          aria-label={t(MESSAGE.increaseFontSize)}
          title={t(MESSAGE.increaseFontSize)}
          disabled={readOnly || (character.size ?? DEFAULT_CHARACTER_STYLE.size) >= 72}
          onMouseDown={keepSelection}
          onClick={() =>
            controller.current?.formatCharacter({
              size: Math.min(72, (character.size ?? DEFAULT_CHARACTER_STYLE.size) + 1),
            })
          }
        >
          +
        </button>
        <button
          className="tool-text"
          disabled={readOnly}
          title={t(MESSAGE.clearFormatting)}
          onMouseDown={keepSelection}
          onClick={() => controller.current?.clearFormatting()}
        >
          {t(MESSAGE.clearFormatting)}
        </button>
        <label className="color-tool" title={t(MESSAGE.textColor)}>
          <span aria-hidden="true">A</span>
          <input
            aria-label={t(MESSAGE.textColor)}
            type="color"
            disabled={readOnly}
            value={character.color ?? DEFAULT_CHARACTER_STYLE.color}
            onChange={(event) => controller.current?.formatCharacter({ color: event.target.value })}
          />
        </label>
      </div>
      <div className="tool-group" aria-label={t(MESSAGE.textFormatting)}>
        <button
          className="tool-icon"
          title={t(MESSAGE.strikethrough)}
          aria-label={t(MESSAGE.strikethrough)}
          aria-pressed={Boolean(character.strike)}
          disabled={readOnly}
          onMouseDown={keepSelection}
          onClick={() => controller.current?.formatCharacter({ strike: !character.strike })}
        >
          <s>S</s>
        </button>
        <button
          className="tool-icon"
          title={t(MESSAGE.superscript)}
          aria-label={t(MESSAGE.superscript)}
          aria-pressed={character.script === 'super'}
          disabled={readOnly}
          onMouseDown={keepSelection}
          onClick={() =>
            controller.current?.formatCharacter({
              script: character.script === 'super' ? 'normal' : 'super',
            })
          }
        >
          x<sup>2</sup>
        </button>
        <button
          className="tool-icon"
          title={t(MESSAGE.subscript)}
          aria-label={t(MESSAGE.subscript)}
          aria-pressed={character.script === 'sub'}
          disabled={readOnly}
          onMouseDown={keepSelection}
          onClick={() =>
            controller.current?.formatCharacter({
              script: character.script === 'sub' ? 'normal' : 'sub',
            })
          }
        >
          x<sub>2</sub>
        </button>
        <button
          className="tool-icon"
          type="button"
          aria-label={t(MESSAGE.highlightText)}
          disabled={readOnly}
          onMouseDown={keepSelection}
          onClick={() =>
            controller.current?.formatCharacter({
              background: character.background ?? highlightColor,
            })
          }
        >
          ▰
        </button>
        <label className="color-tool" title={t(MESSAGE.highlightColor)}>
          <span aria-hidden="true">▰</span>
          <input
            type="color"
            aria-label={t(MESSAGE.highlightColor)}
            disabled={readOnly}
            value={character.background ?? highlightColor}
            onChange={(event) => {
              setHighlightColor(event.target.value);
              controller.current?.formatCharacter({ background: event.target.value });
            }}
          />
        </label>
        <button
          className="tool-text"
          disabled={readOnly || !character.background}
          onMouseDown={keepSelection}
          onClick={() => controller.current?.formatCharacter({ background: null })}
        >
          {t(MESSAGE.clearHighlight)}
        </button>
      </div>
    </>
  );
}

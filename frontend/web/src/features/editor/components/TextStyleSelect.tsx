'use client';
import { TEXT_STYLE_PRESETS, type TextStylePreset, type CharacterFormat } from '@ted/editor-core';
import type { RefObject } from 'react';
import { MESSAGE, useI18n } from '@/lib/i18n';
import type { EditorController } from '../model/EditorController';
import { DEFAULT_CHARACTER_STYLE } from '../model/constants';

export function TextStyleSelect({
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
  );
}

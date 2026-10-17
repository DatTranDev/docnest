'use client';

import { useState, type RefObject } from 'react';
import { MAX_IMAGE_DIMENSION_PX, type EditorModel, type PlacedImage } from '@ted/editor-core';
import { MESSAGE, useI18n } from '@/lib/i18n';
import { errorMessage } from '@/lib/http';
import type { EditorController } from '../model/EditorController';

interface Props {
  model: EditorModel;
  tick: number;
  readOnly: boolean;
  controller: RefObject<EditorController | null>;
  onError: (message: string) => void;
}

export function ImageSizeTools({ model, readOnly, controller, onError }: Props) {
  const { t } = useI18n();
  if (readOnly || model.images.empty) return null;
  const { from, to } = model.selection.main;
  const image = model.images.at(from) ?? (from === to ? model.images.at(from - 1) : undefined);
  return (
    <aside className="image-size-tools" aria-label={t(MESSAGE.imageSize)}>
      {image ? (
        <ImageSizeForm key={image.id} image={image} controller={controller} onError={onError} />
      ) : (
        <span>{t(MESSAGE.imageResizeHint)}</span>
      )}
    </aside>
  );
}

function ImageSizeForm({
  image,
  controller,
  onError,
}: Pick<Props, 'controller' | 'onError'> & { image: PlacedImage }) {
  const { t } = useI18n();
  const [width, setWidth] = useState(String(image.width));
  const [height, setHeight] = useState(String(image.height));
  const [locked, setLocked] = useState(true);
  const [busy, setBusy] = useState(false);
  const valid = [Number(width), Number(height)].every(
    (n) => Number.isInteger(n) && n >= 1 && n <= MAX_IMAGE_DIMENSION_PX,
  );
  const change = (value: string, axis: 'width' | 'height') => {
    if (axis === 'width') {
      setWidth(value);
      if (locked && Number(value) > 0)
        setHeight(String(Math.max(1, Math.round((Number(value) * image.height) / image.width))));
    } else {
      setHeight(value);
      if (locked && Number(value) > 0)
        setWidth(String(Math.max(1, Math.round((Number(value) * image.width) / image.height))));
    }
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || busy) return;
        setBusy(true);
        void controller.current
          ?.resizeImage(image.id, Number(width), Number(height))
          .catch((error) => onError(errorMessage(error)))
          .finally(() => setBusy(false));
      }}
    >
      <strong>{t(MESSAGE.imageSize)}</strong>
      {(['width', 'height'] as const).map((axis) => (
        <label key={axis}>
          {t(axis === 'width' ? MESSAGE.imageWidth : MESSAGE.imageHeight)}
          <input
            type="number"
            min={1}
            max={MAX_IMAGE_DIMENSION_PX}
            step={1}
            required
            disabled={busy}
            value={axis === 'width' ? width : height}
            onChange={(event) => change(event.target.value, axis)}
          />
        </label>
      ))}
      <label className="image-ratio-option">
        <input
          type="checkbox"
          checked={locked}
          disabled={busy}
          onChange={(event) => setLocked(event.target.checked)}
        />
        {t(MESSAGE.keepImageRatio)}
      </label>
      <button
        type="submit"
        disabled={
          busy || !valid || (Number(width) === image.width && Number(height) === image.height)
        }
      >
        {t(MESSAGE.applyImageSize)}
      </button>
      <small>{t(MESSAGE.imageResizeHint)}</small>
    </form>
  );
}

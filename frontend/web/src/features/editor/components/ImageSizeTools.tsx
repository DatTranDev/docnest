'use client';

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
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

export function ImageSizeTools({ model, tick, readOnly, controller, onError }: Props) {
  const { t } = useI18n();
  const { from, to } = model.selection.main;
  const image = !readOnly && to === from + 1 ? model.images.at(from) : undefined;
  const imageId = image?.id;
  const popover = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!imageId) return;
    const panel = popover.current;
    const node = Array.from(
      controller.current?.view.dom.querySelectorAll<HTMLImageElement>('.editor-inline-image') ?? [],
    ).find((entry) => entry.dataset.imageId === imageId);
    const place = () => {
      if (!node || !panel) {
        setPosition(null);
        return;
      }
      const anchor = node.getBoundingClientRect();
      if (anchor.bottom < 0 || anchor.top > innerHeight) {
        setPosition(null);
        return;
      }
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      setPosition({
        left: Math.max(8, Math.min(anchor.left, innerWidth - width - 8)),
        top:
          anchor.bottom + height + 8 <= innerHeight
            ? anchor.bottom + 8
            : Math.max(8, anchor.top - height - 8),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const dismiss = (event: PointerEvent) => {
      if (
        panel &&
        node &&
        event.target instanceof Node &&
        !panel.contains(event.target) &&
        !node.contains(event.target) &&
        !controller.current?.view.dom.contains(event.target)
      ) {
        controller.current?.view.dispatch({ selection: { anchor: to } });
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', dismiss);
    };
  }, [controller, imageId, tick, to]);
  if (!image) return null;
  return (
    <aside
      ref={popover}
      className="image-size-tools"
      aria-label={t(MESSAGE.imageSize)}
      style={position ? { left: position.left, top: position.top } : { visibility: 'hidden' }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        controller.current?.view.dispatch({ selection: { anchor: to } });
        controller.current?.view.focus();
      }}
    >
      <ImageSizeForm key={image.id} image={image} controller={controller} onError={onError} />
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

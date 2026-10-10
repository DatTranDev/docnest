'use client';
import { useEffect, type RefObject } from 'react';
import type { SourceHandle } from './SourceEditor';
import { mappedOffset, type ScrollAnchor } from '../model/scrollMap';

export function useMarkdownScrollSync(
  sourceRef: RefObject<Pick<SourceHandle, 'scrollDOM' | 'lineTop'> | null>,
  previewRef: RefObject<HTMLDivElement | null>,
  rendered: string,
  enabled: boolean,
) {
  useEffect(() => {
    const sourceHandle = sourceRef.current,
      previewElement = previewRef.current;
    if (!enabled || !sourceHandle || !previewElement) return;
    const editor = sourceHandle,
      preview = previewElement;
    const source = editor.scrollDOM;
    const panes = { source, preview };
    let anchors: ScrollAnchor[] = [],
      invalid = true,
      frame = 0;
    let leader: keyof ScrollAnchor = 'source';
    const expected: Partial<ScrollAnchor> = {};
    function measure() {
      const top = preview.getBoundingClientRect().top + preview.clientTop;
      anchors = [{ source: 0, preview: 0 }];
      let lastLine = 0;
      for (const block of Array.from(preview.querySelectorAll<HTMLElement>('[data-source-line]'))) {
        const line = Number(block.dataset.sourceLine);
        const y = block.getBoundingClientRect().top - top + preview.scrollTop;
        const x = editor.lineTop(line);
        const previous = anchors[anchors.length - 1]!;
        // Nested containers can share the first line; keep a monotonic map.
        if (line > lastLine && x > previous.source && y > previous.preview) {
          anchors.push({ source: x, preview: y });
          lastLine = line;
        }
      }
      anchors.push({ source: source.scrollHeight, preview: preview.scrollHeight });
      invalid = false;
    }
    function sync() {
      frame = 0;
      if (!source.clientHeight || !preview.clientHeight) return;
      if (invalid) measure();
      const follower = leader === 'source' ? 'preview' : 'source';
      const from = panes[leader],
        to = panes[follower];
      const maximum = from.scrollHeight - from.clientHeight;
      const targetMaximum = to.scrollHeight - to.clientHeight;
      const target =
        from.scrollTop <= 1
          ? 0
          : maximum > 0 && from.scrollTop >= maximum - 1
            ? targetMaximum
            : Math.max(0, Math.min(targetMaximum, mappedOffset(anchors, from.scrollTop, leader)));
      if (Math.abs(to.scrollTop - target) > 0.5) {
        to.scrollTop = target;
        // Store the browser's clamped/rounded value to ignore only our own scroll event.
        expected[follower] = to.scrollTop;
      }
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(sync);
    }
    function scroll(side: keyof ScrollAnchor) {
      if (expected[side] !== undefined && Math.abs(panes[side].scrollTop - expected[side]!) < 1) {
        delete expected[side];
        return;
      }
      delete expected[side];
      leader = side;
      schedule();
    }
    const onSource = () => scroll('source'),
      onPreview = () => scroll('preview');
    source.addEventListener('scroll', onSource, { passive: true });
    preview.addEventListener('scroll', onPreview, { passive: true });
    const observer = new ResizeObserver(() => {
      invalid = true;
      schedule();
    });
    observer.observe(source);
    observer.observe(preview);
    const body = preview.querySelector('.markdown-body');
    if (body) observer.observe(body);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      source.removeEventListener('scroll', onSource);
      preview.removeEventListener('scroll', onPreview);
    };
  }, [sourceRef, previewRef, rendered, enabled]);
}

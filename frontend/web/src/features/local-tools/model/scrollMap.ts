export interface ScrollAnchor {
  source: number;
  preview: number;
}
/** Interpolate within the corresponding Markdown block, rather than whole-document ratios. */
export function mappedOffset(
  anchors: readonly ScrollAnchor[],
  offset: number,
  from: keyof ScrollAnchor,
): number {
  const to = from === 'source' ? 'preview' : 'source';
  let left = anchors[0];
  if (!left) return 0;
  if (offset <= left[from]) return left[to];
  for (const right of anchors.slice(1)) {
    if (offset <= right[from]) {
      const span = right[from] - left[from];
      return left[to] + (span ? (offset - left[from]) / span : 0) * (right[to] - left[to]);
    }
    left = right;
  }
  return left[to];
}

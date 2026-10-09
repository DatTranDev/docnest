export const FONT_SIZE_OPTIONS = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72,
] as const;
export const DEFAULT_CHARACTER_STYLE = { font: 'Arial', size: 11, color: '#202124' } as const;
export const STYLE_BITS = { bold: 1, italic: 2, underline: 4 } as const;
export const CLIPBOARD = {
  mime: 'application/x-ted-text-style-v1',
  maxPayloadBytes: 32 * 1024 * 1024,
  maxStyleBytes: 8 * 1024 * 1024,
  base64ChunkBytes: 32768,
} as const;
export const PAGE_PREVIEW = {
  maxTextUnits: 200_000,
  widthPx: 794,
  gapPx: 24,
  horizontalPaddingPx: 72,
} as const;
export const COLLABORATION_LIMITS = {
  updateBytes: 12 * 1024 * 1024,
  pendingBytes: 32 * 1024 * 1024,
  catchupPages: 200,
  pollMs: 500,
} as const;

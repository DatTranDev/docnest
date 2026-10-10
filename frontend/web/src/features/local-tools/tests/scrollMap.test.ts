import { describe, expect, it } from 'vitest';
import { mappedOffset } from '../model/scrollMap';

describe('Markdown content correspondence', () => {
  const anchors = [
    { source: 0, preview: 0 },
    { source: 100, preview: 800 },
    { source: 300, preview: 900 },
  ];
  it('follows corresponding blocks despite different source and rendered heights', () => {
    expect(mappedOffset(anchors, 100, 'source')).toBe(800);
    expect(mappedOffset(anchors, 200, 'source')).toBe(850);
    expect(mappedOffset(anchors, 850, 'preview')).toBe(200);
  });
  it('clamps outside content and handles empty or collapsed blocks', () => {
    expect(mappedOffset(anchors, -20, 'source')).toBe(0);
    expect(mappedOffset(anchors, 1000, 'preview')).toBe(300);
    expect(mappedOffset([], 10, 'source')).toBe(0);
    expect(
      mappedOffset(
        [
          { source: 0, preview: 0 },
          { source: 10, preview: 0 },
          { source: 20, preview: 30 },
        ],
        15,
        'preview',
      ),
    ).toBe(15);
  });
});

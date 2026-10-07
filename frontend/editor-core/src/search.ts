export type SearchResult = { count: number; matches: number[]; truncated: boolean };
const fold = (c: number) => (c >= 65 && c <= 90 ? c + 32 : c);
export function* literalMatches(
  chunks: Iterable<string>,
  query: string,
  ignoreAsciiCase = false,
  cancelled = () => false,
): Generator<number> {
  if (!query) return;
  const p = Array.from({ length: query.length }, (_, i) =>
      ignoreAsciiCase ? fold(query.charCodeAt(i)) : query.charCodeAt(i),
    ),
    table = new Uint32Array(p.length);
  for (let i = 1, j = 0; i < p.length; i++) {
    while (j && p[i] !== p[j]) j = table[j - 1]!;
    if (p[i] === p[j]) j++;
    table[i] = j;
  }
  let j = 0,
    pos = 0;
  for (const chunk of chunks) {
    if (cancelled()) throw new Error('CANCELLED');
    for (let i = 0; i < chunk.length; i++, pos++) {
      const c = ignoreAsciiCase ? fold(chunk.charCodeAt(i)) : chunk.charCodeAt(i);
      while (j && c !== p[j]) j = table[j - 1]!;
      if (c === p[j]) j++;
      if (j === p.length) {
        yield pos - p.length + 1;
        j = 0;
      }
    }
  }
}
export function search(
  chunks: Iterable<string>,
  query: string,
  ignoreAsciiCase = false,
  cancelled = () => false,
  maxMatches = 10000,
): SearchResult {
  if (!query) return { count: 0, matches: [], truncated: false };
  const p = Array.from({ length: query.length }, (_, i) =>
      ignoreAsciiCase ? fold(query.charCodeAt(i)) : query.charCodeAt(i),
    ),
    table = new Uint32Array(p.length);
  for (let i = 1, j = 0; i < p.length; i++) {
    while (j && p[i] !== p[j]) j = table[j - 1]!;
    if (p[i] === p[j]) j++;
    table[i] = j;
  }
  let j = 0,
    pos = 0,
    count = 0;
  const matches: number[] = [];
  for (const chunk of chunks) {
    if (cancelled()) throw new Error('CANCELLED');
    for (let i = 0; i < chunk.length; i++, pos++) {
      const c = ignoreAsciiCase ? fold(chunk.charCodeAt(i)) : chunk.charCodeAt(i);
      while (j && c !== p[j]) j = table[j - 1]!;
      if (c === p[j]) j++;
      if (j === p.length) {
        count++;
        if (matches.length < maxMatches) matches.push(pos - p.length + 1);
        j = 0;
      }
    }
  }
  return { count, matches, truncated: count > matches.length };
}

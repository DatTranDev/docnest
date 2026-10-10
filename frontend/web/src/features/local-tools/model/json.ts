export const SOURCE_LIMIT = 1024 * 1024;
export class JsonProblem extends Error {
  constructor(readonly offset: number) {
    super('INVALID_JSON');
  }
}
/** Validate grammar and format raw tokens, without converting numbers to IEEE-754. */
export function formatJson(source: string, indent: 0 | 2 | 4 = 2): string {
  if (source.length > SOURCE_LIMIT) throw new Error('SOURCE_LIMIT');
  const tokens: { raw: string; at: number }[] = [];
  const literal = /(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/y;
  let at = 0;
  while (at < source.length) {
    if (/[\t\r\n ]/.test(source[at]!)) {
      at++;
      continue;
    }
    const start = at;
    if ('{}[]:,'.includes(source[at]!)) at++;
    else if (source[at] === '"') {
      at++;
      let closed = false;
      while (at < source.length) {
        const character = source[at++];
        if (character === '\\') at++;
        else if (character === '"') {
          closed = true;
          break;
        }
      }
      if (!closed || at > source.length) throw new JsonProblem(start);
      try {
        JSON.parse(source.slice(start, at));
      } catch {
        throw new JsonProblem(start);
      }
    } else {
      literal.lastIndex = at;
      const value = literal.exec(source);
      if (!value) throw new JsonProblem(at);
      at += value[0].length;
    }
    tokens.push({ raw: source.slice(start, at), at: start });
    if (tokens.length > 200_000) throw new Error('SOURCE_LIMIT');
  }
  let index = 0;
  const problem = () => new JsonProblem(tokens[index]?.at ?? source.length);
  const expect = (raw: string) => {
    if (tokens[index]?.raw !== raw) throw problem();
    index++;
  };
  function value(depth: number): void {
    if (depth > 100) throw new Error('JSON_DEPTH');
    const token = tokens[index]?.raw;
    if (!token) throw problem();
    if (token === '{' || token === '[') {
      index++;
      const object = token === '{',
        close = object ? '}' : ']';
      if (tokens[index]?.raw === close) {
        index++;
        return;
      }
      while (true) {
        if (object) {
          if (!tokens[index]?.raw.startsWith('"')) throw problem();
          index++;
          expect(':');
        }
        value(depth + 1);
        if (tokens[index]?.raw !== ',') break;
        index++;
      }
      expect(close);
    } else {
      if (!/^(?:"|true$|false$|null$|-?\d)/.test(token)) throw problem();
      index++;
    }
  }
  value(0);
  if (index !== tokens.length) throw problem();
  if (!indent) return tokens.map((token) => token.raw).join('');
  let depth = 0;
  const output: string[] = [];
  let outputLength = 0;
  const append = (...pieces: string[]) => {
    for (const piece of pieces) {
      outputLength += piece.length;
      if (outputLength > SOURCE_LIMIT) throw new Error('SOURCE_LIMIT');
      output.push(piece);
    }
  };
  const newline = () => '\n' + ' '.repeat(depth * indent);
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i]!.raw;
    if (raw === '{' || raw === '[') {
      append(raw);
      depth++;
      if (!['}', ']'].includes(tokens[i + 1]?.raw ?? '')) append(newline());
    } else if (raw === '}' || raw === ']') {
      depth--;
      if (!['{', '['].includes(tokens[i - 1]?.raw ?? '')) append(newline());
      append(raw);
    } else if (raw === ',') append(raw, newline());
    else if (raw === ':') append(': ');
    else append(raw);
  }
  return output.join('');
}
export function jsonLocation(source: string, offset: number) {
  const before = source.slice(0, offset);
  return {
    line: (before.match(/\n/g)?.length ?? 0) + 1,
    column: offset - before.lastIndexOf('\n'),
  };
}

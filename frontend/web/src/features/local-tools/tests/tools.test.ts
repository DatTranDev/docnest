import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { EditorModel, TextAdapter, StyleTree, RichFormatting } from '@ted/editor-core';
import { formatJson, JsonProblem, jsonLocation } from '../model/json';
import { codeTokens } from '../model/syntax';
import { htmlFile, richHtml } from '../model/documentExport';
import { exportLocalDocx } from '../model/exportDocx';
describe('lossless JSON formatting', () => {
  it('retains raw large integers, exponent notation, escaped strings and duplicate keys', () => {
    const source =
      '{"id":900719925474099312345,"n":1.234567890123456789e+42,"label":"Việt 👋\\n","id":-0}';
    expect(formatJson(formatJson(source, 4), 0)).toBe(source);
    expect(formatJson('[{},[],true,null,false,"x"]', 2)).toBe(
      '[\n  {},\n  [],\n  true,\n  null,\n  false,\n  "x"\n]',
    );
  });
  it('has the same values as native JSON for generated safe numeric inputs', () => {
    for (let i = 0; i < 100; i++) {
      const value = {
        items: [i, -i / 10, { label: `Việt ${i} " \\`, enabled: i % 2 === 0 }],
        empty: [],
        missing: null,
      };
      expect(JSON.parse(formatJson(JSON.stringify(value), i % 2 ? 2 : 4))).toEqual(
        JSON.parse(JSON.stringify(value)),
      );
    }
  });
  it.each([
    '',
    '01',
    '[1,]',
    '{"x":}',
    '{x:1}',
    '{}true',
    'NaN',
    '/*x*/{}',
    '{"x":1,}',
    '"bad\nstring"',
    '1e',
    '[true false]',
  ])('rejects invalid grammar without changing input: %s', (source) => {
    expect(() => formatJson(source)).toThrow(JsonProblem);
  });
  it('bounds depth and input and reports line/column', () => {
    const expanded = '['.repeat(90) + Array(4000).fill('0').join(',') + ']'.repeat(90);
    expect(() => formatJson(expanded, 4)).toThrow('SOURCE_LIMIT');
    expect(() => formatJson('['.repeat(102) + '0' + ']'.repeat(102))).toThrow('JSON_DEPTH');
    expect(() => formatJson(' '.repeat(1024 * 1024 + 1))).toThrow('SOURCE_LIMIT');
    expect(jsonLocation('{\n  "a": }', 9)).toEqual({ line: 2, column: 8 });
  });
});
describe('local rendering and Word export', () => {
  it('highlights supported code and preserves its exact Unicode text', () => {
    const source = 'const draft = "Việt 👋";\n// <script>\n';
    const tokens = codeTokens(source, 'typescript');
    expect(tokens.map((token) => token.text).join('')).toBe(source);
    expect(tokens.some((token) => token.className?.includes('tok-keyword'))).toBe(true);
    expect(codeTokens(source, 'unknown')).toEqual([{ text: source }]);
  });
  it('escapes document/title content, retains formatting and emits a real Word ZIP', async () => {
    const text = TextAdapter.from('Tiếng Việt <script>alert(1)</script>');
    const model = new EditorModel(text, StyleTree.uniform(text.length, 1));
    model.formatting = RichFormatting.parse(
      { runs: [{ from: 0, to: text.length, color: '#1A73E8', strike: true }], paragraphs: [] },
      text,
      true,
      true,
    );
    const html = htmlFile(richHtml(model.snapshot()), '<unsafe>', 'vi');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<title>&lt;unsafe&gt;</title>');
    const output = unzipSync(await exportLocalDocx(model.snapshot(), 'Bản thảo'));
    const xml = strFromU8(output['word/document.xml']!);
    expect(xml).toContain('Tiếng Việt &lt;script&gt;');
    expect(xml).toContain('<w:b');
    expect(xml).toContain('1A73E8');
    expect(xml).toContain('<w:strike');
  });
});

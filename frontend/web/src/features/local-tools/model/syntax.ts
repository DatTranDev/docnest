import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { python } from '@codemirror/lang-python';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import type { LanguageSupport } from '@codemirror/language';
export const codeLanguages = [
  'javascript',
  'typescript',
  'json',
  'html',
  'css',
  'python',
  'text',
] as const;
export type CodeLanguage = (typeof codeLanguages)[number];
export function languageSupport(name: string): LanguageSupport | null {
  switch (name.toLowerCase()) {
    case 'js':
    case 'javascript':
      return javascript();
    case 'ts':
    case 'typescript':
      return javascript({ typescript: true });
    case 'jsx':
      return javascript({ jsx: true });
    case 'tsx':
      return javascript({ jsx: true, typescript: true });
    case 'json':
      return json();
    case 'html':
      return html();
    case 'css':
      return css();
    case 'py':
    case 'python':
      return python();
    case 'md':
    case 'markdown':
      return markdown({ codeLanguages: (info) => languageSupport(info)?.language ?? null });
    default:
      return null;
  }
}
export function codeTokens(source: string, language: string) {
  const support = languageSupport(language);
  const spans: { from: number; to: number; className: string }[] = [];
  if (support && source.length <= 100_000)
    highlightTree(
      support.language.parser.parse(source),
      classHighlighter,
      (from, to, className) => {
        spans.push({ from, to, className });
      },
    );
  const result: { text: string; className?: string }[] = [];
  let at = 0;
  for (const span of spans) {
    if (span.from > at) result.push({ text: source.slice(at, span.from) });
    result.push({ text: source.slice(span.from, span.to), className: span.className });
    at = span.to;
  }
  if (at < source.length) result.push({ text: source.slice(at) });
  return result;
}

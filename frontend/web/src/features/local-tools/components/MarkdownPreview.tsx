'use client';
import { createElement, useMemo, type HTMLAttributes, type ReactNode } from 'react';
import Markdown, { defaultUrlTransform, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { codeTokens } from '../model/syntax';
/** Remote media stays inert; previewing a local file never fetches its image URLs. */
const blockTags = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'blockquote',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'hr',
] as const;
function sourcePosition(node: ExtraProps['node']) {
  return node?.position ? { 'data-source-line': node.position.start.line } : {};
}
export function MarkdownPreview({
  source,
  sourceMap = false,
}: {
  source: string;
  sourceMap?: boolean;
}) {
  const blocks = useMemo(
    () =>
      sourceMap
        ? Object.fromEntries(
            blockTags.map((tag) => [
              tag,
              ({ node, ...props }: HTMLAttributes<HTMLElement> & ExtraProps) =>
                createElement(tag, { ...props, ...sourcePosition(node) }),
            ]),
          )
        : {},
    [sourceMap],
  );
  return (
    <div className="markdown-body">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url, key) => (key === 'src' ? '' : defaultUrlTransform(url))}
        components={{
          ...blocks,
          img: ({ alt }) => <span className="markdown-image-note">[Image: {alt || 'image'}]</span>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          pre: ({ children, node }) => (
            <div className="markdown-code" {...(sourceMap ? sourcePosition(node) : {})}>
              <pre>{children}</pre>
            </div>
          ),
          code: ({ className, children }) => (
            <HighlightedCode language={/language-([\w-]+)/.exec(className ?? '')?.[1]}>
              {children}
            </HighlightedCode>
          ),
        }}
      >
        {source}
      </Markdown>
    </div>
  );
}
function HighlightedCode({ language, children }: { language?: string; children?: ReactNode }) {
  const source = String(children ?? '');
  const parts = useMemo(() => (language ? codeTokens(source, language) : []), [source, language]);
  return (
    <code className={language ? `language-${language}` : undefined}>
      {parts.length
        ? parts.map((part, index) =>
            part.className ? (
              <span key={index} className={part.className}>
                {part.text}
              </span>
            ) : (
              part.text
            ),
          )
        : children}
    </code>
  );
}

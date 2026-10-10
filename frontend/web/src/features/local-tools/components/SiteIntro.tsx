'use client';
import Link from 'next/link';
import { useToolsCopy, markdownSample } from '../model/copy';
import { SiteHeader } from './SiteHeader';
import { MarkdownPreview } from './MarkdownPreview';
export function SiteIntro({ standalone = false }: { standalone?: boolean }) {
  const copy = useToolsCopy(),
    edit = standalone ? './editor.html' : '/local';
  return (
    <div className="local-site">
      <SiteHeader standalone={standalone} />
      <main className="intro-main">
        <section className="intro-hero">
          <div className="intro-words">
            <h1>{copy.headline}</h1>
            <p>{copy.description}</p>
            <a className="site-primary" href={`${edit}?mode=markdown`}>
              {copy.openEditor}
            </a>
            <small>{copy.noAccount}</small>
          </div>
          <div className="intro-demo">
            <div className="intro-demo-bar">
              <span>Ban-thao.md</span>
              <span>docsnest</span>
            </div>
            <div className="intro-demo-content">
              <pre className="intro-demo-source">{copy.demoMarkdown}</pre>
              <MarkdownPreview source={copy.demoMarkdown} />
            </div>
          </div>
        </section>
        <section className="intro-features">
          <h2>{copy.featureHeading}</h2>
          <div className="intro-feature-list">
            {[
              {
                mode: 'document',
                title: copy.richTitle,
                description: copy.richDescription,
                mark: 'Aa',
              },
              { mode: 'markdown', title: 'Markdown', description: copy.mdDescription, mark: 'M↓' },
              { mode: 'code', title: 'Code', description: copy.codeDescription, mark: '</>' },
              { mode: 'json', title: 'JSON', description: copy.jsonDescription, mark: '{ }' },
            ].map((feature) => (
              <a key={feature.mode} href={`${edit}?mode=${feature.mode}`}>
                <span className="intro-feature-mark" aria-hidden="true">
                  {feature.mark}
                </span>
                <div>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </div>
              </a>
            ))}
          </div>
        </section>
        <section className="intro-local">
          <div>
            <h2>{copy.localHeading}</h2>
            <p>{copy.localDescription}</p>
            <a className="site-primary" href={edit}>
              {copy.local}
            </a>
          </div>
          <div className="intro-file-stack" aria-hidden="true">
            <span>Ban-thao.md</span>
            <span>snippet.ts</span>
            <span>data.json</span>
            <span>docsnest.tedoc</span>
          </div>
        </section>
        {!standalone && (
          <section className="intro-workspace">
            <h2>{copy.workspaceHeading}</h2>
            <p>{copy.workspaceDescription}</p>
            <Link href="/">{copy.workspace}</Link>
          </section>
        )}
        <details className="intro-markdown-example">
          <summary>Markdown</summary>
          <MarkdownPreview source={markdownSample} />
        </details>
      </main>
      <footer className="intro-footer">
        <span>docsnest</span>
        <a href={edit}>{copy.openEditor}</a>
      </footer>
    </div>
  );
}

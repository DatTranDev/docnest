'use client';
import Link from 'next/link';
import { useToolsCopy, markdownSample } from '../model/copy';
import { SiteHeader } from './SiteHeader';
import { MarkdownPreview } from './MarkdownPreview';
import { Icon } from '@/components/ui/Icon';
import { LocalClient } from './LocalClient';
export function SiteIntro({ standalone = false }: { standalone?: boolean }) {
  const copy = useToolsCopy();
  const edit = (mode?: string) =>
    standalone
      ? `./editor.html${mode ? `?mode=${mode}` : ''}`
      : `/intro${mode ? `?mode=${mode}` : ''}#editor`;
  return (
    <div className="local-site">
      <SiteHeader standalone={standalone} />
      <main className="intro-main">
        <section className="intro-hero">
          <div className="intro-words">
            <h1>{copy.headline}</h1>
            <p>{copy.description}</p>
            <div className="intro-actions">
              <a className="site-primary" href={edit('document')}>
                {copy.startWriting} →
              </a>
              {!standalone && (
                <Link className="intro-account-action" href="/">
                  {copy.signInToFiles}
                </Link>
              )}
            </div>
            <small>{copy.noAccount}</small>
          </div>
          <div className="intro-demo">
            <div className="intro-demo-bar">
              <span className="intro-demo-title">
                <Icon name="document" size={18} /> {copy.demoTitle}
              </span>
              <span className="intro-demo-actions">
                <span>Save</span>
                <span>Share</span>
              </span>
            </div>
            <div className="intro-demo-toolbar">
              <span>Normal text ▾</span>
              <b>B</b>
              <i>I</i>
              <u>U</u>
              <span>☷</span>
              <span>↗</span>
              <span>•••</span>
            </div>
            <div className="intro-demo-content">
              <div className="intro-demo-paper">
                <h2>{copy.demoTitle}</h2>
                <p>{copy.demoBody}</p>
                <ul>
                  <li>{copy.demoPoint}</li>
                </ul>
              </div>
            </div>
          </div>
        </section>
        <section className="intro-features" aria-label={copy.featureHeading}>
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
              <a key={feature.mode} href={edit(feature.mode)}>
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
            <a className="site-primary" href={edit()}>
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
          <section id="editor" className="intro-live-editor" aria-label={copy.local}>
            <LocalClient embedded />
          </section>
        )}
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
        <a href={edit()}>{copy.openEditor}</a>
      </footer>
    </div>
  );
}

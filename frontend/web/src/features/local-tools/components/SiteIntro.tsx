'use client';
import Link from 'next/link';
import { useToolsCopy } from '../model/copy';
import { SiteHeader } from './SiteHeader';
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
            <span className="public-eyebrow">{copy.introEyebrow}</span>
            <h1>{copy.headline}</h1>
            <p>{copy.description}</p>
            <div className="intro-actions">
              <a className="site-primary" href={edit('document')}>
                {copy.startWriting} <Icon name="chevron" size={18} />
              </a>
              {!standalone && (
                <Link className="intro-account-action" href="/">
                  {copy.signInToFiles}
                </Link>
              )}
            </div>
            <small>{copy.noAccount}</small>
          </div>
          <figure className="intro-demo">
            <div className="intro-demo-bar">
              <span className="intro-demo-title">
                <Icon name="document" size={18} /> {copy.demoTitle}
              </span>
              <span className="intro-demo-format" aria-hidden="true">
                .tedoc
              </span>
            </div>
            <div className="intro-demo-toolbar" aria-hidden="true">
              <span>
                {copy.document} <Icon name="chevron-down" size={14} />
              </span>
              <b>B</b>
              <i>I</i>
              <u>U</u>
              <span className="intro-demo-separator" />
              <Icon name="align-left" size={17} />
              <Icon name="list" size={17} />
              <Icon name="undo" size={17} />
            </div>
            <div className="intro-demo-content">
              <div className="intro-demo-paper">
                <h2>{copy.demoTitle}</h2>
                <p>{copy.demoBody}</p>
                <h3>{copy.demoSection}</h3>
                <ul>
                  <li>{copy.demoPoint}</li>
                </ul>
              </div>
            </div>
            <figcaption>
              <span className="intro-preview-dot" aria-hidden="true" />
              {copy.demoLabel}
              <span>docsnest</span>
            </figcaption>
          </figure>
        </section>
        <section className="intro-features" aria-label={copy.featureHeading}>
          <div className="intro-section-heading">
            <span className="public-eyebrow">{copy.toolsEyebrow}</span>
            <h2>{copy.featureHeading}</h2>
          </div>
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
                  <h3>
                    {feature.title}
                    <Icon name="chevron" size={16} />
                  </h3>
                  <p>{feature.description}</p>
                </div>
              </a>
            ))}
          </div>
        </section>
        <section className="intro-local">
          <div>
            <span className="public-eyebrow">{copy.localEyebrow}</span>
            <h2>{copy.localHeading}</h2>
            <p>{copy.localDescription}</p>
            <a className="site-primary" href={edit()}>
              {copy.local}
            </a>
          </div>
          <div className="intro-file-stack" aria-hidden="true">
            <span>notes.md</span>
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
      </main>
      <footer className="intro-footer">
        <span>docsnest</span>
        <a href={edit()}>{copy.openEditor}</a>
      </footer>
    </div>
  );
}

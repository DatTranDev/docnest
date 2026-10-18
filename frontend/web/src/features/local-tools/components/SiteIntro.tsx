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
      <main id="intro-main" className="intro-main" tabIndex={-1}>
        <section className="intro-hero">
          <div className="intro-words">
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
            <h2>{copy.featureHeading}</h2>
          </div>
          <div className="intro-feature-list">
            {[
              {
                mode: 'document',
                title: copy.richTitle,
                description: copy.richDescription,
              },
              { mode: 'markdown', title: 'Markdown', description: copy.mdDescription },
              { mode: 'code', title: 'Code', description: copy.codeDescription },
              { mode: 'json', title: 'JSON', description: copy.jsonDescription },
            ].map((feature) => (
              <a key={feature.mode} href={edit(feature.mode)}>
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
            <h2>{copy.localHeading}</h2>
            <p>{copy.localDescription}</p>
            <a className="site-primary" href={edit()}>
              {copy.local}
            </a>
          </div>
          <ul className="intro-file-formats">
            <li>notes.md</li>
            <li>snippet.ts</li>
            <li>data.json</li>
            <li>docsnest.tedoc</li>
          </ul>
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

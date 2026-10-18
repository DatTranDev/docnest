'use client';
import { useI18n } from '@/lib/i18n';
import { policies } from '@/lib/i18n/policies';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';

export function SitePolicy({
  kind,
  standalone = false,
}: {
  kind: 'privacy' | 'terms';
  standalone?: boolean;
}) {
  const { locale } = useI18n();
  const copy = policies[locale];
  const policy = copy[kind];
  return (
    <div className="local-site">
      <SiteHeader standalone={standalone} informationPage />
      <main id="intro-main" className="intro-main policy-main" tabIndex={-1}>
        <article>
          <header>
            <h1>{policy.title}</h1>
            <p className="policy-introduction">{policy.introduction}</p>
            <p className="policy-updated">{copy.updated}</p>
          </header>
          {policy.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              <p>{section.body}</p>
            </section>
          ))}
        </article>
      </main>
      <SiteFooter standalone={standalone} current={kind} />
    </div>
  );
}

'use client';
import { DocnivoBrand } from '@/components/brand/DocnivoBrand';
import { useToolsCopy } from '../model/copy';

export function SiteFooter({
  standalone = false,
  introduction = false,
  current,
}: {
  standalone?: boolean;
  introduction?: boolean;
  current?: 'privacy' | 'terms';
}) {
  const copy = useToolsCopy();
  const intro = standalone ? './index.html' : '/intro';
  return (
    <footer className="intro-footer">
      <div className="intro-footer-main">
        <a className="intro-footer-brand" href={intro}>
          <DocnivoBrand />
        </a>
        <nav aria-label={copy.footerNavigation}>
          <a href={introduction ? '#features' : `${intro}#features`}>{copy.features}</a>
          <a href={standalone ? './editor.html' : '/intro#editor'}>{copy.openEditor}</a>
          <a
            href={standalone ? './privacy.html' : '/privacy'}
            aria-current={current === 'privacy' ? 'page' : undefined}
          >
            {copy.privacy}
          </a>
          <a
            href={standalone ? './terms.html' : '/terms'}
            aria-current={current === 'terms' ? 'page' : undefined}
          >
            {copy.terms}
          </a>
        </nav>
      </div>
      <div className="intro-footer-copyright">© {new Date().getFullYear()} Docnivo</div>
    </footer>
  );
}

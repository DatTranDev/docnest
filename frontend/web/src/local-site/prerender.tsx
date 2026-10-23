import { renderToString } from 'react-dom/server';
import type { PublicPage } from '@/config/seo';
import { PublicPageContent } from './PublicPage';

export function renderPublicPage(page: Exclude<PublicPage, 'local'>): string {
  return renderToString(<PublicPageContent page={page} />);
}

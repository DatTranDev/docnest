import { createServer, type Plugin } from 'vite';
import path from 'node:path';
import { siteBaseUrl, type PublicPage } from '../src/config/seo';
import { seoCopy } from '../src/lib/i18n/seo';

const pages: Record<string, PublicPage> = {
  'index.html': 'intro',
  'editor.html': 'local',
  'privacy.html': 'privacy',
  'terms.html': 'terms',
};
const escape = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

/** Render the public React surfaces at build time, with relative bundled media URLs. */
export function localSiteSeo(): Plugin {
  const base = siteBaseUrl(process.env.LOCAL_SITE_URL);
  const webRoot = path.resolve(import.meta.dirname, '..');
  return {
    name: 'local-site-seo',
    enforce: 'post',
    transformIndexHtml(html, context) {
      const page = pages[path.basename(context.filename)];
      if (!page) return html;
      const { title, description } = seoCopy('vi', page);
      const url = base ? new URL(path.basename(context.filename), base).href : undefined;
      return {
        html: html
          .replace(/<title>.*?<\/title>/s, `<title>${escape(title)}</title>`)
          .replace(/<meta\s+name="description"[^>]*\/>/s, ''),
        tags: [
          { tag: 'meta', attrs: { name: 'description', content: description } },
          { tag: 'meta', attrs: { name: 'robots', content: 'index, follow' } },
          { tag: 'meta', attrs: { property: 'og:type', content: 'website' } },
          { tag: 'meta', attrs: { property: 'og:site_name', content: 'Docnivo' } },
          { tag: 'meta', attrs: { property: 'og:locale', content: 'vi_VN' } },
          { tag: 'meta', attrs: { property: 'og:title', content: title } },
          { tag: 'meta', attrs: { property: 'og:description', content: description } },
          { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary' } },
          { tag: 'meta', attrs: { name: 'twitter:title', content: title } },
          { tag: 'meta', attrs: { name: 'twitter:description', content: description } },
          ...(url
            ? [
                { tag: 'link', attrs: { rel: 'canonical', href: url } },
                { tag: 'meta', attrs: { property: 'og:url', content: url } },
              ]
            : []),
        ],
      };
    },
    generateBundle: {
      order: 'post',
      async handler(_options, bundle) {
        const server = await createServer({
          configFile: false,
          root: webRoot,
          server: { middlewareMode: true },
          appType: 'custom',
          resolve: { alias: { '@': path.join(webRoot, 'src') } },
          define: {
            'process.env.NEXT_PUBLIC_APP_URL': JSON.stringify(
              process.env.NEXT_PUBLIC_APP_URL || '',
            ),
          },
        });
        try {
          const { renderPublicPage } = await server.ssrLoadModule('/src/local-site/prerender.tsx');
          for (const [filename, page] of Object.entries(pages)) {
            const html = bundle[filename];
            if (page === 'local' || !html || html.type !== 'asset') continue;
            const markup = (renderPublicPage(page) as string).replace(
              /(poster|src|href)="[^"]*(product-demo-poster\.png|product-demo\.webm)"/g,
              (_match, attribute: string, original: string) => {
                const media = Object.values(bundle).find(
                  (asset) =>
                    asset.type === 'asset' &&
                    asset.originalFileNames.some((name) => name.endsWith(original)),
                );
                if (!media) throw new Error(`Missing prerender media: ${original}`);
                return `${attribute}="./${media.fileName}"`;
              },
            );
            html.source = String(html.source).replace(
              '<div id="root"></div>',
              `<div id="root">${markup}</div>`,
            );
          }
        } finally {
          await server.close();
        }
        this.emitFile({
          type: 'asset',
          fileName: 'robots.txt',
          source: `User-agent: *\nAllow: /\n${base ? `Sitemap: ${new URL('sitemap.xml', base).href}\n` : ''}`,
        });
        if (base) {
          this.emitFile({
            type: 'asset',
            fileName: 'sitemap.xml',
            source:
              '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
              Object.keys(pages)
                .map((filename) => `<url><loc>${escape(new URL(filename, base).href)}</loc></url>`)
                .join('') +
              '</urlset>\n',
          });
        }
      },
    },
  };
}

import { defineConfig } from 'vite';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { localNotices } from './local-site/notices';
export default defineConfig({
  plugins: [
    {
      name: 'local-site-notices',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'THIRD_PARTY_NOTICES.txt',
          source: localNotices(),
        });
        this.emitFile({
          type: 'asset',
          fileName: 'fonts/OFL.txt',
          source: readFileSync(
            path.resolve(import.meta.dirname, 'src/features/local-tools/assets/OFL.txt'),
            'utf8',
          ),
        });
        this.emitFile({
          type: 'asset',
          fileName: 'README.txt',
          source:
            'docsnest local site\n\nServe this directory with a static HTTP host (for example, Live Server or python -m http.server 8081).\nOpen index.html for the introduction, editor.html for the editor.\nNo backend services or login are required. Files stay in the current session; download to keep your work.\nPDF uses the browser Print / Save PDF dialog.\n',
        });
      },
    },
  ],
  root: path.resolve(import.meta.dirname, 'local-site'),
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@ted/editor-core': path.resolve(import.meta.dirname, '../editor-core/src/index.ts'),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env.NEXT_PUBLIC_APP_URL': JSON.stringify(process.env.NEXT_PUBLIC_APP_URL || ''),
  },
  build: {
    outDir: '../dist/local-site',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(import.meta.dirname, 'local-site/index.html'),
        editor: path.resolve(import.meta.dirname, 'local-site/editor.html'),
      },
    },
  },
});

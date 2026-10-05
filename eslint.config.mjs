import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import ts from 'typescript-eslint';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/target/**',
      '**/.next/**',
      '**/next-env.d.ts',
      '**/test-results/**',
    ],
  },
  ...nextVitals.map((config) => ({ ...config, files: ['apps/web/src/**/*.{ts,tsx}'] })),
  ...nextTypescript.map((config) => ({ ...config, files: ['apps/web/src/**/*.{ts,tsx}'] })),
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/editor-core/**/*.ts'],
    languageOptions: { parser: ts.parser, ecmaVersion: 2024, sourceType: 'module' },
    settings: { next: { rootDir: 'apps/web' } },
    rules: {
      'no-unreachable': 'error',
      'no-constant-condition': 'error',
      'no-debugger': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
];

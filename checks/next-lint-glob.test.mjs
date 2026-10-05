import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { getRootDirs } = require('@next/eslint-plugin-next/dist/utils/get-root-dirs.js');
test('Next lint root resolver discovers exact and workspace directory patterns', () => {
  const context = (rootDir) => ({ cwd: process.cwd(), settings: { next: { rootDir } } });
  assert.deepEqual(getRootDirs(context('apps/web')), ['apps/web']);
  assert.deepEqual(getRootDirs(context(['apps/*', 'packages/*'])).sort(), [
    'apps/web',
    'packages/editor-core',
  ]);
  assert.deepEqual(getRootDirs(context('no-such-root-*')), []);
  assert.deepEqual(getRootDirs({ cwd: process.cwd(), settings: {} }), [process.cwd()]);
});
test('deep patterns cannot exhaust the Next lint resolver stack', () => {
  const code = `const {getRootDirs}=require('@next/eslint-plugin-next/dist/utils/get-root-dirs.js');
    try { getRootDirs({cwd:process.cwd(),settings:{next:{rootDir:'{'.repeat(50000)+'x'+'}'.repeat(50000)}}}); }
    catch(e) { if (/call stack/i.test(String(e))) throw e; }`;
  execFileSync(process.execPath, ['-e', code], { timeout: 5000, stdio: 'pipe' });
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repository = path.resolve(import.meta.dirname, '../..');

function check(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'editor-boundaries-'));
  try {
    for (const directory of ['testing/checks', 'frontend/web/src', 'frontend/editor-core/src'])
      mkdirSync(path.join(root, directory), { recursive: true });
    symlinkSync(path.join(repository, 'node_modules'), path.join(root, 'node_modules'), 'junction');
    const script = path.join(root, 'testing/checks/frontend-boundaries.mjs');
    copyFileSync(path.join(import.meta.dirname, 'frontend-boundaries.mjs'), script);
    for (const [name, source] of Object.entries(files)) {
      const file = path.join(root, name);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, source);
    }
    return spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const feature = 'frontend/web/src/features/';
const target = { [feature + 'documents/index.ts']: 'export const value = 1;' };

test('relocated frontend accepts imports through feature public entry points', () => {
  const result = check({
    ...target,
    [feature + 'sharing/index.ts']: "import { value } from '../documents/index';",
  });
  assert.equal(result.status, 0, result.stderr);
});

test('relocated frontend rejects private cross-feature imports', () => {
  const result = check({
    [feature + 'documents/private.ts']: 'export const value = 1;',
    [feature + 'sharing/index.ts']: "import { value } from '../documents/private';",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /private cross-feature import/);
});

test('relocated technical modules cannot import features', () => {
  const result = check({
    ...target,
    'frontend/web/src/lib/http.ts': "import { value } from '../features/documents/index';",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /technical\/shared module imports feature/);
});

test('relocated editor-core cannot import the application or React', () => {
  const result = check({
    ...target,
    'frontend/editor-core/src/index.ts':
      "import { value } from '../../web/src/features/documents/index'; import React from 'react';",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /editor-core imports application/);
  assert.match(result.stderr, /framework dependency react/);
});

test('relocated frontend still rejects import cycles', () => {
  const result = check({
    [feature + 'documents/index.ts']: "import '../sharing/index';",
    [feature + 'sharing/index.ts']: "import '../documents/index';",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Import cycle/);
});

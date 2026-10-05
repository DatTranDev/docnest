import { spawnSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const files = [];
const functions = [];
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (
        !['target', 'node_modules', '.next', 'tests', 'test', 'dist', 'benchmark'].includes(
          entry.name,
        )
      )
        await scan(file);
    } else if (/\.(java|ts|tsx|mjs|cjs)$/.test(file) && !/\.test\.[^.]+$/.test(file)) {
      const source = await readFile(file, 'utf8');
      const relative = path.relative(root, file).replaceAll('\\', '/');
      const lines = source.split('\n').length;
      if (lines > 500) files.push({ file: relative, lines });
      if (file.endsWith('.java')) continue;
      const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      function visit(node) {
        if (ts.isFunctionLike(node) && node.body) {
          const start = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line;
          const end = tree.getLineAndCharacterOfPosition(node.end).line;
          if (end - start + 1 > 100)
            functions.push({
              file: relative,
              name: node.name?.getText(tree) ?? '(anonymous)',
              line: start + 1,
              lines: end - start + 1,
            });
        }
        ts.forEachChild(node, visit);
      }
      visit(tree);
    }
  }
}
await scan(path.join(root, 'services'));
await scan(path.join(root, 'apps/web/src'));
await scan(path.join(root, 'apps/web/server'));
await scan(path.join(root, 'packages/editor-core/src'));
await scan(path.join(root, 'tools/lint-glob'));
const java = spawnSync('java', ['--source', '21', 'checks/java/SourceSizes.java', root], {
  cwd: root,
  encoding: 'utf8',
});
if (java.status !== 0) throw new Error(`Java AST size scan failed: ${java.stderr}`);
for (const row of java.stdout.trim().split('\n').filter(Boolean)) {
  const [file, name, lines] = row.trim().split('\t');
  functions.push({ file, name, lines: Number(lines) });
}
await writeFile(
  path.join(root, 'reports/source-size-signals.json'),
  JSON.stringify(
    {
      status: 'REVIEW_SIGNALS',
      thresholds: { fileLines: 500, functionLines: 100 },
      files,
      functions,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Review signals: ${files.length} files >500 lines, ${functions.length} functions >100 lines. See reports/source-size-signals.json.`,
);

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const sourceRoots = ['apps/web/src', 'packages/editor-core/src'].map((p) => path.join(root, p));
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    return entry.isDirectory() ? files(p) : /\.[cm]?[jt]sx?$/.test(p) ? [p] : [];
  });
}
const sources = sourceRoots.flatMap(files);
const graph = new Map(sources.map((p) => [p, []]));
const errors = [];
function relative(p) {
  return path.relative(root, p).replaceAll('\\', '/');
}
function resolve(from, specifier) {
  let base;
  if (specifier.startsWith('@/')) base = path.join(root, 'apps/web/src', specifier.slice(2));
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(from), specifier);
  else if (specifier === '@ted/editor-core')
    base = path.join(root, 'packages/editor-core/src/index');
  else return null;
  for (const candidate of [
    base,
    ...['.ts', '.tsx', '.js', '.mjs'].map((s) => base + s),
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}
for (const file of sources) {
  const content = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const imports = [];
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(node.arguments[0])
    )
      imports.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(content);
  const from = relative(file),
    fromFeature = from.match(/apps\/web\/src\/features\/([^/]+)/)?.[1];
  for (const specifier of imports) {
    const target = resolve(file, specifier);
    if (from.startsWith('packages/editor-core/') && /^(react|next|@ted\/web)/.test(specifier))
      errors.push(`${from}: framework dependency ${specifier}`);
    if (!target) continue;
    graph.get(file).push(target);
    const to = relative(target),
      toFeature = to.match(/apps\/web\/src\/features\/([^/]+)/)?.[1];
    if (from.startsWith('packages/editor-core/') && to.startsWith('apps/'))
      errors.push(`${from}: editor-core imports application ${to}`);
    if (/apps\/web\/src\/(lib|config|components\/ui)\//.test(from) && toFeature)
      errors.push(`${from}: technical/shared module imports feature ${to}`);
    if (
      fromFeature &&
      toFeature &&
      fromFeature !== toFeature &&
      !/^apps\/web\/src\/features\/[^/]+\/index\.tsx?$/.test(to)
    )
      errors.push(`${from}: private cross-feature import ${to}`);
  }
}
const complete = new Set(),
  visiting = new Set(),
  stack = [];
function visit(file) {
  if (complete.has(file) || !graph.has(file)) return;
  if (visiting.has(file)) {
    errors.push(
      'Import cycle: ' + [...stack.slice(stack.indexOf(file)), file].map(relative).join(' -> '),
    );
    return;
  }
  visiting.add(file);
  stack.push(file);
  for (const target of graph.get(file)) visit(target);
  stack.pop();
  visiting.delete(file);
  complete.add(file);
}
for (const source of sources) visit(source);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else
  console.log(`PASS frontend boundaries and import cycles (${sources.length} handwritten modules)`);

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
/** Keep upstream licenses with the independently distributable browser bundle. */
export function localNotices(): string {
  const root = path.resolve(import.meta.dirname, '../../..');
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { dev?: boolean; version?: string; license?: string }>;
  };
  const notices = [
    'docsnest local site — third-party notices',
    'This inventory conservatively includes installed production dependencies.',
  ];
  for (const [key, info] of Object.entries(lock.packages)) {
    if (info.dev || !key.includes('node_modules/')) continue;
    const directory = path.join(root, key);
    if (!existsSync(directory)) continue;
    const names = readdirSync(directory).filter((name) =>
      /^(licen[sc]e|copying)(?:\.[\w-]+)?$/i.test(name),
    );
    const metadata = path.join(directory, 'package.json');
    const pkg = existsSync(metadata)
      ? (JSON.parse(readFileSync(metadata, 'utf8')) as { name?: string; license?: string })
      : {};
    notices.push(
      `\n${pkg.name ?? key} ${info.version ?? ''}\nLicense: ${pkg.license ?? info.license ?? 'See upstream package'}`,
    );
    for (const name of names) notices.push(readFileSync(path.join(directory, name), 'utf8'));
  }
  return notices.join('\n') + '\n';
}

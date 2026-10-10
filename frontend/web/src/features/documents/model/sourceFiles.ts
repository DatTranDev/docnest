export const sourceExtensions = [
  'md',
  'markdown',
  'json',
  'js',
  'ts',
  'jsx',
  'tsx',
  'py',
  'html',
  'css',
] as const;
export function sourceFileType(title: string): 'markdown' | 'json' | 'code' | null {
  const extension = title.split('.').at(-1)?.toLowerCase() ?? '';
  if (extension === 'md' || extension === 'markdown') return 'markdown';
  if (extension === 'json') return 'json';
  return sourceExtensions.some((value) => value === extension) ? 'code' : null;
}

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { DEFAULT_LOCALE, normalizeLocale, SUPPORTED_LOCALES } from '@/config/locale';
import { catalogs, MESSAGE, type MessageKey } from '../messages';
import {
  countLabel,
  isMessageKey,
  localize,
  message,
  translate,
  translateError,
} from '../translate';
describe('English and Vietnamese catalogs', () => {
  it('keeps Vietnamese UI copy outside catalogs out of application source', () => {
    const violations: string[] = [];
    const scan = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (['i18n', 'tests'].includes(entry.name)) continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          scan(file);
          continue;
        }
        if (!/\.tsx?$/.test(file) || file.includes('Harness')) continue;
        const source = ts.createSourceFile(
          file,
          readFileSync(file, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
          file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );
        const visit = (node: ts.Node) => {
          if (
            (ts.isStringLiteral(node) ||
              ts.isNoSubstitutionTemplateLiteral(node) ||
              ts.isJsxText(node)) &&
            /[À-ÖØ-öø-ỹ]/.test(node.text)
          )
            violations.push(path.relative(directory, file));
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
    };
    scan(path.resolve(import.meta.dirname, '../../..'));
    expect(violations).toEqual([]);
  });
  it('has exactly the same nonempty messages and interpolation slots in both languages', () => {
    expect(Object.keys(catalogs.en).sort()).toEqual(Object.keys(catalogs.vi).sort());
    for (const key of Object.keys(catalogs.vi) as MessageKey[]) {
      for (const locale of SUPPORTED_LOCALES) expect(catalogs[locale][key].trim()).not.toBe('');
      const slots = (value: string) =>
        [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      expect(slots(catalogs.en[key]), key).toEqual(slots(catalogs.vi[key]));
    }
  });
  it('only accepts configured locales and falls back deterministically', () => {
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('vi')).toBe('vi');
    for (const value of [undefined, null, 'EN', 'fr', 'en; Path=/', {}, 'toString'])
      expect(normalizeLocale(value)).toBe(DEFAULT_LOCALE);
  });
  it('interpolates once without normalizing text or interpreting replacement metacharacters', () => {
    const name = 'A😀e\u0301 <b>$&{p0}</b>';
    expect(translate('en', MESSAGE.previewOfValue, { p0: name })).toBe(`Preview of ${name}`);
    expect(translate('vi', MESSAGE.previewOfValue, { p0: name })).toBe(`Bản xem trước ${name}`);
    expect(translate('en', MESSAGE.previewOfValue)).toBe('Preview of {p0}');
  });
  it('changes pending notices without changing status IDs or document data', () => {
    const notice = message(MESSAGE.uploadFailedValue, { p0: 503 });
    expect(localize('vi', notice)).toBe('Tải lên thất bại (503).');
    expect(localize('en', notice)).toBe('Upload failed (503).');
    expect(MESSAGE.conflict).toBe('conflict');
    expect(localize('en', 'An actual document title')).toBe('An actual document title');
  });
  it('maps API codes and contains unknown or malformed error data', () => {
    expect(translateError('en', 'INVALID_CREDENTIALS')).toBe('Incorrect email or password.');
    expect(translateError('vi', 'EMAIL_ALREADY_REGISTERED')).toBe('Email đã được đăng ký.');
    for (const error of [
      '__proto__',
      'toString',
      'Unknown private provider payload',
      'ted-message:{',
      'ted-message:{"key":"__proto__","params":{}}',
    ])
      expect(translateError('en', error)).toBe(
        translate('en', MESSAGE.somethingWentWrongPleaseTryAgain),
      );
    expect(isMessageKey('__proto__')).toBe(false);
  });
  it('uses locale number formatting and English singular/plural forms', () => {
    expect(countLabel('en', 1, 'matches')).toBe('1 match');
    expect(countLabel('en', 2, 'matches')).toBe('2 matches');
    expect(countLabel('en', 0, 'pages')).toBe('0 pages');
    expect(countLabel('vi', 1_000, 'lines')).toBe('1.000 dòng');
    expect(countLabel('en', 1_000, 'lines')).toBe('1,000 lines');
  });
});

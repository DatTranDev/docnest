import { UNIT_LABELS } from './units';
import { LOCALE_TAGS, type Locale } from '@/config/locale';
import { catalogs, MESSAGE, type MessageKey } from './messages';
export type MessageParams = Readonly<Record<string, string | number>>;
const MESSAGE_PREFIX = 'ted-message:';
export function isMessageKey(value: string): value is MessageKey {
  return Object.hasOwn(catalogs.vi, value);
}
export function translate(locale: Locale, key: MessageKey, params: MessageParams = {}): string {
  return catalogs[locale][key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}
// Keep pending errors language independent so switching locale also updates existing notices.
export function message(key: MessageKey, params: MessageParams): string {
  return MESSAGE_PREFIX + JSON.stringify({ key, params });
}
export function localize(locale: Locale, value: string): string {
  if (isMessageKey(value)) return translate(locale, value);
  if (value.startsWith(MESSAGE_PREFIX)) {
    try {
      const parsed: unknown = JSON.parse(value.slice(MESSAGE_PREFIX.length));
      if (
        parsed &&
        typeof parsed === 'object' &&
        'key' in parsed &&
        'params' in parsed &&
        typeof parsed.key === 'string' &&
        isMessageKey(parsed.key) &&
        parsed.params &&
        typeof parsed.params === 'object' &&
        Object.values(parsed.params).every((v) => typeof v === 'string' || typeof v === 'number')
      )
        return translate(locale, parsed.key, parsed.params as MessageParams);
    } catch {
      /* A malformed notice uses the generic error below. */
    }
    return translate(locale, MESSAGE.somethingWentWrongPleaseTryAgain);
  }
  return value;
}
const ERROR_KEYS: Record<string, MessageKey> = {
  CSRF_INVALID: MESSAGE.unableToObtainSessionProtectionPleaseTryAgain,
  INVALID_CREDENTIALS: 'invalidCredentials',
  EMAIL_ALREADY_EXISTS: 'emailAlreadyExists',
  EMAIL_ALREADY_REGISTERED: MESSAGE.emailAlreadyExists,
  INVALID_EMAIL: MESSAGE.invalidEmail,
  INVALID_PASSWORD: MESSAGE.invalidPassword,
  INVALID_DISPLAY_NAME: MESSAGE.invalidDisplayName,
  ACCOUNT_UNAVAILABLE: MESSAGE.sessionExpired,
  INVALID_TOKEN: MESSAGE.sessionExpired,
  TOKEN_EXPIRED: MESSAGE.sessionExpired,
  USER_NOT_REGISTERED: MESSAGE.resourceNotFound,
  DOCUMENT_NOT_FOUND: MESSAGE.resourceNotFound,
  FOLDER_NOT_FOUND: MESSAGE.resourceNotFound,
  FOLDER_NOT_EMPTY: MESSAGE.folderNotEmpty,
  FOLDER_CYCLE: MESSAGE.folderCycle,
  FOLDER_NAME_EXISTS: MESSAGE.folderNameExists,
  FILE_TOO_LARGE: MESSAGE.fileTooLarge,
  IMAGE_TOO_LARGE: MESSAGE.useAPngOrJpegImageUpTo,
  INVALID_IMAGE: MESSAGE.invalidFile,
  IMAGE_LIMIT: MESSAGE.imageLimit,
  MEDIA_LIMIT: MESSAGE.imageLimit,
  COLLABORATION_PENDING_LIMIT: MESSAGE.collaborationWasInterruptedYourDraftIsRetained,
  COLLABORATION_CATCHING_UP: MESSAGE.waitingForConnectionDraftRetained,
  EMAIL_EXISTS: 'emailAlreadyExists',
  UNAUTHENTICATED: 'sessionExpired',
  UNAUTHORIZED: 'sessionExpired',
  FORBIDDEN: MESSAGE.youCannotEditThisDocument,
  NOT_FOUND: 'resourceNotFound',
  REVISION_CONFLICT: MESSAGE.aNewerVersionExistsOnTheServerYour,
  HEAD_REVISION_CONFLICT: MESSAGE.aNewerVersionExistsOnTheServerYour,
  RATE_LIMITED: 'tooManyRequests',
  RATE_LIMIT_EXCEEDED: 'tooManyRequests',
  NETWORK_ERROR: MESSAGE.theRequestFailedPleaseTryAgain,
  DOWNLOAD_FAILED: MESSAGE.unableToDownloadContent,
  PAYMENT_DISABLED: 'paymentUnavailable',
  STRIPE_DISABLED: 'paymentUnavailable',
  BILLING_DISABLED: 'paymentUnavailable',
  COLLABORATION_UNAVAILABLE: MESSAGE.collaborationWasInterruptedYourDraftIsRetained,
  COLLABORATION_TEXT_LIMIT: 'collaborationLimit',
  TEXT_TOO_LARGE: 'fileTooLarge',
  TOO_MANY_LINES: 'tooManyLines',
  RICH_EXPORT_LIMIT: 'richExportLimit',
  TABLE_LIMIT: 'tableLimit',
  INVALID_FORMAT: 'invalidFile',
  INVALID_UTF8: 'invalidFile',
  INVALID_NATIVE: 'invalidFile',
  INVALID_CLIPBOARD: 'invalidClipboard',
};
export function translateError(locale: Locale, value: string): string {
  if (value.startsWith('FORMAT_REPLACE_LIMIT:') || value.startsWith('REPLACE_HISTORY_LIMIT:'))
    return translate(locale, MESSAGE.replaceLimit);
  if (isMessageKey(value) || value.startsWith(MESSAGE_PREFIX)) return localize(locale, value);
  return translate(
    locale,
    Object.hasOwn(ERROR_KEYS, value)
      ? ERROR_KEYS[value]!
      : MESSAGE.somethingWentWrongPleaseTryAgain,
  );
}
export function countLabel(
  locale: Locale,
  count: number,
  unit: 'bytes' | 'lines' | 'changes' | 'matches' | 'words' | 'pages',
): string {
  const label =
    UNIT_LABELS[locale][unit] +
    (locale === 'en' && count !== 1 ? (unit === 'matches' ? 'es' : 's') : '');
  return `${new Intl.NumberFormat(LOCALE_TAGS[locale]).format(count)} ${label}`;
}

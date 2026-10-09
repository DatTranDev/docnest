import { vi } from './vi';
import { en } from './en';
export const catalogs = { vi, en } as const;
export type MessageKey = keyof typeof vi;
// Stable IDs represent UI states as well as copy; translations never drive behavior.
export const MESSAGE = Object.freeze(
  Object.fromEntries(Object.keys(vi).map((key) => [key, key])),
) as { readonly [Key in MessageKey]: Key };

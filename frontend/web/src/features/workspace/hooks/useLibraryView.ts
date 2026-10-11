'use client';
import { useSyncExternalStore } from 'react';

type LibraryView = 'grid' | 'list';
const key = 'writing-room-library-view';
const change = 'writing-room-library-view-change';
let fallback: LibraryView = 'grid';

function storageKey(scope: string) {
  return scope === 'mine' ? key : `${key}-${scope}`;
}
function snapshot(scope: string): LibraryView {
  try {
    const stored = localStorage.getItem(storageKey(scope));
    if (stored === 'list' || stored === 'grid') return stored;
  } catch {
    /* Preference storage is optional. */
  }
  return scope !== 'mine' || window.matchMedia('(max-width: 760px)').matches ? 'list' : fallback;
}
function subscribe(listener: () => void) {
  const narrow = window.matchMedia('(max-width: 760px)');
  window.addEventListener('storage', listener);
  window.addEventListener(change, listener);
  narrow.addEventListener('change', listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(change, listener);
    narrow.removeEventListener('change', listener);
  };
}
function setView(view: LibraryView, scope: string) {
  fallback = view;
  try {
    localStorage.setItem(storageKey(scope), view);
  } catch {
    /* Keep the in-memory preference. */
  }
  window.dispatchEvent(new Event(change));
}
export function useLibraryView(scope = 'mine') {
  const view = useSyncExternalStore(
    subscribe,
    () => snapshot(scope),
    () => (scope === 'mine' ? ('grid' as const) : ('list' as const)),
  );
  return [view, (next: LibraryView) => setView(next, scope)] as const;
}

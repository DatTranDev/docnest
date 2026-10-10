'use client';
import { useSyncExternalStore } from 'react';

type LibraryView = 'grid' | 'list';
const key = 'writing-room-library-view';
const change = 'writing-room-library-view-change';
let fallback: LibraryView = 'grid';

function snapshot(): LibraryView {
  try {
    const stored = localStorage.getItem(key);
    if (stored === 'list' || stored === 'grid') return stored;
  } catch {
    /* Preference storage is optional. */
  }
  return fallback;
}
function subscribe(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener(change, listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(change, listener);
  };
}
function setView(view: LibraryView) {
  fallback = view;
  try {
    localStorage.setItem(key, view);
  } catch {
    /* Keep the in-memory preference. */
  }
  window.dispatchEvent(new Event(change));
}
export function useLibraryView() {
  const view = useSyncExternalStore(subscribe, snapshot, () => 'grid' as const);
  return [view, setView] as const;
}

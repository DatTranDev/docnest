import { useSyncExternalStore } from 'react';
function subscribe(notify: () => void): () => void {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
}
function snapshot(): boolean {
  return navigator.onLine;
}
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}

const eventName = 'docsnest:account';
/** Presentation only. Access is always checked by the authenticated workspace/API. */
export function publishAccountInitial(displayName: string | null) {
  if (typeof document === 'undefined') return;
  const initial = Array.from(displayName?.trim() ?? '')[0]?.toLocaleUpperCase() ?? '';
  document.cookie = `docsnest_account=${encodeURIComponent(initial)}; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}${initial ? '' : '; Max-Age=0'}`;
  window.dispatchEvent(new Event(eventName));
}
export function readAccountInitial() {
  try {
    return (
      Array.from(
        decodeURIComponent(
          document.cookie
            .split('; ')
            .find((value) => value.startsWith('docsnest_account='))
            ?.slice('docsnest_account='.length) ?? '',
        ),
      )[0] ?? ''
    );
  } catch {
    return '';
  }
}
export function subscribeAccount(listener: () => void) {
  window.addEventListener(eventName, listener);
  window.addEventListener('focus', listener);
  const timer = window.setInterval(listener, 2000);
  return () => {
    window.removeEventListener(eventName, listener);
    window.removeEventListener('focus', listener);
    clearInterval(timer);
  };
}

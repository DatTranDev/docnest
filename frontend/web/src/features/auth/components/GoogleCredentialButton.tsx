'use client';
import { useEffect, useRef } from 'react';
import { useI18n } from '@/lib/i18n';

export function GoogleCredentialButton({
  onCredential,
  disabled,
}: {
  onCredential: (credential: string) => void;
  disabled?: boolean;
}) {
  const { locale } = useI18n();
  const target = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  useEffect(() => {
    callback.current = onCredential;
  }, [onCredential]);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  useEffect(() => {
    const element = target.current;
    if (!clientId || !element) return;
    let active = true;
    let renderedWidth = 0;
    const render = () => {
      if (!active || !window.google) return;
      const width = Math.min(360, Math.floor(element.clientWidth));
      if (width <= 0 || renderedWidth === width) return;
      renderedWidth = width;
      element.replaceChildren();
      window.google.accounts.id.renderButton(element, {
        theme: 'outline',
        size: 'large',
        shape: 'rectangular',
        width,
        text: 'continue_with',
        locale,
        logo_alignment: 'center',
      });
    };
    const mount = () => {
      if (!active || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (active && response.credential) callback.current(response.credential);
        },
      });
      render();
    };
    const observer = new ResizeObserver(render);
    observer.observe(element);
    let script: HTMLScriptElement | undefined;
    if (window.google) mount();
    else {
      script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = mount;
      document.head.append(script);
    }
    return () => {
      active = false;
      observer.disconnect();
      script?.remove();
    };
  }, [clientId, locale]);
  return clientId ? <div ref={target} className="google-signin-button" inert={disabled} /> : null;
}

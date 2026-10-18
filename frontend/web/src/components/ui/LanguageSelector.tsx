'use client';

import { useEffect, useRef, useState } from 'react';
import { normalizeLocale } from '@/config/locale';
import { Icon } from '@/components/ui/Icon';
import { useI18n, MESSAGE } from '@/lib/i18n';

const languages = ['vi', 'en'] as const;

export function LanguageSelector({
  onLocale,
  inlineMenu = false,
  compact = false,
}: {
  onLocale?: (locale: 'vi' | 'en') => void;
  inlineMenu?: boolean;
  compact?: boolean;
}) {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    return () => document.removeEventListener('pointerdown', closeOnOutside);
  }, [open]);

  const selectLanguage = (value: string) => {
    (onLocale ?? setLocale)(normalizeLocale(value));
    setOpen(false);
    trigger.current?.focus();
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const options = Array.from(
      root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
    );
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    options[(current + delta + options.length) % options.length]?.focus();
  };

  return (
    <div
      className={`language-selector${inlineMenu ? ' language-selector-inline-menu' : ''}`}
      ref={root}
    >
      <button
        ref={trigger}
        className="language-selector-trigger"
        type="button"
        aria-label={`${t(MESSAGE.language)}: ${locale === 'vi' ? t(MESSAGE.vietnamese) : t(MESSAGE.english)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            requestAnimationFrame(() =>
              root.current
                ?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')
                ?.focus(),
            );
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        {compact && <Icon name="globe" size={17} />}
        <span>
          {compact
            ? locale.toUpperCase()
            : locale === 'vi'
              ? t(MESSAGE.vietnamese)
              : t(MESSAGE.english)}
        </span>
        <span className="language-selector-chevron" aria-hidden="true">
          <Icon name="chevron-down" size={14} />
        </span>
      </button>
      {open && (
        <div className="language-selector-menu" role="menu" onKeyDown={handleMenuKeyDown}>
          {languages.map((value) => {
            const selected = locale === value;
            return (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={selected ? 'language-option selected' : 'language-option'}
                onClick={() => selectLanguage(value)}
              >
                <span>{value === 'vi' ? t(MESSAGE.vietnamese) : t(MESSAGE.english)}</span>
                {selected && <span aria-hidden="true">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

export interface SelectOption {
  value: string;
  label: string;
}

export function OptionSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  inlineMenu = false,
  prefix,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  inlineMenu?: boolean;
  prefix?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    return () => document.removeEventListener('pointerdown', closeOnOutside);
  }, [open]);

  const select = (next: string) => {
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div
      ref={root}
      className={`option-select${inlineMenu ? ' option-select-inline' : ''}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        } else if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          const items = Array.from(
            root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
          );
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          event.preventDefault();
          items[next]?.focus();
        } else if (event.target === trigger.current && event.key === 'ArrowDown') {
          event.preventDefault();
          setOpen(true);
          requestAnimationFrame(() =>
            root.current
              ?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')
              ?.focus(),
          );
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="option-select-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled || !selected}
        onClick={() => setOpen((current) => !current)}
      >
        {prefix && <span className="option-select-prefix">{prefix}</span>}
        <span className="option-select-value">{selected?.label ?? ''}</span>
        <Icon name="chevron-down" size={14} />
      </button>
      {open && (
        <div className="option-select-menu" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={
                option.value === value ? 'option-select-option selected' : 'option-select-option'
              }
              onClick={() => select(option.value)}
            >
              <span>{option.label}</span>
              {option.value === value && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

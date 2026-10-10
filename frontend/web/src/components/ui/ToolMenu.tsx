'use client';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** Native details with a viewport-positioned popup and keyboard/outside dismissal. */
export function ToolMenu({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: IconName;
  children: ReactNode;
}) {
  const details = useRef<HTMLDetailsElement>(null),
    popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => {
    if (details.current) details.current.open = false;
  };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const panel = popup.current,
        trigger = details.current?.querySelector('summary');
      if (!panel || !trigger) return;
      const anchor = trigger.getBoundingClientRect();
      panel.style.position = 'fixed';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.maxHeight = `${innerHeight - 16}px`;
      const bounds = panel.getBoundingClientRect();
      panel.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - bounds.width - 8))}px`;
      panel.style.top = `${anchor.bottom + bounds.height + 8 <= innerHeight ? anchor.bottom + 5 : Math.max(8, anchor.top - bounds.height - 5)}px`;
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    popup.current
      ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      ?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !details.current?.contains(event.target)) {
        if (details.current) details.current.open = false;
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <details
      ref={details}
      className="tool-menu"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
          details.current?.querySelector('summary')?.focus();
        } else if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          const items = Array.from(
            popup.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
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
        }
      }}
    >
      <summary>
        {icon && <Icon name={icon} />}
        <span>{label}</span>
        <Icon name="chevron-down" size={13} />
      </summary>
      <div
        ref={popup}
        className="tool-menu-panel"
        aria-label={label}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button')) {
            close();
            details.current?.querySelector('summary')?.focus();
          }
        }}
      >
        {children}
      </div>
    </details>
  );
}

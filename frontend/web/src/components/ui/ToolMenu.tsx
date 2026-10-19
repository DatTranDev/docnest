'use client';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

const focusableControls =
  'button:not(:disabled), select:not(:disabled), input:not(:disabled), summary';

/** Native details with a viewport-positioned popup and keyboard/outside dismissal. */
export function ToolMenu({
  label,
  icon,
  children,
  closeOnSelect = true,
}: {
  label: string;
  icon?: IconName;
  children: ReactNode;
  closeOnSelect?: boolean;
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
    Array.from(popup.current?.querySelectorAll<HTMLElement>(focusableControls) ?? [])
      .find((item) => item.getClientRects().length > 0)
      ?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (details.current?.querySelector('dialog[open]')) return;
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
        if (event.currentTarget.querySelector('dialog[open]')) return;
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
      onKeyDown={(event) => {
        if (event.target instanceof Element && event.target.closest('dialog[open]')) return;
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
          details.current?.querySelector('summary')?.focus();
        } else if (
          open &&
          !(event.target instanceof HTMLInputElement) &&
          !(event.target instanceof HTMLSelectElement) &&
          ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
        ) {
          event.preventDefault();
          event.stopPropagation();
          const items = Array.from(
            popup.current?.querySelectorAll<HTMLElement>(focusableControls) ?? [],
          ).filter((item) => item.getClientRects().length > 0);
          const index = items.indexOf(document.activeElement as HTMLElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }
      }}
    >
      <summary aria-label={label}>
        {icon && <Icon name={icon} />}
        <span>{label}</span>
        <Icon name="chevron-down" size={13} />
      </summary>
      <div
        ref={popup}
        className="tool-menu-panel"
        aria-label={label}
        onClick={(event) => {
          if (closeOnSelect && (event.target as HTMLElement).closest('button')) {
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

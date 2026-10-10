'use client';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export interface MenuAction {
  label: string;
  icon?: IconName;
  danger?: boolean;
  onSelect: () => void;
}

export function ActionMenu({
  label,
  actions,
  children,
  className = '',
}: {
  label: string;
  actions: MenuAction[];
  children?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const popover = menu.current;
      const button = trigger.current;
      if (!popover || !button) return;
      popover.style.transform = '';
      popover.style.top = '';
      popover.style.bottom = '';
      popover.style.maxHeight = '';
      const bounds = popover.getBoundingClientRect();
      const anchor = button.getBoundingClientRect();
      const shift =
        bounds.left < 8
          ? 8 - bounds.left
          : bounds.right > innerWidth - 8
            ? innerWidth - 8 - bounds.right
            : 0;
      popover.style.transform = `translateX(${shift}px)`;
      if (bounds.bottom > innerHeight - 8 && anchor.top > bounds.height + 8) {
        popover.style.top = 'auto';
        popover.style.bottom = 'calc(100% + 5px)';
      } else if (bounds.bottom > innerHeight - 8) {
        popover.style.maxHeight = `${Math.max(80, innerHeight - anchor.bottom - 16)}px`;
      }
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
    menu.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  if (!actions.length) return null;
  return (
    <div
      ref={root}
      className={`action-menu ${className}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="action-menu-trigger"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {children ?? <Icon name="more-vertical" size={19} />}
      </button>
      {open && (
        <div
          ref={menu}
          className="action-menu-popover"
          role="menu"
          aria-label={label}
          onKeyDown={(event) => {
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
            );
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              trigger.current?.focus();
            } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
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
          {actions.map((action) => (
            <button
              key={action.label}
              role="menuitem"
              tabIndex={-1}
              className={action.danger ? 'menu-danger' : ''}
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
                action.onSelect();
              }}
            >
              {action.icon && <Icon name={action.icon} size={18} />}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

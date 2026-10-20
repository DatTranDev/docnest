import type { ReactNode } from 'react';

export type IconName =
  | 'user'
  | 'monitor'
  | 'shield'
  | 'lock'
  | 'check'
  | 'document'
  | 'settings'
  | 'credit-card'
  | 'info'
  | 'globe'
  | 'folder'
  | 'shared'
  | 'trash'
  | 'chevron'
  | 'undo'
  | 'redo'
  | 'search'
  | 'save'
  | 'share'
  | 'history'
  | 'download'
  | 'upload'
  | 'copy'
  | 'cloud'
  | 'more'
  | 'more-vertical'
  | 'plus'
  | 'grid'
  | 'list'
  | 'edit'
  | 'move'
  | 'restore'
  | 'arrow-up'
  | 'chevron-down'
  | 'sign-out'
  | 'close'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'align-justify'
  | 'link'
  | 'image'
  | 'table';

const shapes: Record<IconName, ReactNode> = {
  user: (
    <>
      <circle cx="12" cy="7" r="4" />
      <path d="M4 21v-2a8 8 0 0 1 16 0v2Z" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M12 17v4M8 21h8" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  settings: (
    <>
      <path d="m10 3-.6 2.4-2 .9L5.2 6 3 10l1.8 1.6v2.3L3 15.5l2.2 3.8 2.2-.6 2 .9.6 2.4h4l.6-2.4 2-.9 2.2.6 2.2-3.8-1.8-1.6v-2.3L21 10l-2.2-4-2.2.3-2-.9L14 3Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'credit-card': (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M7 15h3" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7h.01" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </>
  ),
  document: (
    <>
      <path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M14 3v5h5M9 12h6M9 16h6" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3V7Z" />,
  shared: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 19v-2a6 6 0 0 1 12 0v2M17 7a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" />
    </>
  ),
  chevron: <path d="m9 6 6 6-6 6" />,
  undo: (
    <>
      <path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 6 6" />
    </>
  ),
  redo: (
    <>
      <path d="m15 7 5 5-5 5M20 12H10a6 6 0 0 0-6 6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m16 16 5 5" />
    </>
  ),
  save: (
    <>
      <path d="M4 3h14l3 3v15H3V3h1ZM7 3v7h10V3M7 21v-8h10v8" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="2" />
      <circle cx="6" cy="12" r="2" />
      <circle cx="18" cy="19" r="2" />
      <path d="m8 11 8-5M8 13l8 5" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 3" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m-4-4 4 4 4-4M4 18v3h16v-3" />
    </>
  ),
  upload: (
    <>
      <path d="M12 17V5m-4 4 4-4 4 4M4 18v3h16v-3" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" />
    </>
  ),
  cloud: (
    <>
      <path d="M7 19h11a4 4 0 0 0 .7-7.9A6 6 0 0 0 7.2 9a5 5 0 0 0-.2 10Z" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  close: <path d="M5 5 19 19M19 5 5 19" />,
  'more-vertical': (
    <>
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="19" r="1" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  grid: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </>
  ),
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  edit: <path d="m16 3 5 5-12 12-6 1 1-6L16 3ZM13 6l5 5" />,
  move: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3V7Z" />
      <path d="M8 13h8m-3-3 3 3-3 3" />
    </>
  ),
  restore: <path d="M4 10a8 8 0 1 1 1 8M4 4v6h6M12 8v4l3 2" />,
  'arrow-up': <path d="M12 20V4m-6 6 6-6 6 6" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'sign-out': <path d="M9 4H4v16h5M9 12h12m-5-5 5 5-5 5" />,
  'align-left': <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />,
  'align-center': <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />,
  'align-right': <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />,
  'align-justify': <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />,
  link: (
    <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" />
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m4 18 5-5 3 3 3-4 5 6" />
    </>
  ),
  table: <path d="M3 4h18v16H3V4ZM3 9h18M9 4v16M15 4v16" />,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {shapes[name]}
    </svg>
  );
}

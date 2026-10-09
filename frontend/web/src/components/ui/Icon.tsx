import type { ReactNode } from 'react';

export type IconName =
  | 'document'
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
  | 'more'
  | 'close'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'align-justify';

const shapes: Record<IconName, ReactNode> = {
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
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  close: <path d="M5 5 19 19M19 5 5 19" />,
  'align-left': <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />,
  'align-center': <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />,
  'align-right': <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />,
  'align-justify': <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />,
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

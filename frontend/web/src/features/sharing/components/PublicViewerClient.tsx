'use client';
import { MESSAGE } from '@/lib/i18n/messages';

import dynamic from 'next/dynamic';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
const PublicViewer = dynamic(() => import('./PublicViewer'), {
  ssr: false,
  loading: () => <LoadingIndicator message={MESSAGE.openingSharedDocument} />,
});
export function PublicViewerClient({ token }: { token: string }) {
  return <PublicViewer key={token} token={token} />;
}

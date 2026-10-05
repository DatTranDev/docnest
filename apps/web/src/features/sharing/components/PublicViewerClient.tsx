'use client';
import dynamic from 'next/dynamic';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
const PublicViewer = dynamic(() => import('./PublicViewer'), {
  ssr: false,
  loading: () => <LoadingIndicator message="Đang mở tài liệu chia sẻ…" />,
});
export function PublicViewerClient({ token }: { token: string }) {
  return <PublicViewer key={token} token={token} />;
}

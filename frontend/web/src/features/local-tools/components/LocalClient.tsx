'use client';
import dynamic from 'next/dynamic';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
const LocalWorkbench = dynamic(() => import('./LocalWorkbench'), {
  ssr: false,
  loading: () => <LoadingIndicator />,
});
export function LocalClient() {
  return <LocalWorkbench />;
}

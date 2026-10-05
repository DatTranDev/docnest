'use client';
import dynamic from 'next/dynamic';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
const WorkspaceScreen = dynamic(() => import('./WorkspaceScreen'), {
  ssr: false,
  loading: () => <LoadingIndicator />,
});
export function WorkspaceClient() {
  return <WorkspaceScreen />;
}

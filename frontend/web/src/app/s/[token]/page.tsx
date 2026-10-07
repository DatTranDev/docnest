import { PublicViewerClient } from '@/features/sharing';
export const dynamic = 'force-dynamic';
export default async function PublicSharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicViewerClient token={token} />;
}

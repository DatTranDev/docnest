import { LocalClient } from '@/features/local-tools';
import { pageMetadata } from '@/lib/seo/server';
export const generateMetadata = () => pageMetadata('local');

export default function LocalPage() {
  return <LocalClient />;
}

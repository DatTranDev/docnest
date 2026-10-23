import { SitePolicy } from '@/features/local-tools';
import { pageMetadata } from '@/lib/seo/server';
export const generateMetadata = () => pageMetadata('privacy');
export default function PrivacyPage() {
  return <SitePolicy kind="privacy" />;
}

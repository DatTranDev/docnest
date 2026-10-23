import { SitePolicy } from '@/features/local-tools';
import { pageMetadata } from '@/lib/seo/server';
export const generateMetadata = () => pageMetadata('terms');
export default function TermsPage() {
  return <SitePolicy kind="terms" />;
}

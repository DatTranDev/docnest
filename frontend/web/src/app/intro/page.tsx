import { SiteIntro } from '@/features/local-tools';
import { pageMetadata } from '@/lib/seo/server';
export const generateMetadata = () => pageMetadata('intro');
export default function IntroPage() {
  return <SiteIntro />;
}

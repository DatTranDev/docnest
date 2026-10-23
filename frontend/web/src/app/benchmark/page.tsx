import { BenchmarkHarness } from '@/features/editor';
import { pageMetadata } from '@/lib/seo/server';
export const generateMetadata = () => pageMetadata('internal');
export const dynamic = 'force-dynamic';
export default function BenchmarkPage() {
  return <BenchmarkHarness />;
}

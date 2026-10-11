import { redirect } from 'next/navigation';

export default async function LocalPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const selected = ['document', 'markdown', 'code', 'json'].includes(mode ?? '')
    ? `?mode=${mode}`
    : '';
  redirect(`/intro${selected}#editor`);
}

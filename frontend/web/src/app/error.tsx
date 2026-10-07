'use client';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
export default function ErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main>
      <ErrorNotice message="Không thể mở trang. Bản nháp trên thiết bị vẫn được giữ." />
      <button onClick={reset}>Thử lại</button>
    </main>
  );
}

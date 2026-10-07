import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
export const metadata: Metadata = {
  title: 'Trang viết',
  description: 'Tài liệu riêng tư, định dạng gọn nhẹ.',
  referrer: 'no-referrer',
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}

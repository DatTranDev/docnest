import Link from 'next/link';

export default function NotFound() {
  return (
    <main>
      <h1>Không tìm thấy trang</h1>
      <Link href="/">Về tài liệu</Link>
    </main>
  );
}

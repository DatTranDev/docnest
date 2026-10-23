import type { Locale } from '@/config/locale';
import type { SeoPage } from '@/config/seo';

const copy = {
  vi: {
    intro: {
      title: 'Docnivo – Soạn văn bản, Markdown, code và JSON',
      description:
        'Soạn văn bản, xem trước Markdown, chỉnh sửa code và định dạng JSON với Docnivo. Dùng trình soạn thảo trên trình duyệt không cần đăng nhập, tải tệp để giữ bản nháp.',
    },
    local: {
      title: 'Trình soạn thảo văn bản, Markdown, code và JSON – Docnivo',
      description:
        'Mở và chỉnh sửa văn bản, Markdown, code hoặc JSON ngay trong trình duyệt. Không cần tài khoản, không tải nội dung lên máy chủ. Tải tệp để giữ công việc.',
    },
    privacy: {
      title: 'Quyền riêng tư – Docnivo',
      description: 'Cách Docnivo xử lý tệp, thông tin tài khoản và dữ liệu trình duyệt của bạn.',
    },
    terms: {
      title: 'Điều khoản sử dụng – Docnivo',
      description: 'Điều kiện sử dụng Docnivo để soạn thảo, lưu trữ và chia sẻ tài liệu.',
    },
    workspace: {
      title: 'Không gian tài liệu – Docnivo',
      description: 'Đăng nhập để quản lý, soạn thảo và chia sẻ tài liệu của bạn với Docnivo.',
    },
    share: {
      title: 'Tài liệu được chia sẻ – Docnivo',
      description: 'Xem tài liệu được chia sẻ qua liên kết Docnivo.',
    },
    internal: { title: 'Công cụ nội bộ – Docnivo', description: 'Công cụ phát triển nội bộ.' },
  },
  en: {
    intro: {
      title: 'Docnivo – Text, Markdown, code and JSON editor',
      description:
        'Write documents, preview Markdown, edit code and format JSON with Docnivo. Use the browser editor without signing in and download files to keep your drafts.',
    },
    local: {
      title: 'Text, Markdown, code and JSON editor – Docnivo',
      description:
        'Open and edit documents, Markdown, code or JSON in your browser. No account required and no file content uploads. Download your files to keep your work.',
    },
    privacy: {
      title: 'Privacy – Docnivo',
      description: 'How Docnivo handles your files, account information and browser data.',
    },
    terms: {
      title: 'Terms of use – Docnivo',
      description: 'Conditions for using Docnivo to write, store and share documents.',
    },
    workspace: {
      title: 'Document workspace – Docnivo',
      description: 'Sign in to organize, edit and share your documents with Docnivo.',
    },
    share: {
      title: 'Shared document – Docnivo',
      description: 'View a document shared through a Docnivo link.',
    },
    internal: { title: 'Internal tools – Docnivo', description: 'Internal development tools.' },
  },
} satisfies Record<Locale, Record<SeoPage, { title: string; description: string }>>;

export function seoCopy(locale: Locale, page: SeoPage) {
  return copy[locale][page];
}

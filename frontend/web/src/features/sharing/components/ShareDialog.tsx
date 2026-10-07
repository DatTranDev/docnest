'use client';
import { useState, useEffect, useCallback } from 'react';
import { errorMessage } from '@/lib/http';
import {
  listSharing,
  grantAccess,
  changeAccess,
  revokeAccess,
  createShareLink,
  revokeShareLink,
} from '../api/sharing';
import type { Permission, ShareLink } from '../model/types';
export function ShareDialog({
  documentId,
  onClose,
  setError,
}: {
  documentId: string;
  onClose: () => void;
  setError: (s: string) => void;
}) {
  const [permissions, setPermissions] = useState<Permission[]>([]),
    [links, setLinks] = useState<ShareLink[]>([]),
    [created, setCreated] = useState('');
  const load = useCallback(
    () =>
      listSharing(documentId).then((result) => {
        setPermissions(result.permissions);
        setLinks(result.links);
      }),
    [documentId],
  );
  useEffect(() => {
    void load().catch((e) => setError(errorMessage(e)));
  }, [load, setError]);
  async function action(fn: () => Promise<unknown>) {
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <div className="modal" role="dialog" aria-label="Chia sẻ">
      <div className="panel">
        <h2>Chia sẻ tài liệu</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void action(() =>
              grantAccess(documentId, String(f.get('email')), String(f.get('role'))),
            );
          }}
        >
          <input
            type="email"
            name="email"
            aria-label="Email người nhận"
            placeholder="Email đã đăng ký"
            required
          />
          <select name="role" aria-label="Quyền">
            <option value="VIEWER">Chỉ xem</option>
            <option value="EDITOR">Chỉnh sửa</option>
          </select>
          <button>Cấp quyền</button>
        </form>
        {permissions.map((p) => (
          <div className="row" key={p.granteeUserId}>
            <span>{p.email ?? p.displayName ?? p.granteeUserId}</span>
            <select
              aria-label={`Quyền ${p.email ?? p.granteeUserId}`}
              value={p.role}
              onChange={(e) => {
                void action(() => changeAccess(documentId, p.granteeUserId, e.target.value));
              }}
            >
              <option value="VIEWER">Chỉ xem</option>
              <option value="EDITOR">Chỉnh sửa</option>
            </select>
            <button
              onClick={() => {
                void action(() => revokeAccess(documentId, p.granteeUserId));
              }}
            >
              Thu hồi
            </button>
          </div>
        ))}
        <h3>Liên kết công khai chỉ đọc</h3>
        <button
          onClick={() => {
            void action(async () => {
              const c = await createShareLink(documentId);
              setCreated(`${location.origin}${c.viewerPath}`);
            });
          }}
        >
          Tạo liên kết 7 ngày
        </button>
        {created && (
          <div className="row">
            <input aria-label="Liên kết công khai" value={created} readOnly />
            <button
              onClick={() => {
                void navigator.clipboard.writeText(created);
              }}
            >
              Sao chép
            </button>
          </div>
        )}
        {links.map((l) => (
          <div className="row" key={l.id}>
            <span>
              Hết hạn {new Date(l.expiresAt).toLocaleString('vi-VN')} ·{' '}
              {l.revokedAt ? 'Đã thu hồi' : 'Đang hoạt động'}
            </span>
            {!l.revokedAt && (
              <button
                onClick={() => {
                  void action(() => revokeShareLink(documentId, l.id));
                }}
              >
                Thu hồi liên kết
              </button>
            )}
          </div>
        ))}
        <p className="muted">
          Người nhận có thể giữ bản đã tải. Khôi phục từ thùng rác sẽ kích hoạt lại quyền và liên
          kết còn hạn.
        </p>
        <button onClick={onClose}>Đóng</button>
      </div>
    </div>
  );
}

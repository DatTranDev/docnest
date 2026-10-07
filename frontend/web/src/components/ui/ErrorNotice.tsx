export function ErrorNotice({ message, onClose }: { message: string; onClose?: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="error">
      {message}
      {onClose && (
        <button aria-label="Đóng lỗi" onClick={onClose}>
          ×
        </button>
      )}
    </div>
  );
}

export function LoadingIndicator({ message = 'Đang khôi phục phiên…' }: { message?: string }) {
  return (
    <div className="loading" role="status">
      {message}
    </div>
  );
}

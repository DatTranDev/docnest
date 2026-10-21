/** Shared, accessible Docnivo vector lockup for all frontend brand surfaces. */
export function DocnivoBrand({
  variant = 'wordmark',
}: {
  variant?: 'wordmark' | 'mark';
}) {
  return (
    <span
      className={variant === 'mark' ? 'docnivo-mark' : 'docnivo-wordmark'}
      role="img"
      aria-label="Docnivo"
    />
  );
}

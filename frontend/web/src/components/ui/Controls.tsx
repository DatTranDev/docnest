import type { ComponentProps, ReactNode } from 'react';

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  size?: 'compact' | 'default';
};

export function Button({
  variant = 'secondary',
  size = 'default',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`control control-${variant} control-${size} ${className}`}
      {...props}
    />
  );
}

export function IconButton({
  'aria-label': label,
  className = '',
  ...props
}: Omit<ButtonProps, 'children'> & { 'aria-label': string; children: ReactNode }) {
  return (
    <Button
      variant="ghost"
      size="compact"
      aria-label={label}
      className={`control-icon ${className}`}
      {...props}
    />
  );
}

export function SelectTrigger({ className = '', ...props }: ComponentProps<'button'>) {
  return <Button size="compact" className={`select-trigger ${className}`} {...props} />;
}

/** A group of independent pressed buttons; native Tab/Space/Enter behavior is retained. */
export function SegmentedControl({
  className = '',
  ...props
}: ComponentProps<'div'> & { 'aria-label': string }) {
  return <div role="group" className={`segmented-control ${className}`} {...props} />;
}

'use client';
import Image from 'next/image';
import { useState } from 'react';

function AvatarFace({
  name,
  src,
  size,
  className,
}: {
  name: string;
  src?: string | null;
  size: number;
  className: string;
}) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const initials =
    name
      .trim()
      .split(/\s+/u)
      .slice(0, 2)
      .map((part) => Array.from(part)[0]?.toLocaleUpperCase() ?? '')
      .join('') || '?';
  return (
    <span
      className={`user-avatar ${className}`.trim()}
      style={{ width: size, height: size }}
      role="img"
      aria-label={name}
      data-loading={!!src && !ready && !failed}
    >
      <span aria-hidden="true">{initials}</span>
      {src && !failed && (
        <Image
          src={src}
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          unoptimized
          onLoad={() => setReady(true)}
          onError={() => setFailed(true)}
          style={{ opacity: ready ? 1 : 0 }}
        />
      )}
    </span>
  );
}

export function Avatar({
  name,
  src,
  size = 32,
  className = '',
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  return <AvatarFace key={src ?? ''} name={name} src={src} size={size} className={className} />;
}

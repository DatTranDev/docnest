export interface ServiceOrigins {
  identity: string;
  document: string;
  processing: string;
}
function origin(value: string | undefined, fallback: string, name: string): string {
  const url = new URL(value ?? fallback);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error(
      `${name} must be an HTTP(S) origin without credentials, path, query or fragment.`,
    );
  return url.origin;
}
export function serviceOrigins(
  environment: Readonly<Record<string, string | undefined>>,
): ServiceOrigins {
  return {
    identity: origin(
      environment.IDENTITY_INTERNAL_ORIGIN,
      'http://127.0.0.1:8081',
      'IDENTITY_INTERNAL_ORIGIN',
    ),
    document: origin(
      environment.DOCUMENT_INTERNAL_ORIGIN,
      'http://127.0.0.1:8082',
      'DOCUMENT_INTERNAL_ORIGIN',
    ),
    processing: origin(
      environment.PROCESSING_INTERNAL_ORIGIN,
      'http://127.0.0.1:8083',
      'PROCESSING_INTERNAL_ORIGIN',
    ),
  };
}

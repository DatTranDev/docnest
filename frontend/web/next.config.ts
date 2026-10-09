import type { NextConfig } from 'next';
import path from 'node:path';
import { serviceOrigins } from './src/config/server';
const origins = serviceOrigins(process.env);
const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(import.meta.dirname, '../..'),
  transpilePackages: ['@ted/editor-core'],
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'private, no-store' }] },
    ];
  },
  async rewrites() {
    return [
      { source: '/api/v1/auth/:path*', destination: `${origins.identity}/api/v1/auth/:path*` },
      { source: '/.well-known/:path*', destination: `${origins.identity}/.well-known/:path*` },
      { source: '/api/v1/jobs/:path*', destination: `${origins.processing}/api/v1/jobs/:path*` },
      { source: '/api/v1/billing/:path*', destination: `${origins.payment}/api/v1/billing/:path*` },
      {
        source: '/api/v1/collaboration/:path*',
        destination: `${origins.collaboration}/api/v1/collaboration/:path*`,
      },
      { source: '/api/:path*', destination: `${origins.document}/api/:path*` },
    ];
  },
};
export default config;

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  agentRules: false,
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  async rewrites() {
    const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
    return [{ source: '/api/v1/:path*', destination: `${apiUrl}/api/v1/:path*` }];
  },
};

export default nextConfig;

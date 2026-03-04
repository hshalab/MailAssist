/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Fix for thread-stream/pino build errors
  serverExternalPackages: ['pino', 'thread-stream', 'imapflow'],
  // Turbopack configuration
  turbopack: {
    resolveAlias: {},
  },
  output: "standalone",
}

export default nextConfig

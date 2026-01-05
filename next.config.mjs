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
  // Suppress source map warnings in development
  webpack: (config, { dev, isServer }) => {
    if (dev) {
      config.devtool = 'cheap-module-source-map';
    }
    return config;
  },
}

export default nextConfig

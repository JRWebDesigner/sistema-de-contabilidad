/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: [
    'contabilidad.businessmansrl.com',
    '192.168.0.6',
  ],
}

export default nextConfig

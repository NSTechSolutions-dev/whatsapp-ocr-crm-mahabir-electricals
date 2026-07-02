/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
      },
      {
        protocol: "https",
        hostname: "*.amazonaws.com",
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:4000/api/:path*", // Proxy backend API in development
      },
      {
        source: "/webhooks/:path*",
        destination: "http://localhost:4000/api/webhooks/:path*",
      },
    ];
  },
};

module.exports = nextConfig;

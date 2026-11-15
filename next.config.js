/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      { source: "/practice", destination: "/", permanent: false },
      { source: "/stats", destination: "/", permanent: false },
    ];
  },
};

module.exports = nextConfig;

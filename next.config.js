/** @type {import('next').NextConfig} */
const nextConfig = {
  // Several servers may run from this directory at once; each gets its own build dir.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // PGlite (local-development database) loads its WASM/data files from disk
  // relative to its own module, so it must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  async redirects() {
    return [
      { source: "/practice", destination: "/", permanent: false },
      { source: "/stats", destination: "/", permanent: false },
    ];
  },
};

module.exports = nextConfig;

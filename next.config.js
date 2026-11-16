/** @type {import('next').NextConfig} */
const nextConfig = {
  // Several servers may run from this directory at once; each gets its own build dir.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // PGlite (local-development database) loads its WASM/data files from disk
  // relative to its own module, so it must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Conservative security headers on every response (pages, assets and API).
  // Nothing in the app frames itself, so framing is denied outright.
  // Deliberately NO Content-Security-Policy yet: the app relies on an inline
  // theme script and on WebGL/3D assets, and a wrong policy breaks it. Deferred.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/practice", destination: "/", permanent: false },
      { source: "/stats", destination: "/", permanent: false },
    ];
  },
};

module.exports = nextConfig;

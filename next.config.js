/** @type {import('next').NextConfig} */
const nextConfig = {
  // Several servers may run from this directory at once; each gets its own build dir.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // PGlite (local-development database) loads its WASM/data files from disk
  // relative to its own module, so it must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Conservative security headers on every response (pages, assets and API).
  // Nothing in the app frames itself, so framing is denied outright.
  // The CSP is REPORT-ONLY on purpose: it logs violations in the console
  // without blocking anything, so it can be tightened from real data first.
  async headers() {
    const dev = process.env.NODE_ENV !== "production";
    const csp = [
      "default-src 'self'",
      // Inline scripts: the theme bootstrap and Next's own bootstrap data.
      `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://avatars.githubusercontent.com https://*.googleusercontent.com",
      "font-src 'self'",
      "connect-src 'self' blob:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      // upgrade-insecure-requests is left out while the policy is report-only: browsers ignore it there
      // and log an error on every page. Add it back when the policy becomes enforcing.
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Content-Security-Policy-Report-Only", value: csp },
        ],
      },
      {
        // Versioned by a ?v= query on the URL (HAND_MODEL_URL); bump it when the file changes.
        source: "/models/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
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

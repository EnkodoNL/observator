// SPDX-License-Identifier: FSL-1.1-ALv2
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: false,
  poweredByHeader: false,
  images: { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // /node became /runtimes; links in older notifications still point there.
  async redirects() {
    return [{ source: "/node", destination: "/runtimes", permanent: true }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Browsers only honour it over https, so it is harmless on a plain-http install. No
          // includeSubDomains: other hosts under the same domain are not Observator's to decide.
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          // No script-src: Next's inline scripts would need nonces on every page. These still stop
          // framing, <base> hijacking, plugins, and forms posting elsewhere.
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

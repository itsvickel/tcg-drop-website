/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Where the build goes, overridable per process.
   *
   * `next build` and `next dev` both write to `.next` by default, so running a
   * build while a dev server is up corrupts the server's chunks out from under
   * it — every page then 500s with "Cannot find module './2899.js'" and the
   * only clue is that it worked a minute ago. That happened while a dev server
   * was serving the phone over HTTPS for camera testing, which is exactly when
   * it is least obvious and most annoying.
   *
   * Set NEXT_DIST_DIR to give a long-running server its own directory:
   *   NEXT_DIST_DIR=.next-dev npx next dev ...
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.shopify.com" },
      { protocol: "https", hostname: "*.myshopify.com" },
      { protocol: "https", hostname: "multimedia.bbyastatic.ca" },
      { protocol: "https", hostname: "images.pokemoncenter.com" },
      { protocol: "https", hostname: "cdn11.bigcommerce.com" }
    ]
  }
};

module.exports = nextConfig;

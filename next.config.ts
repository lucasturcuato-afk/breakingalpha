import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: ".",
  },
  /*
   * Externalise the Chromium binary packer so Next doesn't try to
   * inline the Brotli-compressed tarball (~50MB) into the serverless
   * bundle. Without this, puppeteer-core blows up at launch with
   * "cannot find executable" and the Vercel function size balloons.
   *
   * puppeteer-core is also marked external even though it's much
   * smaller — Next's bundler sometimes fails on its dynamic
   * websocket transport resolution in Node mode; externalising it
   * lets Node's resolver find the installed package at runtime.
   */
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium-min"],
  /*
   * public/ is served from the CDN and is not bundled into the serverless
   * function, so the memo PDF route cannot fs.readFileSync its faces without
   * tracing them in explicitly. Without this the route silently falls back to
   * the built-in Helvetica and logs "[memo-pdf] app faces unavailable".
   */
  outputFileTracingIncludes: {
    "/api/memo/export-pdf": ["./public/fonts/memo-pdf/**"],
  },
  /*
   * Radar unification: the standalone Watchlist / Thesis Board / Thesis
   * Tracker tabs moved under /radar. Permanent redirects keep every old
   * deep link alive; query strings (e.g. /thesis-board?thesis=<id>) pass
   * through automatically. /watchlist/[identifier] and /watchlist/export
   * deliberately do NOT redirect: the publicly-previewable detail pages
   * (see src/proxy.ts carve-out) and the print report stay at their
   * original paths, and redirect sources match exact paths only.
   */
  async redirects() {
    return [
      { source: "/watchlist", destination: "/radar/watchlist", permanent: true },
      { source: "/thesis-board", destination: "/radar/theses", permanent: true },
      { source: "/track-record", destination: "/radar/track-record", permanent: true },
      {
        source: "/track-record/:thesisId",
        destination: "/radar/track-record/:thesisId",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;

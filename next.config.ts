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
};

export default nextConfig;

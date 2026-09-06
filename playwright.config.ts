import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { config as dotenvConfig } from "dotenv";

// Load .env.local so E2E_USER_EMAIL / E2E_USER_PASSWORD are available
dotenvConfig({ path: path.resolve(__dirname, ".env.local") });

const AUTH_FILE = path.join(__dirname, "e2e", ".auth", "user.json");

// When E2E_BASE_URL points at a remote host (e.g. https://signalera.ai via
// .env.playwright), skip the localhost dev server and the setup-project storage
// state — the smoke-prod project signs in fresh against the remote URL.
const isRemoteTarget = !!process.env.E2E_BASE_URL?.startsWith("https://");

// Gating vs non-gating project separation.
//
// The auth-smoke and prod-smoke-5route specs are PROD-TARGET specs: they are
// documented to run against the live signalera.ai site (E2E_BASE_URL=https://...
// from .env.playwright) and they hard-fail by design when E2E_BASE_URL is unset
// (`Missing required env vars: E2E_BASE_URL`). Running them in the LOCAL gate
// produced 8 false failures that had nothing to do with the code under test.
//
// So: the local gate (default, no remote target) runs setup + chromium only.
// The smoke-prod project runs ONLY against a remote target. This is project
// separation, not deletion: both suites stay runnable for their intended target.
// See docs/recon/preflight-baseline.md (e2e section).
const setupProject = {
  name: "setup",
  testMatch: /auth\.setup\.ts/,
};
const chromiumProject = {
  name: "chromium",
  use: {
    ...devices["Desktop Chrome"],
    storageState: AUTH_FILE,
  },
  dependencies: ["setup"],
  // e2e/pressure has its own config (pressure.config.ts), its own target (a
  // production build on 3370 started with VERCEL_ENV=preview) and its own
  // auth file. Picked up by this project it fails 25 ways on connection and
  // storage-state errors before measuring anything. `npm run test:pressure`.
  testIgnore: /(auth-smoke|prod-smoke-5route)\.spec\.ts|[\/\\]pressure[\/\\]/,
};
const smokeProdProject = {
  name: "smoke-prod",
  testMatch: /(auth-smoke|prod-smoke-5route)\.spec\.ts/,
  use: { ...devices["Desktop Chrome"] },
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  timeout: 30_000,
  use: {
    // E2E_LOCAL_URL points the local gate at a dev server you started from
    // THIS checkout on another port (pair it with E2E_REUSE_SERVER=1).
    baseURL: process.env.E2E_LOCAL_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: isRemoteTarget
    ? [smokeProdProject]
    : [setupProject, chromiumProject],
  webServer: isRemoteTarget
    ? undefined
    : {
        command: "npm run dev",
        url: process.env.E2E_LOCAL_URL ?? "http://localhost:3000",
        // NEVER reuse a server this run did not start unless told to. On
        // 2026-09-05 a dev server from another worktree, started three weeks
        // earlier, was sitting on :3000; Playwright reused it and 60 of 85
        // failures were 404s and stale selectors against that checkout, not
        // this one. With reuse off, an occupied port fails the run at startup
        // with Playwright's own "port is already used" message, which names
        // the problem. E2E_REUSE_SERVER=1 opts back in for a server you started
        // yourself from THIS checkout.
        reuseExistingServer: !!process.env.E2E_REUSE_SERVER,
        timeout: 60_000,
      },
});

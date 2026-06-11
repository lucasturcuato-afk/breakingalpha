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
  testIgnore: /(auth-smoke|prod-smoke-5route)\.spec\.ts/,
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
    baseURL: "http://localhost:3000",
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
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});

/**
 * A config of its own, deliberately separate from `playwright.config.ts`.
 *
 * The repo config's default projects run `setup` plus the whole `e2e/`
 * directory against a dev server on 3000, and that suite is mutating and
 * prod-targeted. This one runs ONLY `e2e/pressure`, against an already-running
 * local production build on 3370, and starts no server of its own: the server's
 * environment (`VERCEL_ENV=preview`, NODE_ENV=production) is the thing under
 * test, so it is started by hand and asserted in `00-environment.spec.ts`
 * rather than being implied by a `webServer` block.
 */
import { defineConfig } from "@playwright/test";
import path from "path";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: path.resolve(__dirname, "../../.env.local") });

export default defineConfig({
  testDir: __dirname,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: path.resolve(__dirname, "../../pressure-report/playwright.json") }]],
  timeout: 20 * 60_000,
  expect: { timeout: 10_000 },
  use: {
    /* LOCATOR ACTIONS DEFAULT TO NO TIMEOUT AT ALL, and that is not a
       theoretical hazard: `sheet.innerText()` on a sheet that had just closed
       hung this suite indefinitely, with a `.catch()` on it that could never
       fire because the promise never settled. Every action gets a ceiling. */
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    baseURL: process.env.PRESSURE_BASE_URL ?? "http://localhost:3370",
    trace: "off",
    screenshot: "off",
  },
  outputDir: path.resolve(__dirname, "../../pressure-report/artifacts"),
});

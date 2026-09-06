/**
 * Per-test fixtures for the e2e account, through the app's own API routes.
 *
 * WHY. The e2e account is whatever a human last left it as. A test that
 * asserts "Nothing on your watchlist yet" against hand-populated rows fails
 * for a reason that has nothing to do with the product, and a test that adds
 * AAPL and never removes it changes the next run's starting state. Each test
 * makes the state it asserts and puts the account back afterwards. Only the
 * routes the product itself uses are called, as the signed-in user, so RLS
 * applies exactly as it does for a reader.
 *
 * Nothing here touches the pipeline's data (briefs, calls, articles). A test
 * that needs today's brief to carry a call cannot seed that, and says so with
 * a skip rather than a timeout: see commit-note-gate.spec.ts.
 */
import type { Page } from "@playwright/test";

export interface WatchlistRow {
  id: string;
  identifier: string;
  type: string;
  display_name?: string | null;
}

async function readWatchlist(page: Page): Promise<WatchlistRow[]> {
  const res = await page.request.get("/api/watchlist");
  if (!res.ok()) throw new Error(`GET /api/watchlist answered ${res.status()}`);
  const body = (await res.json()) as { entries?: WatchlistRow[] };
  return body.entries ?? [];
}

async function removeWatchlistRow(page: Page, id: string): Promise<void> {
  const res = await page.request.delete("/api/watchlist", { data: { id } });
  if (!res.ok()) throw new Error(`DELETE /api/watchlist ${id} answered ${res.status()}`);
}

/** Add one entry. Returns its row so the caller can remove it. */
export async function addWatchlistRow(page: Page, identifier: string, type: "ticker" | "company" | "sector"): Promise<WatchlistRow | null> {
  const res = await page.request.post("/api/watchlist", { data: { identifier, type } });
  if (res.status() === 409) return null; // already there: not ours to remove
  if (!res.ok()) throw new Error(`POST /api/watchlist ${identifier} answered ${res.status()}`);
  const after = await readWatchlist(page);
  return after.find((r) => r.identifier.toUpperCase() === identifier.toUpperCase()) ?? null;
}

/** Remove an entry by identifier if present. Safe when absent. */
export async function removeWatchlistIdentifier(page: Page, identifier: string): Promise<void> {
  const rows = await readWatchlist(page);
  for (const r of rows) {
    if (r.identifier.toUpperCase() === identifier.toUpperCase()) await removeWatchlistRow(page, r.id);
  }
}

/**
 * Run `fn` with the account's watchlist empty, then put every row back.
 * The rows are re-added through the same POST the product uses, so they come
 * back with fresh ids; nothing else about them changes.
 */
export async function withEmptyWatchlist<T>(page: Page, fn: () => Promise<T>): Promise<T> {
  const before = await readWatchlist(page);
  for (const r of before) await removeWatchlistRow(page, r.id);
  try {
    return await fn();
  } finally {
    for (const r of before) {
      const type = (r.type as "ticker" | "company" | "sector") ?? "ticker";
      await page.request.post("/api/watchlist", { data: { identifier: r.identifier, type, display_name: r.display_name ?? undefined } });
    }
  }
}

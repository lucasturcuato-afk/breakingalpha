/**
 * Pass two: the POPULATED walk.
 *
 * No new credentials were needed. The account is populated by the write paths
 * in `20-writes.spec.ts` (a claim adopted from a desk call, a claim authored
 * through Compose) and by the two rows this file plants at the top (one follow,
 * one watchlist entry), all of them tagged so they are identifiable as harness
 * data. `40-cleanup.spec.ts` removes every one.
 *
 * Every finding from this file carries pass: "populated". Differencing it
 * against the empty pass is what separates "this screen is broken" from "this
 * screen has nothing to draw".
 */
import { test } from "@playwright/test";
import {
  ensureSignedIn,
  installGuards,
  launch,
  phoneContext,
  pgRead,
  warmGoto,
  AUTH_STATE,
  E2E_USER_ID,
  TEST_TAG,
} from "./lib/harness";
import { finding, note, writeLog } from "./lib/report";
import { runRules, auditGeometry, probeScreen } from "./lib/walk";
import { enumerateControls } from "./lib/probe";
import { BASE } from "./lib/harness";
import fs from "fs";
import path from "path";

/** Screens whose content is the reader's own record. These are the ones a
    populated account changes; the rest draw the same corpus either way. */
const RECORD_SCREENS = ["/ledger", "/watch", "/dashboard", "/record", "/review", "/compose"];

test("populated pass: plant one follow and one watchlist entry, then walk the record screens", async () => {
  const browser = await launch();
  const ctx = await phoneContext(browser, "light", AUTH_STATE);
  const guards = await installGuards(ctx);
  guards.blockMutations = false;
  const page = await ctx.newPage();
  await warmGoto(page, "/dashboard");
  await ensureSignedIn(page, AUTH_STATE);

  await warmGoto(page, "/watch");

  const planted: Array<{ table: string; id: string }> = [];

  const f = await page.evaluate(async () => {
    const r = await fetch("/api/radar/follows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ follow_type: "ticker", target: "NVDA", display_name: "NVDA (pressure-harness)" }),
    });
    return { status: r.status, body: await r.text() };
  });
  const followRows = (await pgRead(
    `follows?user_id=eq.${E2E_USER_ID}&select=id,target,display_name`,
  )) as Array<Record<string, unknown>>;
  const fr = followRows.find((r) => String(r.display_name ?? "").includes("pressure-harness"));
  if (fr) {
    planted.push({ table: "follows", id: String(fr.id) });
    writeLog({
      at: new Date().toISOString(),
      table: "follows",
      action: "INSERT via POST /api/radar/follows (to populate the Radar screen)",
      detail: `follow_type=ticker target=NVDA display_name="${fr.display_name}"`,
      rowId: String(fr.id),
      reversed: false,
    });
  } else {
    finding({
      severity: "high",
      rule: "populate-follow-failed",
      screen: "/api/radar/follows",
      pass: "populated",
      title: "could not plant a follow, so the following tier stays empty for this pass",
      evidence: `status ${f.status} body ${f.body.slice(0, 200)}`,
      basis: "measured",
    });
  }

  const w = await page.evaluate(async () => {
    const r = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "NVDA", type: "ticker", display_name: "Nvidia (pressure-harness)" }),
    });
    return { status: r.status, body: await r.text() };
  });
  const wlRows = (await pgRead(
    `watchlist?user_id=eq.${E2E_USER_ID}&select=id,identifier,display_name`,
  )) as Array<Record<string, unknown>>;
  const wr = wlRows.find((r) => String(r.display_name ?? "").includes("pressure-harness"));
  if (wr) {
    planted.push({ table: "watchlist", id: String(wr.id) });
    writeLog({
      at: new Date().toISOString(),
      table: "watchlist",
      action: "INSERT via POST /api/watchlist (to populate the Radar screen)",
      detail: `identifier=NVDA type=ticker display_name="${wr.display_name}"`,
      rowId: String(wr.id),
      reversed: false,
    });
  } else {
    finding({
      severity: "high",
      rule: "populate-watchlist-failed",
      screen: "/api/watchlist",
      pass: "populated",
      title: "could not plant a watchlist entry, so the watchlist tier stays empty for this pass",
      evidence: `status ${w.status} body ${w.body.slice(0, 200)}`,
      basis: "measured",
    });
  }

  fs.writeFileSync(
    path.resolve(__dirname, "../../pressure-report/planted.json"),
    JSON.stringify(planted, null, 2),
  );

  const claims = (await pgRead(
    `user_claims?user_id=eq.${E2E_USER_ID}&select=id,user_claim,status,gradeable,commit_note&order=created_at.desc`,
  )) as Array<Record<string, unknown>>;
  note(
    "populated-state",
    "(account)",
    `user_claims ${claims.length} rows, ${claims.filter((c) => String(c.commit_note ?? "").includes(TEST_TAG)).length} written by this harness; follows and watchlist each carry one tagged row`,
    "measured",
  );

  /* The walk, over the screens the reader's own record feeds. Full control
     probing again: a screen with rows on it has controls a screen with none
     does not, and those controls have never been tapped by the empty pass. */
  guards.blockMutations = true; // probing must not write
  for (const route of RECORD_SCREENS) {
    const status = await warmGoto(page, route);
    if (status && status >= 400) continue;
    await probeScreen(page, route, BASE, "light", "populated");
  }

  note(
    "populated-write-attempts",
    "(walk)",
    `controls that attempted a mutation during the populated probe: ${JSON.stringify(Array.from(new Set(guards.blockedMutations)))}`,
    "measured",
  );

  await ctx.close();
  await browser.close();
});

test("populated pass: the same screens in dark, rules and geometry", async () => {
  const browser = await launch();
  const ctx = await phoneContext(browser, "dark", AUTH_STATE);
  await installGuards(ctx);
  const page = await ctx.newPage();
  await warmGoto(page, "/dashboard");
  await ensureSignedIn(page);
  for (const route of RECORD_SCREENS) {
    const status = await warmGoto(page, route);
    if (status && status >= 400) continue;
    await runRules(page, route, "dark", "populated");
    auditGeometry(await enumerateControls(page), route, "dark", "populated");
  }
  await ctx.close();
  await browser.close();
});

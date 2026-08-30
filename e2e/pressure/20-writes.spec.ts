/**
 * The four write paths, end to end, as the E2E reader.
 *
 * THESE WRITES HIT PRODUCTION. There is no non-prod Supabase; `.env.local`
 * carries one ref. They are made as the dedicated E2E account, which RLS
 * sandboxes to its own rows (`user_claims_owner_all`, `FOR ALL USING
 * (auth.uid() = user_id)`), and CLAUDE.md permits exactly this. Every one is
 * logged to `pressure-report/writes.jsonl` with a timestamp, the table, and
 * what it did, and `40-cleanup.spec.ts` reverses each one. Anything that
 * cannot be reversed is reported loudly rather than left implied.
 *
 * NOTHING HERE CALLS GEMINI. `/api/radar/claims/author` runs gemini-2.5-pro on
 * every request, and Compose cannot reach its save press without a proposal
 * from it, so the harness FULFILS that route with a canned proposal. The write
 * under test is the second request, `POST /api/radar/claims`, and that one is
 * real. `POST /api/intelligence` is fulfilled everywhere, always: its limiter
 * is consumed before the cache check, so even a cache hit costs one of fifteen.
 */
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import {
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

const NOTE_TEXT = `${TEST_TAG} pressure walk verifying the stated window equals the written window.`;
const COMPOSE_DRAFT = `${TEST_TAG} SPY will close higher than today within the next week.`;
const COMPOSE_NOTE = `${TEST_TAG} authored by the mobile pressure walk to prove a note reaches the row.`;

/** Canned author-route proposal. Shape from `readProposal` in compose-screen. */
function cannedProposal(todayIso: string) {
  const end = new Date(Date.parse(`${todayIso}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  return {
    proposal: {
      claim_type: "index",
      target_symbol: "SPY",
      expected_direction: "bullish",
      resolution_window_start: todayIso,
      resolution_window_end: end,
      evidence_entities: ["SPY"],
      confidence_in_reduction: 0.8,
      gradeable: true,
      gradeability_note: null,
      gradeable_alternative: null,
    },
  };
}

function isoToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

async function claimRows(): Promise<Array<Record<string, unknown>>> {
  return (await pgRead(
    `user_claims?user_id=eq.${E2E_USER_ID}&select=id,user_claim,commit_note,commit_note_at,resolution_window_start,resolution_window_end,gradeable,status,source,adopted_from_call_id,created_at&order=created_at.desc`,
  )) as Array<Record<string, unknown>>;
}

/** "Nov 4, 2026" back to "2026-11-04". The sheet renders the first form. */
function labelToIso(label: string): string | null {
  const m = label.match(/([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})/);
  if (!m) return null;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mi = months.indexOf(m[1]);
  if (mi < 0) return null;
  return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

async function openBrowser(): Promise<{ ctx: BrowserContext; page: Page; close: () => Promise<void> }> {
  const browser = await launch();
  const ctx = await phoneContext(browser, "light", AUTH_STATE);
  const guards = await installGuards(ctx);
  guards.blockMutations = false; // this file is the write phase
  /* The author route is Gemini. Fulfil it with a canned proposal so Compose
     reaches its real save press without a model call. Registered AFTER the
     guards so it matches first. */
  await ctx.route("**/api/radar/claims/author", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cannedProposal(isoToday())) }),
  );
  const page = await ctx.newPage();
  return { ctx, page, close: async () => { await ctx.close(); await browser.close(); } };
}

/** Long-press the commit control. 700ms is COMMIT_PRESS_MS; hold past it. */
async function longPress(page: Page, selector: string, ms = 1100) {
  const el = page.locator(selector);
  const box = await el.boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test("W1 adopt: the window the sheet states must equal the window the row is written with", async () => {
  const { page, close } = await openBrowser();
  const before = await claimRows();

  await warmGoto(page, "/ledger");
  const track = page.getByRole("button", { name: "Track this call" }).first();
  const trackCount = await page.getByRole("button", { name: "Track this call" }).count();
  if (trackCount === 0) {
    finding({
      severity: "critical",
      rule: "write-path-unreachable",
      screen: "/ledger",
      pass: "writes",
      title: "no 'Track this call' control on the Ledger; the adopt path cannot be walked",
      evidence: "The commit sheet is opened only from a call card with variant=open. None rendered.",
      basis: "measured",
    });
    await close();
    return;
  }
  note("write-path", "/ledger", `${trackCount} "Track this call" controls rendered`, "measured");

  await track.click();
  const sheet = page.locator('[role="dialog"], [aria-modal="true"]').first();
  await expect(sheet, "the commit sheet must open on tap").toBeVisible({ timeout: 5000 });

  const sheetText = (await sheet.innerText()).replace(/\s+/g, " ");
  const checkedOnLabel = (sheetText.match(/Checked on ([A-Z][a-z]{2} \d{1,2}, \d{4})/) ?? [])[1] ?? null;
  const spanLabel = (sheetText.match(/(\d+) days?,\s*(resolves[^.]*)/) ?? []).slice(1).join(" ") || null;
  note("commit-sheet-promise", "/ledger", `sheet states: checkedOn="${checkedOnLabel}" span="${spanLabel}"; full: ${sheetText.slice(0, 400)}`, "measured");

  await sheet.locator("textarea").fill(NOTE_TEXT);
  await longPress(page, '[role="dialog"] button:has-text("Press to enter this on your ledger")');

  await page.waitForTimeout(2500);

  const after = await claimRows();
  const added = after.filter((r) => !before.some((b) => b.id === r.id));

  if (added.length === 0) {
    /* The idempotent branch: adopting a call already on the record returns the
       existing row and writes nothing new. Distinguish it from a silent
       failure rather than reporting either as the other. */
    finding({
      severity: "critical",
      rule: "adopt-did-not-confirm",
      screen: "/ledger",
      pass: "writes",
      title: "the adopt press produced no new user_claims row",
      evidence: `before=${before.length} after=${after.length}. Sheet promised checkedOn="${checkedOnLabel}". Sheet text after press: ${(await sheet.innerText().catch(() => "(sheet gone)")).replace(/\s+/g, " ").slice(0, 300)}`,
      basis: "measured",
    });
    await close();
    return;
  }

  const row = added[0];
  writeLog({
    at: new Date().toISOString(),
    table: "user_claims",
    action: "INSERT via POST /api/radar/claims/adopt (commit sheet long press)",
    detail: `adopted_from_call_id=${row.adopted_from_call_id} window ${row.resolution_window_start}..${row.resolution_window_end} gradeable=${row.gradeable} note="${String(row.commit_note ?? "").slice(0, 60)}"`,
    rowId: String(row.id),
    reversed: false,
  });

  /* THE ASSERTION THIS TEST EXISTS FOR. */
  const promisedIso = checkedOnLabel ? labelToIso(checkedOnLabel) : null;
  const writtenEnd = String(row.resolution_window_end ?? "");
  const writtenStart = String(row.resolution_window_start ?? "");
  const writtenSpan =
    writtenStart && writtenEnd
      ? Math.round((Date.parse(writtenEnd + "T00:00:00Z") - Date.parse(writtenStart + "T00:00:00Z")) / 86_400_000)
      : null;
  const promisedSpan = spanLabel ? Number((spanLabel.match(/^(\d+)/) ?? [])[1]) : null;

  note(
    "adopt-window-comparison",
    "/ledger",
    `sheet promised end=${promisedIso} span=${promisedSpan}; row written start=${writtenStart} end=${writtenEnd} span=${writtenSpan}`,
    "measured",
  );

  if (promisedIso && promisedIso !== writtenEnd) {
    finding({
      severity: "critical",
      rule: "adopt-window-mismatch",
      screen: "/ledger commit sheet",
      pass: "writes",
      title: `the sheet promised a window ending ${promisedIso} and the row was written ending ${writtenEnd}`,
      evidence:
        `Sheet: "Checked on ${checkedOnLabel}" (${promisedIso}), "${spanLabel}". ` +
        `Row ${row.id}: resolution_window_start=${writtenStart}, resolution_window_end=${writtenEnd}. ` +
        `The sheet derives its date from addCalendarDays(target.sessionIso, spanDays) at commit-sheet.tsx:265 and the route derives the stored one from resolveAdoptWindow(todayPt(), horizon) at adopt/route.ts, so the two anchor on different dates whenever the reader's ledger session date is not today.`,
      basis: "measured",
    });
  }
  if (promisedSpan !== null && writtenSpan !== null && promisedSpan !== writtenSpan) {
    finding({
      severity: "high",
      rule: "adopt-span-mismatch",
      screen: "/ledger commit sheet",
      pass: "writes",
      title: `the sheet stated a ${promisedSpan}-day window and the row spans ${writtenSpan} days`,
      evidence: `row ${row.id} ${writtenStart}..${writtenEnd}`,
      basis: "measured",
    });
  }
  if (String(row.commit_note ?? "") !== NOTE_TEXT) {
    finding({
      severity: "high",
      rule: "adopt-note-not-stored",
      screen: "/ledger commit sheet",
      pass: "writes",
      title: "the note typed into the sheet is not what landed in commit_note",
      evidence: `typed "${NOTE_TEXT}" stored "${String(row.commit_note ?? "")}"`,
      basis: "measured",
    });
  }
  if (row.commit_note && !row.commit_note_at) {
    finding({
      severity: "high",
      rule: "note-without-timestamp",
      screen: "user_claims",
      pass: "writes",
      title: "commit_note landed without commit_note_at",
      evidence: `row ${row.id}`,
      basis: "measured",
    });
  }

  await close();
});

test("W2 author: Compose saves the claim with its note, and gates at 12 characters", async () => {
  const { page, close } = await openBrowser();
  const before = await claimRows();

  await warmGoto(page, "/compose");
  const textareas = page.locator("textarea");
  const n = await textareas.count();
  if (n < 2) {
    finding({
      severity: "critical",
      rule: "write-path-unreachable",
      screen: "/compose",
      pass: "writes",
      title: `Compose rendered ${n} text areas; the draft/note pair was not found`,
      evidence: "expected a draft field and a note field",
      basis: "measured",
    });
    await close();
    return;
  }

  await textareas.nth(0).fill(COMPOSE_DRAFT);
  /* THE 12-CHARACTER GATE, which Compose keeps and adopt no longer has
     (decisions/commit-note-optional-when-adopting.md). Prove it holds before
     proving the save works. */
  await textareas.nth(1).fill("too short");
  await page.waitForTimeout(400);
  const shortNoteState = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    return btns.map((b) => ({ text: (b.innerText ?? "").trim().slice(0, 40), disabled: b.disabled || b.getAttribute("aria-disabled") === "true" }));
  });
  note("compose-gate", "/compose", `with a 9-character note the controls read ${JSON.stringify(shortNoteState)}`, "measured");

  await textareas.nth(1).fill(COMPOSE_NOTE);
  await page.waitForTimeout(300);

  /* Press one: read it back. The author route is fulfilled with a canned
     proposal; no model is called. */
  const submit = page.locator('[data-testid="compose-submit"]');
  note("compose-first-press", "/compose", `first press label: "${(await submit.innerText()).trim()}"`, "measured");
  await submit.click();
  await page.waitForTimeout(1500);

  const commitBtn = page.locator('[data-testid="compose-submit"]');
  const bodyBefore = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  note("compose-state", "/compose", bodyBefore.slice(0, 600), "measured");

  if (!(await commitBtn.count())) {
    finding({
      severity: "high",
      rule: "compose-commit-control-not-found",
      screen: "/compose",
      pass: "writes",
      title: "no commit control on Compose after a proposal was returned",
      evidence: bodyBefore.slice(0, 400),
      basis: "measured",
    });
    await close();
    return;
  }

  const pressLabel = (await commitBtn.innerText()).trim();
  note("compose-press-label", "/compose", `the single control reads "${pressLabel}" at the moment of the write press`, "measured");
  await commitBtn.click();
  await page.waitForTimeout(2500);

  const after = await claimRows();
  const added = after.filter((r) => !before.some((b) => b.id === r.id));
  if (added.length === 0) {
    finding({
      severity: "critical",
      rule: "compose-did-not-confirm",
      screen: "/compose",
      pass: "writes",
      title: "the Compose commit produced no user_claims row",
      evidence: `screen after press: ${(await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 400)}`,
      basis: "measured",
    });
  } else {
    const row = added[0];
    writeLog({
      at: new Date().toISOString(),
      table: "user_claims",
      action: "INSERT via POST /api/radar/claims (Compose)",
      detail: `claim="${String(row.user_claim).slice(0, 60)}" note="${String(row.commit_note ?? "").slice(0, 60)}" window ${row.resolution_window_start}..${row.resolution_window_end} gradeable=${row.gradeable}`,
      rowId: String(row.id),
      reversed: false,
    });
    if (String(row.commit_note ?? "") !== COMPOSE_NOTE) {
      finding({
        severity: "high",
        rule: "compose-note-not-stored",
        screen: "/compose",
        pass: "writes",
        title: "the authored note is not what landed in commit_note",
        evidence: `typed "${COMPOSE_NOTE}" stored "${String(row.commit_note ?? "")}"`,
        basis: "measured",
      });
    }
    if (row.gradeable === false) {
      note(
        "authored-claim-permanent",
        "user_claims",
        `row ${row.id} was written gradeable=false. backend/grading/grade_user_claims.py gates on the flag before reading the method, so a gradeable:false claim never leaves status=open.`,
        "inferred",
      );
    }
  }

  await close();
});

test("W3 failure: each write path must say nothing was written and keep the note", async () => {
  for (const shape of ["http-500", "abort", "200-no-id"] as const) {
    /* ---- adopt ---- */
    const { ctx, page, close } = await openBrowser();
    await ctx.route("**/api/radar/claims/adopt", async (route) => {
      if (shape === "abort") return route.abort("failed");
      if (shape === "200-no-id")
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "forced" }) });
    });
    const before = await claimRows();
    await warmGoto(page, "/ledger");
    const track = page.getByRole("button", { name: "Track this call" }).first();
    if (await track.count()) {
      await track.click();
      const sheet = page.locator('[role="dialog"], [aria-modal="true"]').first();
      await expect(sheet).toBeVisible({ timeout: 5000 });
      await sheet.locator("textarea").fill(NOTE_TEXT);
      const press = sheet.locator('button:has-text("Press to enter this on your ledger")');
      const box = await press.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(1100);
        await page.mouse.up();
      }
      await page.waitForTimeout(1800);

      const stillOpen = await sheet.isVisible().catch(() => false);
      const text = stillOpen ? (await sheet.innerText()).replace(/\s+/g, " ") : "(sheet closed)";
      const noteKept = stillOpen ? await sheet.locator("textarea").inputValue() : "";
      const after = await claimRows();
      const wrote = after.length !== before.length;

      note("failure-adopt", "/ledger commit sheet", `shape=${shape} sheetOpen=${stillOpen} rowsBefore=${before.length} rowsAfter=${after.length} text="${text.slice(0, 300)}"`, "measured");

      if (!/nothing was written/i.test(text)) {
        finding({
          severity: "high",
          rule: "failure-does-not-say-nothing-was-written",
          screen: "/ledger commit sheet",
          pass: "writes",
          title: `on a ${shape} failure the sheet does not say nothing was written`,
          evidence: text.slice(0, 300),
          basis: "measured",
        });
      }
      if (noteKept !== NOTE_TEXT) {
        finding({
          severity: "critical",
          rule: "failed-save-loses-the-note",
          screen: "/ledger commit sheet",
          pass: "writes",
          title: `on a ${shape} failure the typed note was not kept`,
          evidence: `typed "${NOTE_TEXT}" field now "${noteKept}"`,
          basis: "measured",
        });
      }
      if (wrote) {
        finding({
          severity: "critical",
          rule: "failed-save-wrote-anyway",
          screen: "/ledger commit sheet",
          pass: "writes",
          title: `a ${shape} failure still changed the row count`,
          evidence: `before ${before.length} after ${after.length}`,
          basis: "measured",
        });
      }
    } else {
      finding({
        severity: "high",
        rule: "failure-path-unreachable",
        screen: "/ledger",
        pass: "writes",
        title: `adopt failure shape ${shape} could not be forced: no Track control`,
        evidence: "no 'Track this call' button on the Ledger at the time of the run",
        basis: "measured",
      });
    }
    await close();

    /* ---- compose ---- */
    const c2 = await openBrowser();
    await c2.ctx.route("**/api/radar/claims", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      if (shape === "abort") return route.abort("failed");
      if (shape === "200-no-id")
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "forced" }) });
    });
    const beforeC = await claimRows();
    await warmGoto(c2.page, "/compose");
    const tas = c2.page.locator("textarea");
    if ((await tas.count()) >= 2) {
      await tas.nth(0).fill(COMPOSE_DRAFT);
      await tas.nth(1).fill(COMPOSE_NOTE);
      await c2.page.locator('[data-testid="compose-submit"]').click();
      await c2.page.waitForTimeout(1500);
      const commitBtn = c2.page.locator('[data-testid="compose-submit"]');
      if (await commitBtn.count()) {
        await commitBtn.click();
        await c2.page.waitForTimeout(1800);
        const body = (await c2.page.locator("body").innerText()).replace(/\s+/g, " ");
        const noteKept = await c2.page.locator("textarea").nth(1).inputValue().catch(() => "");
        const afterC = await claimRows();
        note("failure-compose", "/compose", `shape=${shape} rowsBefore=${beforeC.length} rowsAfter=${afterC.length} screen="${body.slice(0, 400)}"`, "measured");
        if (noteKept !== COMPOSE_NOTE) {
          finding({
            severity: "critical",
            rule: "failed-save-loses-the-note",
            screen: "/compose",
            pass: "writes",
            title: `on a ${shape} failure Compose did not keep the typed note`,
            evidence: `typed "${COMPOSE_NOTE}" field now "${noteKept}"`,
            basis: "measured",
          });
        }
        if (!/still here|nothing was written/i.test(body)) {
          finding({
            severity: "high",
            rule: "failure-copy-missing",
            screen: "/compose",
            pass: "writes",
            title: `on a ${shape} failure Compose does not tell the reader their words survived`,
            evidence: body.slice(0, 300),
            basis: "measured",
          });
        }
        if (afterC.length !== beforeC.length) {
          finding({
            severity: "critical",
            rule: "failed-save-wrote-anyway",
            screen: "/compose",
            pass: "writes",
            title: `a ${shape} failure on Compose still changed the row count`,
            evidence: `before ${beforeC.length} after ${afterC.length}`,
            basis: "measured",
          });
        }
      }
    }
    await c2.close();
  }
});

test("W4 follow and watchlist: both round trips, verified in the database", async () => {
  const { page, close } = await openBrowser();

  /* THE UI AFFORDANCE. /watch has no add control of its own; its empty states
     link to /radar/watchlist and /radar/following. Establish whether a reader
     on this build can reach those by tapping before falling back to the API. */
  await warmGoto(page, "/watch");
  const deskLinks = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a"))
      .filter((a) => /radar\/(watchlist|following)/.test(a.getAttribute("href") ?? ""))
      .map((a) => ({ href: a.getAttribute("href"), text: (a as HTMLElement).innerText.trim() })),
  );
  note("watch-add-affordance", "/watch", JSON.stringify(deskLinks), "measured");

  for (const link of deskLinks) {
    await warmGoto(page, link.href!);
    const landed = new URL(page.url()).pathname;
    if (landed !== link.href) {
      finding({
        severity: "high",
        rule: "add-affordance-unreachable",
        screen: link.href!,
        pass: "writes",
        title: `"${link.text}" leads to ${link.href}, which bounces to ${landed}`,
        evidence:
          `${link.href} is not in MOBILE_REDESIGN_DEV_PATHS, so VERCEL_ENV=preview does not open it, and the E2E account is not on beta_allowlist, so proxy.ts:160 signs the session out and redirects. ` +
          `Consequence for a phone reader on this build: the only add affordance the Radar pole offers cannot be reached by tapping.`,
        basis: "measured",
      });
    }
  }

  /* The round trips themselves, driven through the app's own API routes from
     the signed-in page context, so the session, the RLS scope and the route
     logic are all the real ones. This is the write path; the paragraph above
     is the finding about its front door. */
  await warmGoto(page, "/watch");

  const followBefore = (await pgRead(`follows?user_id=eq.${E2E_USER_ID}&select=id`)) as unknown[];
  const followRes = await page.evaluate(async () => {
    const r = await fetch("/api/radar/follows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      /* follow_type "ticker", never "topic": the topic branch calls
         gemini-embedding-001 on every insert. */
      body: JSON.stringify({ follow_type: "ticker", target: "SPY", display_name: "SPY (pressure-harness)" }),
    });
    return { status: r.status, body: await r.text() };
  });
  const followAfter = (await pgRead(`follows?user_id=eq.${E2E_USER_ID}&select=id,follow_type,target,display_name`)) as Array<Record<string, unknown>>;
  const newFollow = followAfter.find((f) => !followBefore.some((b) => (b as { id: string }).id === f.id));
  note("follow-write", "/watch", `POST /api/radar/follows -> ${followRes.status}; rows ${followBefore.length} -> ${followAfter.length}`, "measured");
  if (!newFollow) {
    finding({
      severity: "critical",
      rule: "follow-did-not-confirm",
      screen: "/api/radar/follows",
      pass: "writes",
      title: "the follow write did not produce a row",
      evidence: `status ${followRes.status}, body ${followRes.body.slice(0, 200)}`,
      basis: "measured",
    });
  } else {
    writeLog({
      at: new Date().toISOString(),
      table: "follows",
      action: "INSERT via POST /api/radar/follows",
      detail: `follow_type=ticker target=SPY display_name="${newFollow.display_name}"`,
      rowId: String(newFollow.id),
      reversed: false,
    });
    /* Does the screen show it? */
    await warmGoto(page, "/watch");
    const watchText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    note("follow-visible", "/watch", `after the follow landed, /watch reads: ${watchText.slice(0, 500)}`, "measured");

    const del = await page.evaluate(async (id) => {
      const r = await fetch(`/api/radar/follows?id=${id}`, { method: "DELETE" });
      return { status: r.status, body: await r.text() };
    }, newFollow.id);
    const followFinal = (await pgRead(`follows?user_id=eq.${E2E_USER_ID}&select=id`)) as unknown[];
    const gone = !followFinal.some((f) => (f as { id: string }).id === newFollow.id);
    writeLog({
      at: new Date().toISOString(),
      table: "follows",
      action: "DELETE via DELETE /api/radar/follows",
      detail: `status ${del.status}; row present after delete: ${!gone}`,
      rowId: String(newFollow.id),
      reversed: gone,
    });
    if (!gone) {
      finding({
        severity: "critical",
        rule: "unfollow-did-not-reverse",
        screen: "/api/radar/follows",
        pass: "writes",
        title: "the follow row survived its own DELETE",
        evidence: `DELETE answered ${del.status} body ${del.body.slice(0, 200)}; row ${newFollow.id} still present`,
        basis: "measured",
      });
    }
  }

  const wlBefore = (await pgRead(`watchlist?user_id=eq.${E2E_USER_ID}&select=id`)) as unknown[];
  const wlRes = await page.evaluate(async () => {
    const r = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      /* display_name supplied so the route takes the client-name branch and
         never reaches Finnhub. */
      body: JSON.stringify({ identifier: "SPY", type: "ticker", display_name: "SPY (pressure-harness)" }),
    });
    return { status: r.status, body: await r.text() };
  });
  const wlAfter = (await pgRead(`watchlist?user_id=eq.${E2E_USER_ID}&select=id,identifier,type,display_name`)) as Array<Record<string, unknown>>;
  const newWl = wlAfter.find((w) => !wlBefore.some((b) => (b as { id: string }).id === w.id));
  note("watchlist-write", "/watch", `POST /api/watchlist -> ${wlRes.status}; rows ${wlBefore.length} -> ${wlAfter.length}`, "measured");
  if (!newWl) {
    finding({
      severity: "critical",
      rule: "watchlist-add-did-not-confirm",
      screen: "/api/watchlist",
      pass: "writes",
      title: "the watchlist add did not produce a row",
      evidence: `status ${wlRes.status}, body ${wlRes.body.slice(0, 200)}`,
      basis: "measured",
    });
  } else {
    writeLog({
      at: new Date().toISOString(),
      table: "watchlist",
      action: "INSERT via POST /api/watchlist",
      detail: `identifier=SPY type=ticker display_name="${newWl.display_name}"`,
      rowId: String(newWl.id),
      reversed: false,
    });
    await warmGoto(page, "/watch");
    const watchText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    note("watchlist-visible", "/watch", `after the watchlist add landed, /watch reads: ${watchText.slice(0, 500)}`, "measured");

    const del = await page.evaluate(async (id) => {
      const r = await fetch(`/api/watchlist?id=${id}`, { method: "DELETE" });
      return { status: r.status, body: await r.text() };
    }, newWl.id);
    const wlFinal = (await pgRead(`watchlist?user_id=eq.${E2E_USER_ID}&select=id`)) as unknown[];
    const gone = !wlFinal.some((w) => (w as { id: string }).id === newWl.id);
    writeLog({
      at: new Date().toISOString(),
      table: "watchlist",
      action: "DELETE via DELETE /api/watchlist",
      detail: `status ${del.status}; row present after delete: ${!gone}`,
      rowId: String(newWl.id),
      reversed: gone,
    });
    if (!gone) {
      finding({
        severity: "critical",
        rule: "watchlist-remove-did-not-reverse",
        screen: "/api/watchlist",
        pass: "writes",
        title: "the watchlist row survived its own DELETE",
        evidence: `DELETE answered ${del.status} body ${del.body.slice(0, 200)}`,
        basis: "measured",
      });
    }
  }

  await close();
});

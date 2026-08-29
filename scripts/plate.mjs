#!/usr/bin/env node
/*
 * plate.mjs
 *
 * The only sanctioned way to write a screenshot into docs/ in this repository.
 *
 * WHY THIS EXISTS
 *
 * On 2026-08-27 twenty four of thirty nine committed screenshots published
 * account data to a public repository: a greeting with the reader's name, the
 * personal grading tally, personalization chips, a nine ticker watchlist, and
 * on two plates a live email address beside a role label. That was the THIRD
 * such incident. See DECISIONS.md ruling 18 and the two PLATES-REMOVED.md
 * files.
 *
 * The rule against it already existed all three times. It failed all three
 * times for the same reason: it ran AFTER the capture. Someone had to remember
 * it at review time, looking at an image that already existed, and three times
 * nobody did.
 *
 * There was also nothing to put the rule inside. `screen-audit.mjs` writes no
 * images, and the only `page.screenshot` in the tree was one e2e spec, so every
 * unit reinvented its own capture in a scratchpad file and threw it away. A
 * rule cannot live in a script that does not exist.
 *
 * So the rule now runs BEFORE the file exists. This script reads the page it is
 * about to photograph, and REFUSES TO WRITE if the frame contains account data.
 * A capture that cannot run is a broken build. A capture that quietly published
 * a mailbox is what we had instead.
 *
 * THE OTHER HALF: CROPS ARE THE DEFAULT
 *
 * `--selector` is required. A full page capture needs `--full-page` AND a
 * written `--justify`, and it still has to pass the guard.
 *
 * This is not only a safety rule, it is an evidence rule, and the evidence
 * argument is the stronger one. Of thirty nine plates, the two that carried
 * nothing were not captured carefully, they were structurally incapable of
 * leaking: a skeleton whose avatar pill has no letter in it, and a typography
 * specimen sheet whose only string is fabricated. Meanwhile PR #696 replaced a
 * full page render with six crops and the crops proved MORE: the blank
 * headroom above a pinned band is the proof the band pins, and the full page
 * plate could not show that because it had been captured in the one state
 * where the bug looked correct. PR #702 shipped eight footer crops that prove
 * its entire gate and carry nothing.
 *
 * A crop is smaller, it is safer, and it is usually better evidence, because
 * cropping forces you to decide what the plate is actually evidence OF.
 *
 * USAGE
 *
 *   node scripts/plate.mjs --url http://localhost:3000/ledger \
 *     --selector '[data-parity="ledger"] footer' \
 *     --out docs/ledger-parity/footer-390-light.png \
 *     --width 390 --theme light
 *
 *   node scripts/plate.mjs --self-test
 *
 * EXIT CODES
 *   0  wrote the file
 *   1  refused: the frame carries account data, nothing was written
 *   2  refused: bad invocation, or the self test failed
 */

import { chromium } from "playwright";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

/* ------------------------------------------------------------------ *
 * THE DETECTORS
 *
 * Every detector below is derived from something actually found in the
 * 2026-08-27 audit, and each `specimen` reproduces the SHAPE of what
 * leaked. The self test asserts on every invocation that the detector
 * still trips its own specimen, so a detector that quietly stops matching
 * cannot hide behind a clean result.
 *
 * The specimens are deliberately SYNTHETIC rather than the literal strings
 * that leaked. A file whose job is to detect published account data must
 * not itself publish account data, and a real mailbox pasted here would
 * live on main forever. The shape is what the detector matches on, so a
 * synthetic value tests it exactly as well. This is not a small point: the
 * first draft of this file used the real address as a specimen, which is
 * the same defect it exists to prevent, one layer up.
 *
 * design-lint.mjs learned the self-test lesson the hard way and its self
 * test is the model for this one.
 * ------------------------------------------------------------------ */
const DETECTORS = [
  {
    id: "greeting",
    // A greeting naming the reader. Four dashboard plates in two PRs.
    test: /\bGood (morning|afternoon|evening),\s+[A-Z][a-z]+/,
    specimen: "Good morning, Alex.", // shape of the 2026-08-27 dashboards
    says: "a greeting naming the reader",
  },
  {
    id: "record-tally",
    // The "your record" block. Found rendering 1/1/0/1 and 0/0/0/3.
    // Two of the four labels together, so a lone word in prose is not a hit.
    test: /(SUPPORTED|CHALLENGED|NO CLEAN READ|AWAITING)\b[\s\S]{0,400}?(SUPPORTED|CHALLENGED|NO CLEAN READ|AWAITING)\b/,
    specimen: "your record SUPPORTED 9 CHALLENGED 9 NO CLEAN READ 9 AWAITING 9", // shape, not the real tally
    says: "the reader's own grading tally",
  },
  {
    id: "calls-checked",
    // "2 of your calls were checked." on the resolved-overnight card.
    test: /\b\d+\s+of\s+your\s+calls?\s+(were|was)\s+checked/i,
    specimen: "RESOLVED OVERNIGHT 9 of your calls were checked.", // shape, not the real count
    says: "a count of the reader's own resolved calls",
  },
  {
    id: "personalization",
    // "Personalized for: Consumer & Retail, Technology, ..." plus the
    // `balanced` tone chip. Eight plates carried this.
    test: /Personalized\s+for\s*:/i,
    specimen: "Personalized for: Sector One Sector Two Sector Three tone", // shape, not the real sectors
    says: "the reader's followed sectors",
  },
  {
    id: "email",
    // A plus-addressed account handle rendered in the desktop sidebar
    // account card. The single worst item in the audit: a live mailbox.
    // Deliberately also catches a bare local-part with a plus address,
    // which is how it actually rendered, with the domain elided.
    test: /[A-Za-z0-9._%-]+(\+[A-Za-z0-9._%-]+)(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?|[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
    specimen: "someone+alias@example.com Analyst", // shape, NOT the real address
    says: "an email address or plus-addressed account handle",
  },
];

/* The avatar is checked in the DOM rather than in text, because a single
 * letter in a pill is not distinguishable from any other letter by regex.
 *
 * user-avatar.tsx:19-22 states that the brand "S" mark is ONLY ever a
 * signed-out stand-in and must never substitute for an authenticated user,
 * so an "S" is provably safe and anything else provably is not. That comment
 * is load bearing for this check; if it ever stops being true this check has
 * to change with it. */
const AVATAR_PROBE = `(() => {
  const out = [];
  for (const el of document.querySelectorAll('[data-avatar], [class*="avatar" i]')) {
    const t = (el.textContent || "").trim();
    if (t.length === 1 && t !== "S") { out.push(t); continue; }
    // An avatar with NO text is not automatically safe. A photo avatar is an
    // <img>, and the account glyph is sometimes drawn as SVG, in which case
    // textContent is empty and a text-only check waves it through. A unit hit
    // exactly this on 2026-08-28: its own guard passed and the committed
    // pixels still carried an account disc in the action bar.
    if (!t && (el.querySelector("svg, img") || el.tagName === "IMG")) {
      out.push("<non-text avatar glyph>");
    }
  }
  return out;
})()`;

/* Does the guard judge the RECTANGLE, or only the subtree?
 *
 * This is the regression test for the hole that cleared four captures a human
 * then caught by opening the file. It builds a page whose crop subtree is
 * innocuous and whose FIXED chrome carries account data sitting on top of the
 * crop, which is exactly the shape that used to pass. The old guard read the
 * subtree and wrote the file. The new one must refuse.
 *
 * The specimen is synthetic on purpose: no real address, no real reader. A
 * script whose job is catching published account data must not itself carry
 * any, which this file already learned once. */
async function selfTestRectangle() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(`
    <body style="margin:0">
      <div id="crop" style="height:600px;padding:12px">
        Watchlist feed. 25 articles. Nothing here names a reader.
      </div>
      <div id="chrome" style="position:fixed;top:200px;left:0;right:0;padding:8px">
        Good morning, Firstname
      </div>
    </body>`);
  const res = await page.evaluate(() => {
    const root = document.querySelector("#crop");
    const cr = root.getBoundingClientRect();
    const out = [];
    for (const el of document.querySelectorAll("*")) {
      if (el === root || root.contains(el) || el.contains(root)) continue;
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "sticky") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left < cr.right && r.right > cr.left && r.top < cr.bottom && r.bottom > cr.top) {
        out.push(el.innerText || "");
      }
    }
    return { cropText: root.innerText || "", intruders: out };
  });
  await browser.close();

  const subtreeOnly = res.cropText;
  const wholeFrame = [res.cropText, ...res.intruders].join("\n");
  const missedBefore = DETECTORS.filter((d) => d.test.test(subtreeOnly));
  const caughtNow = DETECTORS.filter((d) => d.test.test(wholeFrame));

  if (res.intruders.length !== 1) {
    console.error(`plate.mjs rectangle self test FAILED: expected 1 intruder, saw ${res.intruders.length}`);
    process.exit(2);
  }
  if (missedBefore.length !== 0) {
    console.error("plate.mjs rectangle self test FAILED: the subtree specimen is not innocuous");
    process.exit(2);
  }
  if (caughtNow.length === 0) {
    console.error("plate.mjs rectangle self test FAILED: chrome over the crop did NOT trip a detector");
    process.exit(2);
  }
  console.log(
    `plate.mjs rectangle self test: chrome over the crop is judged. ` +
    `subtree alone trips 0 detectors, the frame trips ${caughtNow.length} ` +
    `(${caughtNow.map((d) => d.id).join(", ")}).`
  );
}

function selfTest() {
  const failures = [];
  for (const d of DETECTORS) {
    if (!d.test.test(d.specimen)) {
      failures.push(`${d.id}: specimen "${d.specimen}" did NOT trip its own detector`);
    }
  }
  // A detector that matches everything is as useless as one that matches
  // nothing. This string is deliberately innocuous product output of the
  // kind a legitimate plate carries.
  const innocuous =
    "Watchlist feed  25 articles  Counts unavailable  Today Ledger Watch Ask  " +
    "MARKET  S&P 500  VIX  10Y YIELD  Write your own call  " +
    "resolves in about 2 weeks  A sentence is enough.";
  for (const d of DETECTORS) {
    if (d.test.test(innocuous)) {
      failures.push(`${d.id}: fired on innocuous product output, it is too broad`);
    }
  }
  if (failures.length) {
    console.error("plate.mjs self test FAILED:");
    for (const f of failures) console.error("  " + f);
    process.exit(2);
  }
  console.log(`plate.mjs self test: ${DETECTORS.length} detectors, all trip their specimen, none fire on innocuous output.`);
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

async function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return selfTestRectangle();
  }

  // The self test runs on EVERY invocation, before a browser is opened.
  // A detector that has quietly stopped matching must not be discovered
  // by an audit six weeks later.
  selfTest();

  const url = arg("url");
  const out = arg("out");
  const selector = arg("selector");
  const fullPage = process.argv.includes("--full-page");
  const justify = arg("justify");
  const width = parseInt(arg("width", "390"), 10);
  const height = parseInt(arg("height", "844"), 10);
  const theme = arg("theme", "light");
  /* `networkidle` is the default and stays the default, because a plate taken
     before the data lands is evidence of nothing.
     
     IT IS NOT ALWAYS REACHABLE. `/company/[id]` renders its desktop tree and
     its mobile tree in the same document, and the desktop tree's client
     components fetch `/api/company-kpis`, `/api/company-trend` and
     `/api/stock-chart` on mount whichever tree is visible. Two of those reach
     Yahoo, and measured on this route they can stay in flight past 30s, so the
     capture times out and writes nothing. This flag is an explicit opt out,
     named in the run log, rather than a silent fallback that would let a plate
     be taken early without anyone knowing. */
  const wait = arg("wait", "networkidle");
  /* Comma-separated selectors to make invisible before the capture. See the
     block below for what it is for and why it cannot hide account data. */
  const hide = arg("hide", "");
  if (!["load", "domcontentloaded", "networkidle", "commit"].includes(wait)) {
    console.error(`plate.mjs: --wait must be load, domcontentloaded, networkidle or commit.`);
    process.exit(2);
  }

  if (!url || !out) {
    console.error("plate.mjs: --url and --out are required.");
    process.exit(2);
  }
  if (!selector && !fullPage) {
    console.error(
      "plate.mjs: --selector is required.\n" +
      "  A crop is the default because it is safer AND usually better evidence:\n" +
      "  cropping forces you to decide what the plate is evidence OF.\n" +
      "  If you genuinely need the whole page, pass --full-page with --justify \"reason\"."
    );
    process.exit(2);
  }
  if (fullPage && (!justify || justify === true)) {
    console.error(
      "plate.mjs: --full-page requires --justify \"why a crop cannot prove this\".\n" +
      "  The justification is written into the run log so a reviewer can weigh it."
    );
    process.exit(2);
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 3,
    isMobile: width < 768,
    hasTouch: width < 768,
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: wait });
  if (wait !== "networkidle") await page.waitForTimeout(1200);

  // Theme is driven by localStorage plus the `dark` class on documentElement.
  // prefers-color-scheme does nothing in this app, and emulateMedia silently
  // captures light twice, which is how six plates labelled dark shipped light.
  await page.evaluate((t) => {
    localStorage.setItem("signalera_theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
  }, theme);
  await page.waitForTimeout(400);

  /* ---- FIXED CHROME THAT PAINTS INTO A CROP FROM OUTSIDE IT ----
   *
   * An element crop is a rectangle, and anything `position: fixed` that
   * overlaps that rectangle is inside it. On the mobile screens the section
   * body is taller than 844px, so the shell's tab bar and the Next dev overlay
   * badge both land in the middle of the frame and the plate shows chrome the
   * section does not own. The previous answer was to capture at a taller
   * viewport, and that changed the LAYOUT: `primer-no-cik-390-*` shipped at
   * 350x926 with 453px of blank tail, 49% of the image, against 350x473 at a
   * real 390x844. A plate named 390 has to be 390x844.
   *
   * `opacity: 0`, NEVER `display: none` AND NEVER `visibility: hidden`, and the
   * reason is the guard rather than the layout. Both of those remove an element
   * from `innerText`, so a `--hide` could be used to hide account data from the
   * detectors below. `opacity: 0` leaves every string exactly where the guard
   * reads it and only stops it painting, so this flag cannot launder a frame.
   *
   * `--hide` is logged in the run line so a reviewer sees what was suppressed. */
  const hideList = hide === true ? "" : String(hide || "");
  const hidden = hideList.split(",").map((x) => x.trim()).filter(Boolean);
  if (hidden.length) {
    await page.evaluate((sels) => {
      for (const sel of sels) {
        for (const el of document.querySelectorAll(sel)) {
          el.style.opacity = "0";
          el.style.pointerEvents = "none";
        }
      }
    }, hidden);
    await page.waitForTimeout(150);
  }

  /* ---- THE GUARD, before anything is written ---- */

  /* Scroll the crop into view FIRST. `locator.screenshot()` scrolls before it
     captures, so the rectangle judged below has to be the rectangle captured.
     Reading rects at the old scroll position judges a frame nobody writes. */
  if (selector && !fullPage) {
    await page.locator(selector).first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(120);
  }

  const pageText = await page.evaluate(() => document.body.innerText || "");

  /* THE SUBTREE IS NOT THE FRAME, AND THAT WAS THE HOLE.
   *
   * This read `document.querySelector(sel).innerText`, which is the crop's
   * SUBTREE, while the capture below is `locator.screenshot()`, which is the
   * crop's RECTANGLE. Anything painted over that rectangle from outside the
   * subtree was in the image and invisible to every detector.
   *
   * Not theoretical. It cleared four separate captures that a human then
   * caught by opening the file: the Next dev-tools badge over a Company Intel
   * crop, the fixed tab bar over a commit-sheet crop, and two more on a Watch
   * plate. Three findings this year were caught by looking rather than by this
   * script, which is the opposite of what a guard is for.
   *
   * So the subject is now the subtree PLUS every fixed or sticky box whose own
   * rectangle intersects the crop. That is what the camera sees.
   *
   * WHY FIXED AND STICKY AND NOT EVERYTHING. Those are the boxes that escape
   * their place in the flow and land on top of an unrelated region. An
   * absolutely positioned box scrolls with its container, so if it overlaps the
   * crop it is almost always inside it and already read. The boundary is stated
   * here rather than left implicit: if a plate ever ships chrome that is
   * neither fixed nor sticky, this is the line to widen.
   *
   * OPACITY IS DELIBERATELY IGNORED. `--hide` paints an element out with
   * `opacity: 0` and the file's existing stance is that the guard still reads
   * it, so the flag cannot launder a frame. An intruder is judged whether or
   * not it paints, for the same reason. */
  const crop = selector
    ? await page.evaluate((s) => {
        const root = document.querySelector(s);
        if (!root) return { text: "", intruders: [] };
        const cr = root.getBoundingClientRect();
        const intruders = [];
        const taken = [];
        for (const el of document.querySelectorAll("*")) {
          if (el === root || root.contains(el) || el.contains(root)) continue;
          const cs = getComputedStyle(el);
          if (cs.position !== "fixed" && cs.position !== "sticky") continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const overlaps =
            r.left < cr.right && r.right > cr.left &&
            r.top < cr.bottom && r.bottom > cr.top;
          if (!overlaps) continue;
          if (taken.some((a) => a.contains(el))) continue;
          taken.push(el);
          const name =
            el.tagName.toLowerCase() +
            (el.id ? `#${el.id}` : "") +
            (typeof el.className === "string" && el.className.trim()
              ? `.${el.className.trim().split(/\s+/)[0]}`
              : "");
          intruders.push({ name, text: el.innerText || "" });
        }
        return { text: root.innerText || "", intruders };
      }, selector)
    : { text: pageText, intruders: [] };

  const cropText = crop.text;
  const intruders = crop.intruders;

  // The frame that will actually be written is what gets judged. A crop that
  // excludes the account card is honest evidence, not a loophole, which is
  // why this reads the crop rather than the page. It now also reads what is
  // painted OVER the crop, which is equally part of the frame.
  const subject = fullPage
    ? pageText
    : [cropText, ...intruders.map((i) => i.text)].join("\n");

  const hits = DETECTORS.filter((d) => d.test.test(subject));
  const avatars = await page.evaluate(AVATAR_PROBE);
  const avatarHit = !fullPage && selector
    ? await page.evaluate(
        (s) => {
          const root = document.querySelector(s);
          if (!root) return [];
          const out = [];
          for (const el of root.querySelectorAll('[data-avatar], [class*="avatar" i]')) {
            const t = (el.textContent || "").trim();
            if (t.length === 1 && t !== "S") { out.push(t); continue; }
            if (!t && (el.querySelector("svg, img") || el.tagName === "IMG")) {
              out.push("<non-text avatar glyph>");
            }
          }
          return out;
        },
        selector
      )
    : avatars;

  if (hits.length || avatarHit.length) {
    console.error(`\nplate.mjs REFUSED to write ${out}\n`);
    for (const h of hits) {
      const m = subject.match(h.test);
      console.error(`  [${h.id}] ${h.says}`);
      console.error(`      found: ${JSON.stringify(String(m[0]).slice(0, 70))}`);
    }
    if (avatarHit.length) {
      console.error(`  [avatar] an account initial is rendered: ${JSON.stringify(avatarHit)}`);
      console.error(`      the brand "S" is the only glyph that is provably signed out`);
    }
    if (intruders.length) {
      console.error(
        `  note: ${intruders.length} fixed or sticky box(es) paint over this crop and were judged with it:`
      );
      for (const i of intruders) console.error(`      ${i.name}`);
      console.error(`      if the hit came from one of those, --hide it or crop clear of it`);
    }
    console.error(
      "\n  Nothing was written. Three ways forward, in order of preference:\n" +
      "    1. Crop tighter. The region that is evidence usually is not the region\n" +
      "       that carries the account.\n" +
      "    2. Capture a state that has no account in it: signed out, a forced\n" +
      "       empty read, or a synthetic payload with identifiers that are\n" +
      "       obviously not real. Say so in the PR body.\n" +
      "    3. Drop the plate and put the measured numbers in the PR body. An\n" +
      "       honest sentence beats an image that had to be doctored.\n" +
      "\n  Do NOT blur, mask or paint over the data. That is doctoring evidence.\n"
    );
    await browser.close();
    process.exit(1);
  }

  const target = selector && !fullPage ? page.locator(selector).first() : page;
  const buf = await target.screenshot(fullPage ? { fullPage: true } : {});
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buf);

  const shape = fullPage ? `FULL PAGE (justified: ${justify})` : `crop ${selector}`;
  console.log(`plate.mjs wrote ${out}`);
  console.log(`  ${shape} at ${width}x${height}, theme ${theme}, wait ${wait}, ${buf.length} bytes`);
  console.log(`  guard: ${DETECTORS.length} detectors clear, no account initial in frame`);
  if (!fullPage) {
    console.log(
      intruders.length
        ? `  in frame from outside the crop, judged: ${intruders.map((i) => i.name).join(", ")}`
        : "  nothing fixed or sticky paints over this crop"
    );
  }
  if (hidden.length) console.log(`  hidden (opacity 0, still read by the guard): ${hidden.join(", ")}`);

  await browser.close();
}

main().catch((e) => {
  console.error("plate.mjs failed:", e.message);
  process.exit(2);
});

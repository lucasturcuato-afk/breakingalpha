/**
 * Deterministic anti-fabrication gate POCs, run against the REAL kvyo pool.
 *
 *   BASELINE = the two live prod guards, copied import-free from
 *              src/lib/web-memo-entity.ts (enforceMemoCitations,
 *              enforceCorroboratedFigures) so we measure exactly what ships.
 *   H2       = cross-source corroboration extended from figures to NAMED EVENTS:
 *              a claim's distinctive event term must appear in >= 2 distinct
 *              pool sources, else strip.
 *   H4       = causal / forward-looking fence: claims with speculative or
 *              causal framing ("threatens", "feud", "signals", "could") must
 *              carry corroborated support, else flag/strip.
 *
 * Pure code, no LLM. Reports, per claim, which gate catches it and whether it
 * harms the true claims. Run: node gates-deterministic.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pool = JSON.parse(readFileSync(join(__dirname, "pools", "kvyo.json"), "utf8")).results;
const fixture = JSON.parse(readFileSync(join(__dirname, "kvyo-memo-fixture.json"), "utf8"));
const claims = fixture.claims;

// Result text exactly as the guards see it: parseWebResultsFromContent puts the
// whole "[n] title (source|date) url :: summary" line into .title. We approximate
// by concatenating title+summary (digits/words identical for matching).
const resultText = pool.map((r) => `${r.title} ${r.summary}`);
const resultDigits = resultText.map((t) => t.replace(/[^0-9]/g, ""));

// ---- BASELINE guard 1: enforceMemoCitations (figure digit-substring) ----
function figureTokens(sentence) {
  const out = new Set();
  const re = /\$?\d[\d,.]*\s?(?:%|percent|billion|bn|million|mn|thousand|k)?/gi;
  for (const m of sentence.match(re) ?? []) {
    const digits = m.replace(/[^0-9]/g, "");
    if (digits.length >= 1) out.add(digits);
  }
  return [...out];
}
function baselineCitations(claim) {
  const figs = figureTokens(claim.text.replace(/\[\d+\]/g, ""));
  if (figs.length === 0) return { acted: false, reason: "no digit figure -> SKIPPED" };
  const stripped = [];
  for (const n of claim.cited) {
    const supports = figs.some((f) => (resultDigits[n - 1] ?? "").includes(f));
    if (!supports) stripped.push(n);
  }
  return stripped.length
    ? { acted: true, reason: `stripped [${stripped.join("][")}] (figure digits absent); PROSE KEPT` }
    : { acted: false, reason: "figure digits present in cited source -> passed" };
}

// ---- BASELINE guard 2: enforceCorroboratedFigures (financial figures only) ----
const MAG = { k:3, thousand:3, m:6, mn:6, million:6, b:9, bn:9, billion:9 };
function scaledFigures(text) {
  const out = [];
  const re = /(\$)?\s?(\d[\d,.]*)\s?(billions?|millions?|thousands?|bn|mn|[kmb]|%|percent)?\b/gi;
  for (const m of text.matchAll(re)) {
    const digits = m[2].replace(/[^0-9]/g, "");
    if (!digits) continue;
    const unit = m[3]?.toLowerCase();
    if (!m[1] && !unit) continue;
    out.push({ digits, exp: unit ? (MAG[unit] ?? 0) : 0 });
  }
  return out;
}
const perResultScaled = resultText.map(scaledFigures);
function baselineCorrob(claim) {
  const figs = scaledFigures(claim.text.replace(/\[\d+\]/g, ""));
  if (figs.length === 0) return { acted: false, reason: "no FINANCIAL figure ($/unit/%) -> SKIPPED" };
  const ok = figs.every((f) =>
    perResultScaled.filter((rf) => rf.some((x) => x.digits === f.digits && (f.exp === 0 || x.exp === 0 || x.exp === f.exp))).length >= 2);
  return ok
    ? { acted: false, reason: "figure corroborated by >=2 sources -> passed" }
    : { acted: true, reason: "stripped all [n] (figure <2 sources); PROSE KEPT" };
}

// ---- H2: cross-source corroboration on NAMED EVENT terms ----
const STOP = new Set("the a an of to and or in on for with by is are was were be klaviyo company its it now new at as that this from up has have will into".split(" "));
function eventTerms(text) {
  // distinctive content tokens (>=4 chars, not stopword), plus figure digits
  const words = text.toLowerCase().replace(/\[\d+\]/g, "").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
  const figs = figureTokens(text.replace(/\[\d+\]/g, ""));
  return [...new Set([...words, ...figs.map((f) => `#${f}`)])];
}
function sourcesContaining(term) {
  if (term.startsWith("#")) {
    const d = term.slice(1);
    return resultDigits.filter((rd) => rd.includes(d)).length;
  }
  return resultText.filter((t) => t.toLowerCase().includes(term)).length;
}
function h2(claim) {
  // The claim's load-bearing terms: pick the rarest content terms; if the single
  // most-distinctive term appears in <2 sources, the claim is single-source.
  const terms = eventTerms(claim.text);
  const scored = terms.map((t) => ({ t, n: sourcesContaining(t) })).sort((a, b) => a.n - b.n);
  const distinctive = scored.filter((s) => s.n <= 2).slice(0, 4); // load-bearing = rare terms
  const corroborated = distinctive.filter((s) => s.n >= 2);
  const single = distinctive.filter((s) => s.n <= 1);
  const verdict = single.length > 0 ? "STRIP" : "pass";
  return { verdict, single: single.map((s) => s.t), reason: single.length ? `single-source terms: ${single.map((s)=>s.t+`(${s.n})`).join(", ")}` : "load-bearing terms corroborated" };
}

// ---- H4: causal / forward fence ----
const CAUSAL = /\b(threatens?|threatening|signals?|signalling|could|would|may|might|poised|risk|feud|rattl\w*|undermin\w*|jeopardiz\w*|set to|expected to|likely to)\b/i;
function h4(claim) {
  if (!CAUSAL.test(claim.text)) return { verdict: "pass", reason: "no causal/forward framing" };
  // causal claim must be backed: its event terms corroborated by >=2 sources
  const back = h2(claim);
  return back.verdict === "STRIP"
    ? { verdict: "STRIP", reason: `causal framing + uncorroborated (${back.reason})` }
    : { verdict: "flag-hedge", reason: "causal framing but corroborated -> require hedge, keep" };
}

// ---- run ----
console.log("CLAIM-BY-CLAIM GATE RESULTS (real kvyo pool)\n" + "=".repeat(70));
const tally = { baseline: { caughtFab: 0, harmedTrue: 0 }, h2: { caughtFab: 0, harmedTrue: 0 }, h4: { caughtFab: 0, harmedTrue: 0 } };
for (const c of claims) {
  const isFab = c.truth === "fabricated";
  const b1 = baselineCitations(c), b2 = baselineCorrob(c);
  const baselineRemovesClaim = false; // neither baseline guard ever deletes prose
  const H2 = h2(c), H4 = h4(c);
  console.log(`\n[${c.id}]  truth=${c.truth.toUpperCase()}  class=${c.class}`);
  console.log(`  text: ${c.text}`);
  console.log(`  BASELINE cite : ${b1.reason}`);
  console.log(`  BASELINE corr : ${b2.reason}`);
  console.log(`  BASELINE net  : prose ALWAYS survives (max action = strip [n]) -> claim REMAINS`);
  console.log(`  H2 corroborate: ${H2.verdict}  (${H2.reason})`);
  console.log(`  H4 causal     : ${H4.verdict}  (${H4.reason})`);
  // scoring: a gate "catches" a fabrication if it STRIPs/deletes the claim
  if (isFab) {
    if (baselineRemovesClaim) tally.baseline.caughtFab++;
    if (H2.verdict === "STRIP") tally.h2.caughtFab++;
    if (H4.verdict === "STRIP") tally.h4.caughtFab++;
  } else {
    if (H2.verdict === "STRIP") tally.h2.harmedTrue++;
    if (H4.verdict === "STRIP") tally.h4.harmedTrue++;
  }
}
const fab = claims.filter((c) => c.truth === "fabricated").length;
const tru = claims.filter((c) => c.truth === "true").length;
console.log("\n" + "=".repeat(70));
console.log(`SUMMARY  (fabricated=${fab}, true=${tru})`);
console.log(`  BASELINE (prod) : caught 0/${fab} fabrications as CLAIMS (only strips citation markers). true harmed 0/${tru}.`);
console.log(`  H2 corroborate  : caught ${tally.h2.caughtFab}/${fab} fabrications. true harmed ${tally.h2.harmedTrue}/${tru}.`);
console.log(`  H4 causal fence : caught ${tally.h4.caughtFab}/${fab} fabrications. true harmed ${tally.h4.harmedTrue}/${tru}.`);

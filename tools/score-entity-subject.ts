/**
 * Score a fixture against the entity-subject predicate.
 *
 * Reports, in order:
 *   1. overall exact verdict match, and SUBJECT class precision plus recall
 *   2. per component precision / recall over the cases tagged with that component
 *   3. ablation: neuter one component at a time and re read the whole fixture,
 *      which is the measurement that showed the OLD fixture was hollow
 *
 * Usage: npx tsx tools/score-entity-subject.ts <fixture.json>
 */
import { readFileSync, writeFileSync, mkdtempSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type Case = {
  id: string; subject: string; tickers?: string[]; title: string; summary?: string;
  scope: "title" | "document"; expected: "SUBJECT" | "MENTION" | "ABSENT";
  polarity: "positive" | "negative"; components: string[]; why?: string; provenance?: string;
};

const SRC = resolve("src/lib/entity-subject.ts");
const LEX = resolve("src/lib/entity-subject-lexicon.json");

// Each ablation makes exactly one component inert by an early return.
const ABLATIONS: Record<string, [RegExp, string]> = {
  D1: [/function isRosterElement\(([^)]*)\): boolean \{/, "function isRosterElement($1): boolean { return false;"],
  D2: [/function isCounterpartyAdjunct\(([\s\S]*?)\): boolean \{/, "function isCounterpartyAdjunct($1): boolean { return false;"],
  D3: [/function isAnalystAttributor\(([\s\S]*?)\): boolean \{/, "function isAnalystAttributor($1): boolean { return false;"],
  exchangeStrip: [/export function stripExchangeQualifiers\(text: string\): string \{/, "export function stripExchangeQualifiers(text: string): string { return text;"],
};

async function loadPredicate(ablate?: string) {
  if (!existsSync(SRC)) {
    throw new Error(
      `entity-subject.ts not found at ${SRC}. This fixture scores a predicate that is not on main. ` +
      `Run from a tree that has it, for example one that merges lane-b-j2/entity-subject-predicate.`,
    );
  }
  if (!ablate) return import(SRC);
  const src = readFileSync(SRC, "utf8");
  const [re, rep] = ABLATIONS[ablate];
  if (!re.test(src)) throw new Error(`ablation ${ablate}: pattern did not match, refusing to report a number`);
  const dir = mkdtempSync(join(tmpdir(), `abl-${ablate}-`));
  cpSync(LEX, join(dir, "entity-subject-lexicon.json"));
  writeFileSync(join(dir, "entity-subject.ts"), src.replace(re, rep));
  return import(join(dir, "entity-subject.ts"));
}

const prf = (rows: { exp: string; got: string }[]) => {
  const tp = rows.filter(r => r.exp === "SUBJECT" && r.got === "SUBJECT").length;
  const fp = rows.filter(r => r.exp !== "SUBJECT" && r.got === "SUBJECT").length;
  const fn = rows.filter(r => r.exp === "SUBJECT" && r.got !== "SUBJECT").length;
  const exact = rows.filter(r => r.exp === r.got).length;
  const p = tp + fp ? tp / (tp + fp) : NaN, r = tp + fn ? tp / (tp + fn) : NaN;
  return { n: rows.length, tp, fp, fn, exact, p, r, f1: p + r ? (2 * p * r) / (p + r) : NaN };
};
const f = (x: number) => Number.isNaN(x) ? "  n/a" : x.toFixed(3);

(async () => {
  const fx = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const cases: Case[] = fx.cases;
  const run = async (ablate?: string) => {
    const m = (await loadPredicate(ablate)) as {
      classifyEntitySubject: (
        subject: { canonical: string; ticker?: string },
        doc: { title?: string; body?: string },
        scope: string,
      ) => { verdict: string; reasons: string[] };
    };
    return cases.map(c => {
      const out = m.classifyEntitySubject(
        { canonical: c.subject, ticker: c.tickers?.[0] },
        { title: c.title, body: c.summary ?? "" },
        c.scope,
      );
      return { c, exp: c.expected as string, got: out.verdict as string, reasons: out.reasons as string[] };
    });
  };

  const base = await run();
  const o = prf(base);
  console.log(`FIXTURE ${process.argv[2]}`);
  console.log(`cases ${o.n}   positives ${cases.filter(c => c.polarity === "positive").length}   negatives ${cases.filter(c => c.polarity === "negative").length}\n`);
  console.log(`OVERALL  exact3way ${(o.exact / o.n).toFixed(3)}   SUBJECT precision ${f(o.p)}  recall ${f(o.r)}  f1 ${f(o.f1)}   tp ${o.tp} fp ${o.fp} fn ${o.fn}\n`);

  const comps = [...new Set(cases.flatMap(c => c.components))].sort();
  console.log("PER COMPONENT  (cases tagged with that component)");
  console.log("component            n   pos   prec  recall     f1   exact");
  for (const k of comps) {
    const rows = base.filter(x => x.c.components.includes(k));
    const s = prf(rows);
    const pos = rows.filter(x => x.c.polarity === "positive").length;
    console.log(`${k.padEnd(18)} ${String(s.n).padStart(3)}   ${String(pos).padStart(3)}  ${f(s.p)}  ${f(s.r)}  ${f(s.f1)}   ${(s.exact / s.n).toFixed(3)}`);
  }

  console.log("\nABLATION  (neuter one component, re read the WHOLE fixture)");
  console.log("ablated             exact3way   prec  recall   verdictsFlipped");
  for (const k of Object.keys(ABLATIONS)) {
    try {
      const rows = await run(k);
      const s = prf(rows);
      const flipped = rows.filter((r, i) => r.got !== base[i].got).length;
      const mark = flipped === 0 ? "   <- CONTRIBUTES NOTHING" : "";
      console.log(`${k.padEnd(18)}     ${(s.exact / rows.length).toFixed(3)}  ${f(s.p)}  ${f(s.r)}   ${String(flipped).padStart(3)}${mark}`);
    } catch (e) { console.log(`${k.padEnd(18)}     ABLATION FAILED: ${(e as Error).message}`); }
  }

  const failures = base.filter(x => x.exp !== x.got);
  console.log(`\nFAILURES ${failures.length} of ${base.length}`);
  for (const x of failures.slice(0, 40)) {
    console.log(`  ${x.c.id.padEnd(22)} want ${x.exp.padEnd(7)} got ${x.got.padEnd(7)} [${x.c.components.join(",")}]  ${x.reasons.join(",") || "-"}`);
  }
  if (failures.length > 40) console.log(`  ... and ${failures.length - 40} more`);
})();

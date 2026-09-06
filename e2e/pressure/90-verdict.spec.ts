/**
 * Turn the collected ledger into a report, and go red on anything critical.
 *
 * Nothing upstream throws on a defect, on purpose: a thrown assertion stops the
 * walk at the first bad screen and the walk's whole value is breadth. This is
 * where breadth becomes a verdict.
 */
import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { readJsonl, REPORT_DIR, type Finding, type RouteVisit, type WriteLogEntry } from "./lib/report";

const ORDER = ["critical", "high", "medium", "low", "info"] as const;

test("verdict: assemble the report", async () => {
  const findings = readJsonl<Finding>("findings.jsonl");
  const routes = readJsonl<RouteVisit>("routes.jsonl");
  const writes = readJsonl<WriteLogEntry>("writes.jsonl");
  const notes = readJsonl<{ kind: string; screen: string; text: string; basis: string }>("notes.jsonl");
  const controls = readJsonl<Record<string, unknown>>("controls.jsonl");

  /* Collapse duplicates: the same rule on the same screen in two themes is one
     defect seen twice, not two defects. */
  const seen = new Map<string, Finding & { count: number; themes: Set<string>; passes: Set<string> }>();
  for (const f of findings) {
    const key = `${f.rule}|${f.screen}|${f.title}`;
    const prev = seen.get(key);
    if (prev) {
      prev.count += 1;
      if (f.theme) prev.themes.add(f.theme);
      prev.passes.add(f.pass);
    } else {
      seen.set(key, { ...f, count: 1, themes: new Set(f.theme ? [f.theme] : []), passes: new Set([f.pass]) });
    }
  }
  const unique = Array.from(seen.values()).sort(
    (a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity),
  );

  const lines: string[] = [];
  lines.push("# Mobile pressure walk");
  lines.push("");
  lines.push(`Run at ${new Date().toISOString()} against a local production build on :3370 with VERCEL_ENV=preview.`);
  lines.push("");

  lines.push("## 1. What it walked");
  lines.push("");
  const byPass = (p: string) => routes.filter((r) => r.pass === p);
  lines.push(`Routes entered: ${routes.length} visits, ${new Set(routes.map((r) => r.route)).size} distinct.`);
  for (const r of routes) {
    lines.push(`- ${r.route} (HTTP ${r.status}) reached by ${r.reachedBy}${r.finalUrl.includes(r.route) ? "" : ` -> landed ${r.finalUrl}`}`);
  }
  lines.push("");
  lines.push(`Controls activated: ${controls.length}. Verdicts: ${JSON.stringify(
    controls.reduce<Record<string, number>>((acc, c) => {
      const v = String(c.verdict);
      acc[v] = (acc[v] ?? 0) + 1;
      return acc;
    }, {}),
  )}`);
  lines.push("");
  lines.push("Writes made and reversed:");
  for (const w of writes) {
    lines.push(`- ${w.at} ${w.table}: ${w.action} - ${w.detail} [row ${w.rowId ?? "n/a"}] reversed=${w.reversed}`);
  }
  lines.push("");

  lines.push("## 2. What it could not reach, and why");
  lines.push("");
  for (const f of unique.filter((f) =>
    ["route-redirected", "route-error-status", "pole-owns-a-route-with-no-page", "pole-owns-a-route-that-redirects", "allowlist-gate-blocks-route", "reachable-only-by-url", "write-path-unreachable", "failure-path-unreachable", "add-affordance-unreachable"].includes(f.rule),
  )) {
    lines.push(`- [${f.severity}] ${f.screen}: ${f.title}`);
    lines.push(`  ${f.evidence}`);
  }
  for (const n of notes.filter((n) => n.kind === "route-not-reached-by-tapping" || n.kind === "walk-truncated" || n.kind === "control-vanished")) {
    lines.push(`- (${n.kind}) ${n.screen}: ${n.text}`);
  }
  lines.push("");

  lines.push("## 3. Reached but not put into a meaningful state");
  lines.push("");
  for (const n of notes.filter((n) => n.kind === "no-meaningful-state")) {
    lines.push(`- ${n.screen}: ${n.text}`);
  }
  lines.push("");

  lines.push("## Findings by severity");
  lines.push("");
  for (const sev of ORDER) {
    const group = unique.filter((f) => f.severity === sev);
    if (!group.length) continue;
    lines.push(`### ${sev} (${group.length})`);
    for (const f of group) {
      lines.push(
        `- **${f.rule}** on \`${f.screen}\` [${f.basis.toUpperCase()}] (${[...f.passes].join("/")} pass${f.themes.size ? `, ${[...f.themes].join("+")}` : ""}, seen ${f.count}x): ${f.title}`,
      );
      lines.push(`  - evidence: ${f.evidence}`);
    }
    lines.push("");
  }

  lines.push("## Notes and measurements");
  lines.push("");
  for (const n of notes) {
    lines.push(`- (${n.kind}) ${n.screen} [${n.basis}]: ${n.text}`);
  }

  fs.writeFileSync(path.join(REPORT_DIR, "REPORT.md"), lines.join("\n"), "utf8");
  fs.writeFileSync(path.join(REPORT_DIR, "findings-unique.json"), JSON.stringify(unique.map((f) => ({ ...f, themes: [...f.themes], passes: [...f.passes] })), null, 2));

  const criticals = unique.filter((f) => f.severity === "critical");
  console.log(`\npressure-report/REPORT.md written. ${unique.length} distinct findings, ${criticals.length} critical.`);
  for (const c of criticals) console.log(`  CRITICAL ${c.rule} @ ${c.screen}: ${c.title}`);

  expect(
    byPass("empty").length + byPass("populated").length,
    "the walk must have visited something: pressure-report/ holds no route visits, so 10-walk-empty " +
      "and 30-walk-populated did not run against a live server before this verdict. Run the suite in " +
      "file order with `npm run test:pressure` (see docs/runbooks/e2e-suites.md)",
  ).toBeGreaterThan(0);
  expect(criticals, `critical findings: ${criticals.map((c) => `${c.rule}@${c.screen}`).join(", ")}`).toEqual([]);
});

/**
 * The pressure walk's ledger of what happened.
 *
 * Nothing in this harness throws to report a defect. A thrown assertion stops
 * the walk at the first screen with a problem, and the walk's whole value is
 * breadth. So every observation lands here, tagged MEASURED or INFERRED, and
 * one final spec turns the collected criticals into a red run.
 *
 * MEASURED means a value read off the running page or the database in this
 * run. INFERRED means read off source, or deduced from a measured value
 * without being observed directly. Every line carries one or the other because
 * a report that mixes them is a report a reader has to re-derive.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

export const REPORT_DIR = path.resolve(__dirname, "../../../pressure-report");

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Basis = "measured" | "inferred";

export interface Finding {
  severity: Severity;
  rule: string;
  screen: string;
  theme?: string;
  pass: "empty" | "populated" | "writes" | "static" | "cleanup";
  title: string;
  evidence: string;
  basis: Basis;
}

export interface RouteVisit {
  route: string;
  reachedBy: string; // "pole:Ledger" | "tap:<selector> from <route>" | "url-only"
  status: number | null;
  finalUrl: string;
  pass: string;
}

export interface WriteLogEntry {
  at: string;
  table: string;
  action: string;
  detail: string;
  rowId?: string;
  reversed: boolean | "n/a";
}

function ensure() {
  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
}

function appendJsonl(file: string, obj: unknown) {
  ensure();
  appendFileSync(path.join(REPORT_DIR, file), JSON.stringify(obj) + "\n", "utf8");
}

export function resetReport() {
  ensure();
  for (const f of ["findings.jsonl", "routes.jsonl", "writes.jsonl", "controls.jsonl", "notes.jsonl"]) {
    writeFileSync(path.join(REPORT_DIR, f), "", "utf8");
  }
}

export function finding(f: Finding) {
  appendJsonl("findings.jsonl", f);
}

export function routeVisit(v: RouteVisit) {
  appendJsonl("routes.jsonl", v);
}

export function writeLog(w: WriteLogEntry) {
  appendJsonl("writes.jsonl", w);
}

export function controlLog(c: Record<string, unknown>) {
  appendJsonl("controls.jsonl", c);
}

/** Free-form note: things reached but not put into a meaningful state, etc. */
export function note(kind: string, screen: string, text: string, basis: Basis) {
  appendJsonl("notes.jsonl", { kind, screen, text, basis });
}

export function readJsonl<T>(file: string): T[] {
  const p = path.join(REPORT_DIR, file);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

#!/usr/bin/env node
/**
 * Lists the rulings in `decisions/`, and guards the one rule that directory
 * exists to enforce.
 *
 * WHY THIS EXISTS. Two units built in parallel on 2026-08-29, each read
 * DECISIONS.md, each saw the highest ruling was 20, and each took 21. That is
 * not a mistake either made: every parallel author reading "the next free
 * number" from one file reads the same answer, because none can see the others.
 *
 * A placeholder would not have helped. Two units appending to the same anchor
 * in the same file conflict whatever they write there. The conflict is the
 * shared anchor. The only thing git merges cleanly and always is a change to a
 * different file, so: one ruling, one file, named rather than numbered.
 *
 * Exit 0 lists. Exit 1 means someone numbered a ruling, which is the thing
 * that cannot be allowed to become a habit again.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIR = "decisions";
const NUMBERED = /^#{1,6}\s*Ruling\s+\d+/im;

if (!existsSync(DIR)) {
  console.error(`decisions: no ${DIR}/ directory here. Run from the repo root.`);
  process.exit(1);
}

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".md") && f !== "README.md")
  .sort();

const offenders = [];
const rows = [];

for (const f of files) {
  const text = readFileSync(join(DIR, f), "utf8");

  /* The guard. A numbered heading in here means someone allocated a number
     from a shared counter again, which is the exact collision this directory
     removes. Named, not numbered. */
  const numbered = text.match(NUMBERED);
  if (numbered) offenders.push({ f, line: numbered[0].trim() });

  const title = (text.match(/^#\s+(.+)$/m) || [, f.replace(/\.md$/, "")])[1].trim();
  const date = (text.match(/^Date:\s*(.+)$/m) || [, ""])[1].trim();
  rows.push({ f, title, date });
}

rows.sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.f.localeCompare(b.f));

if (rows.length === 0) {
  console.log("decisions: none yet. DECISIONS.md carries rulings 1 to 22.");
} else {
  const w = Math.max(...rows.map((r) => r.f.length));
  console.log(`decisions: ${rows.length} ruling${rows.length === 1 ? "" : "s"}, oldest first\n`);
  for (const r of rows) {
    console.log(`  ${(r.date || "no date").padEnd(10)}  ${r.f.padEnd(w)}  ${r.title}`);
  }
  const undated = rows.filter((r) => !r.date);
  if (undated.length) {
    console.log(`\n  note: ${undated.length} without a Date: line, so ordering is by filename`);
  }
}

if (offenders.length) {
  console.error(`\ndecisions: ${offenders.length} numbered ruling${offenders.length === 1 ? "" : "s"} in ${DIR}/\n`);
  for (const o of offenders) console.error(`  ${o.f}\n    ${o.line}`);
  console.error(
    "\n  Rulings in this directory are named, not numbered. Two parallel units\n" +
    "  both reading the next free number from one place will both read the same\n" +
    "  number; that already happened once. Use a slug filename and a plain\n" +
    "  `# <what was ruled>` heading. See decisions/README.md.\n"
  );
  process.exit(1);
}

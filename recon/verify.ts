import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { resolveCompanyCik } from "../src/lib/sec-filings.ts";
import { buildThinFallback } from "../src/lib/thin-fallback.ts";

function env(k: string): string {
  for (const l of readFileSync("/Users/noahhanning/breakingalpha/.env.local", "utf8").split(/\r?\n/)) {
    const m = l.match(new RegExp(`^${k}\\s*=\\s*(.+)$`));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error(k);
}
const sb = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

// name-only inputs (the failing full-name cases), no ticker supplied.
const CASES = [
  "Advanced Micro Devices",
  "AMD",
  "Unum Group",
  "International Business Machines",
  "ASML Holding",
  "Lake Shore Bancorp",
  "Zzq Nonexistent Holdings",
];

async function main() {
  for (const name of CASES) {
    const res = await resolveCompanyCik(sb, { name });
    const tf = await buildThinFallback(sb, { name });
    console.log(
      `"${name}"`.padEnd(34),
      `cik=${String(res.cik).padEnd(7)}`,
      `tier=${tf.tier}`,
      `(resolvedName=${res.name ?? "null"}, ticker=${res.ticker ?? "null"})`,
    );
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

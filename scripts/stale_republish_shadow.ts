/**
 * Stale-republish detector -- Layer 1 SHADOW JOB (read-only).
 *
 * Reads recent fresh articles from prod, runs the Layer 1 price cross-check
 * (src/lib/stale-republish.ts) over each, and logs one STALE_REPUBLISH_SHADOW
 * line per flagged stale republish. WRITES NOTHING: no DB mutation, no ranking
 * change, no recency change, no migration. Price fetches are read-only Yahoo v8
 * (keyless). This is the standalone shadow harness the recon doc Phase D calls
 * for; run it across daily cadences and verify every logged hit is a real
 * republish before any human flips STALE_REPUBLISH_MODE to active.
 *
 * Run (read-only):
 *   npx tsx scripts/stale_republish_shadow.ts
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL + an anon/service key (read-only SELECT only).
 * Optional: STALE_SHADOW_WINDOW_DAYS (default 7), STALE_SHADOW_LIMIT (default 400).
 */
import { createClient } from "@supabase/supabase-js";
import {
  evaluateStaleRepublish,
  parseHeadlineMagnitude,
  hasMoveVerbNearPercent,
  parseSourceTicker,
  shadowLogLine,
  type StaleRepublishInput,
} from "../src/lib/stale-republish.ts";

const WINDOW_DAYS = Number(process.env.STALE_SHADOW_WINDOW_DAYS ?? 7);
const LIMIT = Number(process.env.STALE_SHADOW_LIMIT ?? 400);

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or a Supabase key. Aborting (read-only job).");
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  // READ-ONLY select. Fresh pubDate window mirrors the Top Stories ceiling.
  const { data, error } = await supabase
    .from("articles")
    .select("id, title, source, published_at")
    .gte("published_at", since)
    .order("published_at", { ascending: false })
    .limit(LIMIT);

  if (error) {
    console.error("Query error (read-only):", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Array<{
    id: string;
    title: string | null;
    source: string | null;
    published_at: string | null;
  }>;

  // Pre-filter to Layer-1-eligible rows so we only hit Yahoo for checkable
  // headlines (quantified move + move verb + resolvable ticker).
  const eligible = rows.filter(
    (r) =>
      parseHeadlineMagnitude(r.title) !== null &&
      hasMoveVerbNearPercent(r.title) &&
      parseSourceTicker(r.source) !== null,
  );

  console.log(
    `STALE_REPUBLISH_SHADOW_RUN window_days=${WINDOW_DAYS} scanned=${rows.length} ` +
      `eligible=${eligible.length} (read-only, writes nothing)`,
  );

  let flagged = 0;
  for (const r of eligible) {
    const input: StaleRepublishInput = {
      id: r.id,
      title: r.title,
      source: r.source,
      publishedAt: r.published_at,
    };
    const verdict = await evaluateStaleRepublish(input);
    if (verdict.stale) {
      flagged++;
      const line = shadowLogLine(input, verdict);
      if (line) console.log(line);
    }
  }

  console.log(
    `STALE_REPUBLISH_SHADOW_DONE eligible=${eligible.length} flagged=${flagged} ` +
      `(no writes, no ranking change, no migration)`,
  );
}

main().catch((e) => {
  console.error("stale_republish_shadow failed:", e);
  process.exit(1);
});

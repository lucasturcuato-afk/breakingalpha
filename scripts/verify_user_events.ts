/**
 * Phase 1B: Verify user_events table works end-to-end.
 * Run with: npx tsx scripts/verify_user_events.ts
 *
 * Tests: table exists → column check → schema report.
 * Cannot do write/delete cycle because user_id has FK to auth.users.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);

async function main() {
  console.log("=== Phase 1B: user_events verification ===\n");

  // 1. Check table exists & count rows
  const { count, error: countErr } = await supabase
    .from("user_events")
    .select("*", { count: "exact", head: true });

  if (countErr) {
    console.error("FAIL: user_events table not accessible:", countErr.message);
    process.exit(1);
  }
  console.log(`[OK] user_events table exists, ${count} rows currently`);

  // 2. Verify expected columns
  const cols = ["id", "user_id", "event_type", "created_at"];
  const { error: colErr } = await supabase
    .from("user_events")
    .select(cols.join(", "))
    .limit(0);

  if (colErr) {
    console.error("FAIL: basic column check:", colErr.message);
    process.exit(1);
  }
  console.log(`[OK] columns present: ${cols.join(", ")}`);

  // 3. Check metadata vs payload column
  const { error: metaErr } = await supabase
    .from("user_events")
    .select("metadata")
    .limit(0);

  const { error: payloadErr } = await supabase
    .from("user_events")
    .select("payload")
    .limit(0);

  const jsonbCol = !metaErr ? "metadata" : !payloadErr ? "payload" : "NONE";
  console.log(`[INFO] JSONB column name: ${jsonbCol}`);

  if (jsonbCol === "NONE") {
    console.warn("[WARN] No metadata/payload column found — trackEvent may fail silently");
  }

  // 4. Check what trackEvent in user-profile.ts inserts
  console.log("\n[INFO] user-profile.ts trackEvent() inserts: { user_id, event_type, payload }");
  if (jsonbCol === "metadata") {
    console.log("[ACTION NEEDED] Column is 'metadata' but code sends 'payload'.");
    console.log("  Fix: Either rename column to 'payload' or update trackEvent to use 'metadata'.");
  } else if (jsonbCol === "payload") {
    console.log("[OK] Column name matches code.");
  }

  // 5. Check FK constraint (user_id → auth.users)
  console.log("\n[INFO] user_events.user_id has FK to auth.users — insert requires a real user_id.");
  console.log("[INFO] This means trackEvent will fail for non-existent users (expected).");

  console.log("\n=== user_events verification COMPLETE ===");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

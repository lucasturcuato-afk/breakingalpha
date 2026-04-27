/**
 * Programmatic e2e test for the PDF export flow.
 *
 *   - Creates a test user via service role (email_confirm=true).
 *   - Signs in via password to obtain a Supabase session.
 *   - Builds the @supabase/ssr `sb-<ref>-auth-token` cookie value
 *     (the base64'd session JSON the SSR client expects).
 *   - POSTs to /api/brief/export-pdf with that cookie.
 *   - Expects: 200 + application/pdf body OR a structured 5xx if the
 *     render validator catches a regression.
 *
 * Cleans up the test user on exit.
 */

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

// =============================================================================
// PRODUCTION SAFETY GUARDS
// This script creates and deletes real Supabase users via service_role.
// Triple-guard against accidental production execution.
// =============================================================================

if (process.env.NODE_ENV === "production") {
  console.error(
    "ERROR: _test_export_pdf.mjs cannot run with NODE_ENV=production. " +
    "This script creates and deletes real users via service_role.",
  );
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const PROD_PROJECT_REF = "pnfjelfvtypkpnwpflmv";
if (supabaseUrl.includes(PROD_PROJECT_REF)) {
  console.error(
    `ERROR: _test_export_pdf.mjs detected production Supabase project ` +
    `(${PROD_PROJECT_REF}) in NEXT_PUBLIC_SUPABASE_URL. ` +
    `Refusing to run. Use a dev/staging Supabase project instead.`,
  );
  process.exit(1);
}

if (process.env.ALLOW_TEST_USER_MUTATION !== "1") {
  console.error(
    "ERROR: _test_export_pdf.mjs requires ALLOW_TEST_USER_MUTATION=1 " +
    "to confirm you understand this script creates and deletes real " +
    "Supabase users via service_role. Re-run as: " +
    "ALLOW_TEST_USER_MUTATION=1 node scripts/_test_export_pdf.mjs",
  );
  process.exit(1);
}

console.log(
  `[_test_export_pdf] Guards passed. Supabase URL: ${supabaseUrl}. ` +
  `NODE_ENV: ${process.env.NODE_ENV || "(unset)"}.`,
);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGIN = process.env.TEST_ORIGIN || "http://localhost:3000";

if (!SUPABASE_URL || !ANON || !SERVICE) {
  console.error("missing env vars (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)");
  process.exit(2);
}

const projectRef = new URL(SUPABASE_URL).host.split(".")[0];

const email = `pdftest+${Date.now()}@example.com`;
const password = "pdftest-" + Math.random().toString(36).slice(2);

const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

console.log(`[test] creating user ${email}`);
const { data: created, error: cErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (cErr) { console.error("createUser failed:", cErr); process.exit(1); }
const userId = created.user.id;
console.log(`[test] user_id=${userId}`);

// Insert minimal user_profiles row so the personalization path activates
// (role + sectors so we can verify section reshape).
{
  const { error } = await admin.from("user_profiles").upsert({
    id: userId,
    role: "buy_side",
    sectors: ["Macro & Rates", "Deals & M&A"],
    onboarding_completed: true,
  });
  if (error) console.warn("[test] user_profiles upsert warning:", error.message);
}

const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
console.log("[test] signing in via password");
const { data: signIn, error: sErr } = await anon.auth.signInWithPassword({ email, password });
if (sErr) { console.error("signIn failed:", sErr); process.exit(1); }
const session = signIn.session;

// Build the @supabase/ssr cookie. Modern `@supabase/ssr` stores the
// session as a `base64-` prefixed JSON blob (chunked into .0/.1 if it
// exceeds 4 KB). We emit a single un-chunked cookie which is fine for
// the typical session size (~3 KB).
const cookieName = `sb-${projectRef}-auth-token`;
const sessionJson = JSON.stringify({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
  expires_in: session.expires_in,
  expires_at: session.expires_at,
  token_type: session.token_type,
  user: session.user,
});
const cookieVal = "base64-" + Buffer.from(sessionJson).toString("base64");
const cookieHeader = `${cookieName}=${cookieVal}`;
console.log(`[test] cookie len=${cookieVal.length} chars`);

// Hit the export route.
console.log("[test] POST /api/brief/export-pdf");
const t0 = Date.now();
const resp = await fetch(`${ORIGIN}/api/brief/export-pdf`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Cookie: cookieHeader,
  },
  body: JSON.stringify({ briefing_type: "morning" }),
});
const elapsed = Date.now() - t0;
const ct = resp.headers.get("content-type") || "";
console.log(`[test] HTTP ${resp.status} content-type=${ct} elapsed_ms=${elapsed}`);

if (resp.status === 200 && ct.includes("application/pdf")) {
  const buf = Buffer.from(await resp.arrayBuffer());
  const out = `/tmp/export-pdf-${Date.now()}.pdf`;
  writeFileSync(out, buf);
  console.log(`[test] PDF saved: ${out} (${buf.length} bytes)`);
  try {
    const info = execSync(`pdfinfo "${out}"`, { encoding: "utf8" });
    console.log("--- pdfinfo ---");
    console.log(info);
  } catch (e) {
    console.warn("[test] pdfinfo unavailable:", e.message);
  }
} else {
  const body = await resp.text();
  console.log("--- error body ---");
  console.log(body);
}

// Cleanup
console.log("[test] deleting test user");
await admin.auth.admin.deleteUser(userId);
console.log("[test] done");

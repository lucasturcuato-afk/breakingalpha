/**
 * Reverse every write, and report loudly anything that will not reverse.
 *
 * THE DELETES ARE MADE AS THE E2E USER, never with the service role. A session
 * is minted here with the anon key and the account's own password, exactly the
 * credential the app itself uses, so RLS is the thing deciding what may be
 * removed: `user_claims_owner_all` is FOR ALL USING (auth.uid() = user_id),
 * which covers DELETE for the reader's own rows and nothing else. The
 * service-role key is used ONLY to read rows back for verification.
 *
 * WHAT MAY NOT REVERSE, and this is the part the report has to carry. The app
 * exposes no DELETE for a user claim: `PATCH /api/radar/claims` accepts
 * status='archived' and nothing else, deliberately, because verdict-bearing
 * statuses belong to the grader. So a claim authored through the product is
 * permanent through the product. It is removable through PostgREST under the
 * owner policy, which is what this file does; if that ever fails, the rows are
 * named in the report and left behind rather than quietly forgotten.
 */
import { expect, test } from "@playwright/test";
import { pgRead, E2E_USER_ID, TEST_TAG } from "./lib/harness";
import { finding, note, writeLog } from "./lib/report";

async function userToken(): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.E2E_USER_EMAIL, password: process.env.E2E_USER_PASSWORD }),
  });
  if (!res.ok) throw new Error(`sign-in for cleanup failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function deleteAsUser(token: string, pathAndQuery: string): Promise<{ ok: boolean; status: number; body: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    method: "DELETE",
    headers: { apikey: anon, Authorization: `Bearer ${token}`, Prefer: "return=representation" },
  });
  return { ok: res.ok, status: res.status, body: (await res.text()).slice(0, 300) };
}

test("cleanup: reverse every write this run made", async () => {
  const token = await userToken();

  /* 1. Claims. Everything this harness authored carries TEST_TAG in its note
        or its claim text; nothing else is touched. */
  const claims = (await pgRead(
    `user_claims?user_id=eq.${E2E_USER_ID}&select=id,user_claim,commit_note,status,created_at&order=created_at.desc`,
  )) as Array<Record<string, unknown>>;
  /* Broader than TEST_TAG on purpose. A row written while the harness itself
     was being debugged carries "from the harness" rather than the tag, and a
     row this run created but did not label is still a row this run created.
     No genuine reader note contains the word. */
  const HARNESS_MARK = /harness/i;
  const mine = claims.filter(
    (c) => HARNESS_MARK.test(String(c.commit_note ?? "")) || HARNESS_MARK.test(String(c.user_claim ?? "")),
  );
  note("cleanup-scope", "user_claims", `${claims.length} rows on the account, ${mine.length} carrying the harness mark (tag is ${TEST_TAG})`, "measured");

  for (const c of mine) {
    const r = await deleteAsUser(token, `user_claims?id=eq.${c.id}&user_id=eq.${E2E_USER_ID}`);
    const still = (await pgRead(`user_claims?id=eq.${c.id}&select=id`)) as unknown[];
    const gone = still.length === 0;
    writeLog({
      at: new Date().toISOString(),
      table: "user_claims",
      action: "DELETE via PostgREST as the E2E user (owner RLS policy)",
      detail: `HTTP ${r.status}; row present after delete: ${!gone}; claim="${String(c.user_claim).slice(0, 60)}"`,
      rowId: String(c.id),
      reversed: gone,
    });
    if (!gone) {
      finding({
        severity: "critical",
        rule: "write-not-reversed",
        screen: "user_claims",
        pass: "cleanup",
        title: `PERSISTS: user_claims row ${c.id} could not be deleted`,
        evidence: `DELETE answered ${r.status}: ${r.body}. Claim text: "${String(c.user_claim).slice(0, 120)}". Note: "${String(c.commit_note ?? "").slice(0, 120)}". Status ${c.status}. This row is still on the production account and needs a human to remove it.`,
        basis: "measured",
      });
    }
  }

  /* 2. Follows and watchlist. Both round trips already reversed themselves;
        this catches anything the populated pass planted. */
  const follows = (await pgRead(
    `follows?user_id=eq.${E2E_USER_ID}&select=id,target,display_name`,
  )) as Array<Record<string, unknown>>;
  for (const f of follows.filter((r) => /harness/i.test(String(r.display_name ?? "")))) {
    const r = await deleteAsUser(token, `follows?id=eq.${f.id}&user_id=eq.${E2E_USER_ID}`);
    const still = (await pgRead(`follows?id=eq.${f.id}&select=id`)) as unknown[];
    writeLog({
      at: new Date().toISOString(),
      table: "follows",
      action: "DELETE via PostgREST as the E2E user",
      detail: `HTTP ${r.status}; target=${f.target}`,
      rowId: String(f.id),
      reversed: still.length === 0,
    });
    if (still.length > 0) {
      finding({
        severity: "critical",
        rule: "write-not-reversed",
        screen: "follows",
        pass: "cleanup",
        title: `PERSISTS: follows row ${f.id} (${f.target}) could not be deleted`,
        evidence: `DELETE answered ${r.status}: ${r.body}`,
        basis: "measured",
      });
    }
  }

  const wl = (await pgRead(
    `watchlist?user_id=eq.${E2E_USER_ID}&select=id,identifier,display_name`,
  )) as Array<Record<string, unknown>>;
  for (const e of wl.filter((r) => /harness/i.test(String(r.display_name ?? "")))) {
    const r = await deleteAsUser(token, `watchlist?id=eq.${e.id}&user_id=eq.${E2E_USER_ID}`);
    const still = (await pgRead(`watchlist?id=eq.${e.id}&select=id`)) as unknown[];
    writeLog({
      at: new Date().toISOString(),
      table: "watchlist",
      action: "DELETE via PostgREST as the E2E user",
      detail: `HTTP ${r.status}; identifier=${e.identifier}`,
      rowId: String(e.id),
      reversed: still.length === 0,
    });
    if (still.length > 0) {
      finding({
        severity: "critical",
        rule: "write-not-reversed",
        screen: "watchlist",
        pass: "cleanup",
        title: `PERSISTS: watchlist row ${e.id} (${e.identifier}) could not be deleted`,
        evidence: `DELETE answered ${r.status}: ${r.body}`,
        basis: "measured",
      });
    }
  }

  /* 3. The account as it stands now, so the report can state it rather than
        assert it. */
  const finalClaims = (await pgRead(`user_claims?user_id=eq.${E2E_USER_ID}&select=id,status,source`)) as unknown[];
  const finalFollows = (await pgRead(`follows?user_id=eq.${E2E_USER_ID}&select=id`)) as unknown[];
  const finalWl = (await pgRead(`watchlist?user_id=eq.${E2E_USER_ID}&select=id`)) as unknown[];
  note(
    "final-account-state",
    "(account)",
    `user_claims ${finalClaims.length}, follows ${finalFollows.length}, watchlist ${finalWl.length}`,
    "measured",
  );

  const leftover = (await pgRead(
    `user_claims?user_id=eq.${E2E_USER_ID}&select=id&commit_note=ilike.*harness*`,
  )) as unknown[];
  const leftoverW = (await pgRead(
    `watchlist?user_id=eq.${E2E_USER_ID}&select=id&display_name=ilike.*harness*`,
  )) as unknown[];
  const leftoverF = (await pgRead(
    `follows?user_id=eq.${E2E_USER_ID}&select=id&display_name=ilike.*harness*`,
  )) as unknown[];
  expect(
    [leftover.length, leftoverW.length, leftoverF.length],
    "no harness-marked row may survive cleanup, in any of the three tables",
  ).toEqual([0, 0, 0]);
});

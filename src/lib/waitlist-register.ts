/**
 * Shared, server-side waitlist registration.
 *
 * ONE place that every non-approved auth path delegates to so the allowlist
 * check and the waitlist upsert never get duplicated or drift between the OAuth
 * callback and the email/password paths.
 *
 * This does NOT send the confirmation email. Sending is deliberately deferred to
 * /auth/callback (proven email ownership) so that entering a third party's
 * address at signup cannot cause us to email them. registerWaitlist only ever
 * captures the row (allowlist check + non-approved upsert).
 *
 * Given an email (and optional name/source):
 *  - checks isAllowlisted against the beta_allowlist. If approved, returns
 *    { approved: true } and does nothing else (never touches the waitlist).
 *  - if NOT approved, upserts the row into public.waitlist tolerating the
 *    unique-email conflict, capturing whether this was a NEW insert or an
 *    existing DUPLICATE, and returns { approved: false, duplicate: boolean }.
 *
 * Security: this only ever ADDS a non-approved email to the waitlist or reports
 * approved. It never admits anyone and never emails anyone. Runs with the
 * service role because public.waitlist is RLS-locked to service_role. Never
 * import this from the client; call it via /api/waitlist/register instead.
 *
 * Fails closed: if the service client is unavailable or the allowlist read
 * errors, the email is treated as NON-approved (isAllowlisted already fails
 * closed), so no one is admitted by accident.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isAllowlisted } from "@/lib/allowlist";
import { EMPTY_COHORT, isEmptyCohort, type Cohort } from "@/lib/cohort";

export type WaitlistRegisterResult =
  | { approved: true }
  | { approved: false; duplicate: boolean };

export interface WaitlistRegisterInput {
  email: string;
  name?: string | null;
  source?: string;
  /**
   * Signup attribution. Optional and always fail-open: a missing or unparseable
   * cohort must never block a registration. See src/lib/cohort.ts.
   */
  cohort?: Cohort;
}

/**
 * Service-role Supabase client for the allowlist read and the waitlist upsert.
 * public.waitlist is RLS-locked to service_role, so the insert needs this key.
 * Returns null if the env is absent (caller then fails closed).
 */
function makeServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return error.code === "23505" || /duplicate/i.test(error.message ?? "");
}

/**
 * True when the failure is "that column does not exist".
 *
 * The cohort columns arrive via a migration that is deliberately left UNAPPLIED
 * (backend/migrations/UNAPPLIED-2026-08-28-signup-cohort-capture.sql), so this
 * code ships BEFORE the schema does. Without this guard, every waitlist insert
 * would fail the moment this deploys, which would be a live signup outage
 * caused by an analytics feature. Instead the insert retries without the cohort
 * fields, so capture silently no-ops until a human runs the migration.
 *
 * 42703 is the Postgres undefined_column code; PGRST204 is PostgREST's schema
 * cache reporting an unknown column.
 */
function isMissingColumn(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /column .* does not exist|could not find the '.*' column/i.test(
      error.message ?? "",
    )
  );
}

export async function registerWaitlist(
  input: WaitlistRegisterInput,
): Promise<WaitlistRegisterResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.name ?? null;
  const source = input.source ?? "waitlist_register";
  const cohort = input.cohort ?? EMPTY_COHORT;

  const admin = makeServiceClient();
  if (!admin) {
    // No service role: cannot verify or insert. Fail closed as non-approved so
    // we never admit anyone; there is nothing safe to write here.
    console.error(
      "[waitlist-register] service role env missing; failing closed as non-approved",
    );
    return { approved: false, duplicate: false };
  }

  // Approved users flow exactly as before: never touched by the waitlist.
  const approved = await isAllowlisted(admin, email);
  if (approved) {
    return { approved: true };
  }

  // Non-approved: upsert into the waitlist, capturing new vs duplicate.
  //
  // FIRST TOUCH WINS for the cohort. This is an insert that tolerates the
  // unique-email conflict, not an update, so a returning visitor keeps the
  // cohort captured on their first visit. That is deliberate; see the header of
  // src/lib/cohort.ts.
  const baseRow = { email, name, source };
  const cohortRow = isEmptyCohort(cohort)
    ? baseRow
    : {
        ...baseRow,
        cohort_source: cohort.source,
        cohort_institution: cohort.institution,
        cohort_batch: cohort.batch,
      };

  let duplicate = false;
  let { error: insertError } = await admin.from("waitlist").insert(cohortRow);

  // Schema not migrated yet: retry without the cohort fields so a signup is
  // never lost to an unapplied analytics migration.
  if (insertError && cohortRow !== baseRow && isMissingColumn(insertError)) {
    console.warn(
      "[waitlist-register] cohort columns absent; retrying without attribution. " +
        "Apply backend/migrations/UNAPPLIED-2026-08-28-signup-cohort-capture.sql to enable capture.",
    );
    ({ error: insertError } = await admin.from("waitlist").insert(baseRow));
  }

  if (insertError) {
    if (isUniqueViolation(insertError)) {
      duplicate = true;
    } else {
      // Do not block on an unexpected insert error; the row (if any) still
      // stands and the caller decides the redirect. No email is sent here.
      console.error(
        "[waitlist-register] waitlist insert error:",
        insertError.message,
      );
    }
  }

  // No email here. Sending is deferred to /auth/callback (proven ownership).
  return { approved: false, duplicate };
}

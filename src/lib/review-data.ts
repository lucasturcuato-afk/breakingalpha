import type { SupabaseClient } from "@supabase/supabase-js";
import { scoredCallProps, type CallOutcomeRow } from "./scored-object-map";
import { RESOLUTION_BY_STATE, type Resolution } from "./verdict-vocabulary";
import { sessionDatePt, todayPt } from "./session-date";
import { COMMIT_NOTES_BEGAN_PT } from "@/components/review/notes-began";
import type { OutcomeState } from "@/components/ledger/claim-anatomy";
import type { ReviewData, ReviewNote } from "@/components/review/fixture";

/**
 * review-data - the read path behind the mobile Review screen.
 *
 * Review is build step 4, the moment one of the reader's own calls resolves.
 * It shows ONE claim: the reader's most recently graded one.
 *
 * WHAT IT READS
 *   user_claims           the reader's own calls, including `commit_note` and
 *                         `commit_note_at`.
 *   user_claim_outcomes   how those calls resolved, written by the attribution
 *                         grader.
 *
 * Both are RLS-scoped, so they are read through the caller's cookie-backed
 * client and the database, not this file, decides what the reader may see.
 *
 * ONLY THE READER'S OWN OUTCOME ROWS ARE READ. A claim adopted from the desk is
 * graded over its own window, so the desk's verdict answers a different
 * question and never appears here. That is the rule `src/lib/claim-outcome.ts`
 * enforces by construction, and this read does not go around it: it never
 * loads `morning_brief_call_outcomes` at all.
 *
 * WHAT IT REFUSES TO DO
 *
 * Nothing is averaged, divided, scored or counted. Every field it produces is
 * a value copied off a real row or a word from the closed four-word
 * vocabulary. The closing paragraph the design draws at prototype line 512 is
 * always null, because nothing in this repo generates prose about a reader's
 * reasoning and a screen that made one up would be inventing the reader's
 * motives back at them.
 *
 * THE TIMESTAMP RULE, WHICH IS THE POINT OF THIS FILE
 *
 * The note eyebrow renders `commit_note_at`, the moment the NOTE was written.
 * NEVER `created_at`, the moment the row was made. Ruled by Noah on 2026-08-25
 * in `sql/proposals/0033_user_claim_commit_note.sql`.
 *
 * `created_at` IS read here, for exactly one purpose that is not a timestamp:
 * deciding whether a null note is history or an absence. It is converted to a
 * boolean before it leaves this file. `ReviewData` has no date field it could
 * be smuggled through and the screen never sees it, so the fallback the ruling
 * forbids is structurally unavailable rather than merely avoided.
 */

/** The lifecycle the screen paints. Mirrors `ReviewStage` in review-screen. */
export type ReviewStage = "ready" | "loading" | "error" | "empty";

export interface ReviewLoad {
  /** Null in every state that has nothing to draw. Never a stand-in. */
  data: ReviewData | null;
  stage: ReviewStage;
}

/** Rows read for the reader's own calls. The newest resolution is picked here. */
const CLAIM_LIMIT = 100;

interface ClaimRow {
  id: string;
  user_claim: string | null;
  claim_type: string | null;
  target_symbol: string | null;
  created_at: string | null;
  commit_note?: string | null;
  commit_note_at?: string | null;
}

interface OutcomeRow {
  claim_id: string;
  verdict: string | null;
  attribution: string | null;
  actual_pct_change: number | null;
  actual_direction: string | null;
  verdict_notes: string | null;
  graded_at: string | null;
  metadata: unknown;
}

/**
 * The shared four-word vocabulary, reached through the same table the Ledger,
 * the desk record and the reader's own record already bucket through. A second
 * literal mapping is how two surfaces start disagreeing about what "supported"
 * means.
 */
const OUTCOME_BY_RESOLUTION: Record<Resolution, OutcomeState> = {
  supported: "supported",
  challenged: "challenged",
  noCleanRead: "developing",
  notGraded: "awaiting",
};

const CLAIM_COLUMNS = "id, user_claim, claim_type, target_symbol, created_at";
const NOTE_COLUMNS = "commit_note, commit_note_at";

/**
 * Postgres 42703 is "column does not exist"; PostgREST reports the same
 * condition as PGRST204 through its schema cache. Both are checked, plus a
 * message fallback for clients that surface neither code.
 *
 * `src/lib/commit-note.ts` carries the canonical version of this on the write
 * side. The two should be folded together once that lands; duplicating four
 * lines is better than this file importing a module that does not exist on
 * this branch.
 */
function isMissingNoteColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  const msg = error.message ?? "";
  return /commit_note/.test(msg) && /does not exist|could not find/i.test(msg);
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * "Thursday, August 27" in PT, from an outcome row's `graded_at`.
 *
 * Pacific rather than the server's UTC, matching every other date this product
 * shows. A grade written at 5pm PT is still that session.
 */
function gradedDayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
}

/**
 * "2026-08-06 06:58 PT", the design's own format at prototype line 508.
 *
 * THE ONLY CALLER PASSES `commit_note_at`. It takes a bare string rather than a
 * row so there is no shape through which a different column could arrive.
 */
function noteWrittenLabel(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Los_Angeles",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour")}:${get("minute")}`;
  return `${date} ${time} PT`;
}

/**
 * The reader's most recent resolution, or the state that explains why there is
 * none.
 *
 * Failure and emptiness are kept apart deliberately. A failed query rendered as
 * "no call of yours has resolved yet" would tell a reader their record is empty
 * on the strength of an outage, which is the one thing this screen must never
 * do: a resolution that fails to load reads as a resolution that did not
 * happen.
 */
export async function loadReview(supabase: SupabaseClient, userId: string): Promise<ReviewLoad> {
  /* The note columns are selected with the claim, and a schema that does not
     carry them yet is a FAILED NOTE READ rather than a failed screen. The
     retry drops only the two note columns, so the resolution above the note
     still renders and only the note block says it could not be read. */
  const selectClaims = (columns: string) =>
    supabase
      .from("user_claims")
      .select(columns)
      .eq("user_id", userId)
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(CLAIM_LIMIT);

  let noteReadFailed = false;
  let claimRows: unknown[] | null = null;
  let claimError: { code?: string; message?: string } | null = null;

  {
    const first = await selectClaims(`${CLAIM_COLUMNS}, ${NOTE_COLUMNS}`);
    if (first.error && isMissingNoteColumn(first.error)) {
      noteReadFailed = true;
      const retry = await selectClaims(CLAIM_COLUMNS);
      claimRows = retry.data;
      claimError = retry.error;
    } else {
      claimRows = first.data;
      claimError = first.error;
    }
  }

  if (claimError) return { data: null, stage: "error" };

  const claims = ((claimRows ?? []) as ClaimRow[]).filter((c) => asText(c.user_claim));
  if (claims.length === 0) return { data: null, stage: "empty" };

  const { data: outcomeData, error: outcomeError } = await supabase
    .from("user_claim_outcomes")
    .select(
      "claim_id, verdict, attribution, actual_pct_change, actual_direction, verdict_notes, graded_at, metadata",
    )
    .in(
      "claim_id",
      claims.map((c) => c.id),
    )
    .order("graded_at", { ascending: false });

  if (outcomeError) return { data: null, stage: "error" };

  /* Newest row per claim, then the newest of those. There is no unique
     constraint on claim_id, so "the latest grade" has to be resolved rather
     than assumed from row order. */
  const byClaim = new Map<string, OutcomeRow>();
  for (const row of (outcomeData ?? []) as OutcomeRow[]) {
    if (!row.graded_at) continue;
    const prev = byClaim.get(row.claim_id);
    if (!prev || (row.graded_at ?? "") > (prev.graded_at ?? "")) byClaim.set(row.claim_id, row);
  }

  let newest: { claim: ClaimRow; outcome: OutcomeRow } | null = null;
  for (const claim of claims) {
    const outcome = byClaim.get(claim.id);
    if (!outcome?.graded_at) continue;
    if (!newest || outcome.graded_at > (newest.outcome.graded_at ?? "")) {
      newest = { claim, outcome };
    }
  }

  /* The read answered and nothing of the reader's has resolved. That is an
     empty result, not a failure, and the two render differently. */
  if (!newest) return { data: null, stage: "empty" };

  return { data: toReviewData(newest.claim, newest.outcome, noteReadFailed), stage: "ready" };
}

/** One claim and its own outcome row, mapped to what the screen draws. */
function toReviewData(claim: ClaimRow, outcome: OutcomeRow, noteReadFailed: boolean): ReviewData {
  const today = todayPt();
  const gradedAt = outcome.graded_at as string;

  const props = scoredCallProps(
    {
      claim_text: claim.user_claim as string,
      target_symbol: claim.target_symbol,
      claim_type: claim.claim_type,
      created_at: claim.created_at,
      brief_date: null,
    },
    {
      call_id: claim.id,
      verdict: outcome.verdict ?? "",
      attribution: (outcome.attribution ?? null) as CallOutcomeRow["attribution"],
      actual_pct_change: outcome.actual_pct_change,
      actual_direction: outcome.actual_direction as CallOutcomeRow["actual_direction"],
      verdict_notes: outcome.verdict_notes,
      graded_at: gradedAt,
      metadata: (outcome.metadata ?? null) as CallOutcomeRow["metadata"],
    },
    today,
  );

  /* The grader's own lines. `attribution` is the benchmark sentence; the
     not-graded reason stands in for it when there is no credible grade, which
     is an absence stated plainly rather than a verdict. `calibration` is
     verdict_notes. Neither is written here. */
  const result = asText(props.attribution) ?? asText(props.notGradedReason);
  const reading = asText(props.calibration);

  /* Overnight means the grade landed on the session before this one. The
     design asserts it unconditionally; a three-week-old grade did not land
     overnight and the screen does not say it did. */
  const gradedSession = sessionDatePt(new Date(gradedAt));
  const overnight = gradedSession !== today && daysBetween(gradedSession, today) <= 1;

  return {
    resolvedAt: { overnight, day: gradedDayLabel(gradedAt) },
    state: OUTCOME_BY_RESOLUTION[RESOLUTION_BY_STATE[props.state]],
    claim: claim.user_claim as string,
    result,
    reading,
    note: resolveNote(claim, noteReadFailed),
    predatesNotes: predatesNotes(claim.created_at),
    /* Prototype line 512 has no source and is never invented. */
    meaning: null,
  };
}

/** Whole days between two PT session dates. Both are `YYYY-MM-DD`. */
function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.abs(b - a) / 86_400_000;
}

/**
 * The note, in the three states the read can be in.
 *
 * A note with no timestamp keeps the note and loses the time. The eyebrow then
 * reads "YOU WROTE" with nothing after it. The alternative, reaching for
 * `created_at`, is the exact fallback the ruling forbids: a real-looking
 * timestamp above a note whose own timestamp does not exist.
 */
function resolveNote(claim: ClaimRow, noteReadFailed: boolean): ReviewNote | null | "failed" {
  if (noteReadFailed) return "failed";
  const text = asText(claim.commit_note);
  if (!text) return null;
  const at = asText(claim.commit_note_at);
  return { text, writtenAt: at ? noteWrittenLabel(at) : null };
}

/**
 * Was this claim taken before commit notes existed at all.
 *
 * The ONE use of `created_at` in this file, and it produces a boolean rather
 * than a date. Every claim adopted before the column was applied has a
 * permanently null note and there is no backfill, because nothing recorded
 * when those notes would have been written. That is history, and the screen
 * draws it as history rather than as a value that failed to load.
 *
 * A row with no creation date at all is NOT assumed to be historic. Absence of
 * evidence is not evidence, and the milder sentence is the one that claims
 * less.
 */
function predatesNotes(createdAt: string | null): boolean {
  const iso = asText(createdAt);
  if (!iso) return false;
  const created = new Date(iso);
  if (Number.isNaN(created.getTime())) return false;
  return sessionDatePt(created) < COMMIT_NOTES_BEGAN_PT;
}

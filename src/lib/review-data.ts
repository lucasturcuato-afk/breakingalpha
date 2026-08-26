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

/**
 * How many of the reader's newest VERDICT rows are read.
 *
 * Not a cap on the record and nothing is counted over it. The query already
 * excludes every row that carries no verdict, so the first row is the answer;
 * this exists only so a row the mapper still rejects has somewhere to fall
 * through to.
 */
const VERDICT_SCAN = 5;

interface ClaimRow {
  id: string;
  user_claim: string | null;
  claim_type: string | null;
  target_symbol: string | null;
  created_at: string | null;
  commit_note?: string | null;
  commit_note_at?: string | null;
}

/** An outcome row with its claim embedded, which is the shape the read gives back. */
interface JoinedOutcomeRow extends OutcomeRow {
  user_claims: ClaimRow | null;
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
  /* The caller has already rejected an unparseable stamp, so this cannot
     render "Invalid Date". Kept symmetrical with `noteWrittenLabel`, which
     guards for the same reason: the two formatters are read side by side and
     an asymmetry between them invites the wrong conclusion about which one is
     safe. */
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
  /* THE READ IS DRIVEN FROM THE OUTCOME SIDE, and that is the whole of why the
     empty state is allowed to say what it says.

     It used to read the reader's newest 100 claims and then look for outcome
     rows among those. Two things were wrong with that and both reached the
     screen. A cap on claims makes "No call on your record has resolved yet." a
     statement about a window rather than about the record, and the window was
     ordered by creation date, which selects the claims LEAST likely to have
     closed. A reader past the cap would have been told their record was empty
     over a verdict the query never looked at.

     Starting from `user_claim_outcomes` removes the cap entirely: a reader with
     no row here has no verdict, full stop. RLS on that table is ownership
     scoped through `user_claims` (sql/0012:95-105), so the embedded filter is a
     narrowing of what the database would allow anyway and never a substitute
     for it.

     UNGRADABLE ROWS ARE FILTERED OUT IN THE QUERY, and this is not tidying.
     `backend/grading/grade_user_claims.py` writes an outcome row for the
     ungradable path too, with `graded_at` NOT NULL, so those rows are a normal
     product of every run and they are the majority in production today. They
     carry no verdict: `scoredCallProps` maps `verdict = 'ungradable'` and a null
     attribution to `notGraded`, which this file buckets as `awaiting`. Selecting
     one would have drawn the word "Awaiting" under the line "resolved
     overnight", which is a resolution the grader explicitly declined to make,
     and it would have hidden the reader's real most recent verdict behind it
     whenever the ungradable row happened to be newer.

     The two filters mirror the only two conditions under which the mapper
     yields an absence rather than a verdict. The walk below re-checks against
     the mapper anyway, so the mapper stays the authority on what counts as a
     verdict and this query stays an optimization of it. */
  const OUTCOME_COLUMNS =
    "claim_id, verdict, attribution, actual_pct_change, actual_direction, verdict_notes, graded_at, metadata";

  const selectVerdicts = (claimColumns: string) =>
    supabase
      .from("user_claim_outcomes")
      .select(`${OUTCOME_COLUMNS}, user_claims!inner(${claimColumns})`)
      .eq("user_claims.user_id", userId)
      .neq("user_claims.status", "archived")
      .neq("verdict", "ungradable")
      .not("attribution", "is", null)
      .order("graded_at", { ascending: false })
      .limit(VERDICT_SCAN);

  /* The note columns ride along with the claim, and a schema that does not
     carry them yet is a FAILED NOTE READ rather than a failed screen. The retry
     drops only those two columns, so the resolution still renders and only the
     note block says it could not be read. */
  let noteReadFailed = false;
  let rows: unknown[] | null = null;
  let readError: { code?: string; message?: string } | null = null;

  {
    const first = await selectVerdicts(`${CLAIM_COLUMNS}, ${NOTE_COLUMNS}`);
    if (first.error && isMissingNoteColumn(first.error)) {
      noteReadFailed = true;
      const retry = await selectVerdicts(CLAIM_COLUMNS);
      rows = retry.data;
      readError = retry.error;
    } else {
      rows = first.data;
      readError = first.error;
    }
  }

  if (readError) return { data: null, stage: "error" };

  /* Newest first, straight off the query. The scan exists so a row the mapper
     rejects has somewhere to fall through to; it is not a cap on the record,
     because a reader with any verdict at all has one in the newest few. */
  for (const raw of (rows ?? []) as JoinedOutcomeRow[]) {
    const claim = raw.user_claims;
    if (!claim || !asText(claim.user_claim)) continue;
    if (!raw.graded_at || Number.isNaN(new Date(raw.graded_at).getTime())) continue;

    const data = toReviewData(claim, raw, noteReadFailed);
    /* The mapper, not this file, decides what a verdict is. `awaiting` means it
       found none, and the filters above should already have excluded every row
       that produces it. A row that reaches here and still maps to an absence is
       skipped rather than drawn, because "resolved" over "Awaiting" is the
       screen asserting something no grader said. */
    if (data.state === "awaiting") continue;
    return { data, stage: "ready" };
  }

  /* The read answered and no row of the reader's records a verdict. That is an
     empty result, not a failure, and the two render differently. */
  return { data: null, stage: "empty" };
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
      /* Deliberately null, and it is not laziness. `openCallProps` turns
         `created_at` into a `calledDate` this screen does not read, and the
         only creation date Review is allowed to touch is the one
         `predatesNotes` converts to a boolean. Passing null here leaves
         exactly one reader of that column in this file rather than two, so the
         containment is a property of the code and not of what a later edit
         remembers not to render. */
      created_at: null,
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
     overnight and the screen does not say it did.

     Strictly EARLIER than today, so a grade stamped ahead of the current
     session cannot read as having happened while the reader was away. */
  const gradedSession = sessionDatePt(new Date(gradedAt));
  const overnight = gradedSession < today && daysBetween(gradedSession, today) <= 1;

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
 *
 * The comparison is strict, so a claim written on 2026-08-25 itself reads as an
 * ordinary absence rather than as history. The column was applied by hand part
 * way through that session and nothing records at what hour, so rows from that
 * one day cannot be told apart. The milder sentence is again the one that
 * claims less: "Nothing was written with this call" is true of every row on
 * that day, while the history sentence would be true of only some of them.
 */
function predatesNotes(createdAt: string | null): boolean {
  const iso = asText(createdAt);
  if (!iso) return false;
  const created = new Date(iso);
  if (Number.isNaN(created.getTime())) return false;
  return sessionDatePt(created) < COMMIT_NOTES_BEGAN_PT;
}

import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell";
import { ReviewScreen, type ReviewStage } from "@/components/review";
import { REVIEW_FIXTURE, type ReviewData } from "@/components/review/fixture";
import { mobileFixtureScreensEnabled } from "@/lib/mobile-fixture-gate";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { loadReview } from "@/lib/review-data";

/**
 * Review, build step 4, at its own new route.
 *
 * WIRED. `src/lib/review-data.ts` reads the signed-in reader's own claims and
 * their own outcome rows and gives back the reader's most recent resolution.
 * Nothing on this screen is invented for a signed-in reader in any
 * environment.
 *
 * WHAT IS REAL TODAY, and it is worth being exact, because the screen's whole
 * subject is only half present in the database:
 *
 *   the resolution   REAL. `user_claim_outcomes`, written by the attribution
 *                    grader. Verdict, benchmark line, grader's reading, date.
 *   the claim        REAL. `user_claims.user_claim`, verbatim.
 *   the note         REAL COLUMN, NO ROWS. `commit_note` and `commit_note_at`
 *                    exist in production and every claim's note is null. The
 *                    write path that fills them is the Commit sheet, build
 *                    step 3, which is not merged. So every real render of this
 *                    screen today draws the honest-empty note case, which is
 *                    the case most of the data will be in forever.
 *   the closing well REAL ABSENCE. Prototype line 512 is prose about a
 *                    reader's own reasoning and nothing generates it. Always
 *                    null, so the well never draws.
 *
 * THE TIMESTAMP IS RULED. The note eyebrow renders `commit_note_at` and never
 * `created_at`. See `sql/proposals/0033_user_claim_commit_note.sql` and the
 * loader's header for the reasoning and for how the fallback is made
 * structurally unavailable rather than merely avoided.
 *
 * NOT an edit to any Radar route and not an edit to the adopt route. The read
 * path is this file plus `src/lib/review-data.ts`; the write path belongs to
 * the Commit sheet unit and is untouched here.
 *
 * Server component, so the read happens before a byte of the screen is sent,
 * `@supabase/supabase-js` stays out of this route's client bundle, and the
 * sample content is resolved on the server rather than shipped to it.
 *
 * SECOND AUTH GATE, IN THE PAGE BODY, on the precedent `/intelligence`,
 * `/settings/preferences`, `/onboarding` and `/company/[id]` already set.
 * `src/proxy.ts` opens `/review` in dev and preview so the parity, audit and
 * smoke runs can drive it, and this screen has nothing whatever to show a
 * visitor with no record. A signed-out visitor is sent to `/auth` rather than
 * shown an empty state that would be a sentence about a reader who is not
 * there. The redirect is skipped only where the sample content is already
 * allowed, matching the proxy's own condition.
 */

/**
 * `?stage=` selects a lifecycle state for the audit, and only where the sample
 * content is allowed. With a real query behind the screen there is no way to
 * make it fail or come back empty on demand, and the states still have to be
 * reachable. With no `?stage=`, dev reads the same live record production
 * does, so the two cannot look different to whoever is checking.
 *
 * `stale` is not a screen stage and is not in `ReviewStage`. A resolution does
 * not go stale; it is the record. What can be true is that the grade did not
 * land overnight, and that is carried on the date line rather than as a state.
 * The selector renders the ready screen with that flag off so the phrasing is
 * observable.
 */
const STAGE_SELECTORS = ["ready", "loading", "error", "empty", "stale"] as const;
type StageSelector = (typeof STAGE_SELECTORS)[number];

/**
 * `?note=` selects one of the note read's outcomes, same gate.
 *
 *   written   a note with its own `commit_note_at`.
 *   undated   a note whose `commit_note_at` is null. The eyebrow drops the
 *             time rather than borrowing `created_at`.
 *   historic  no note, on a claim taken before the column existed. The
 *             permanent case for every claim adopted before 2026-08-25.
 *   none      no note, on a claim taken after it.
 *   failed    the note read answered with an error.
 */
const NOTE_SELECTORS = ["written", "undated", "historic", "none", "failed"] as const;
type NoteSelector = (typeof NOTE_SELECTORS)[number];

function pick<T extends string>(
  raw: string | string[] | undefined,
  allowed: readonly T[],
): T | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return allowed.includes(value as T) ? (value as T) : null;
}

/** The sample resolution, with one note outcome selected. */
function sampleWithNote(note: NoteSelector): ReviewData {
  const base: ReviewData = { ...REVIEW_FIXTURE };
  if (note === "failed") return { ...base, note: "failed" };
  if (note === "historic") return { ...base, note: null, predatesNotes: true };
  if (note === "none") return { ...base, note: null, predatesNotes: false };
  if (note === "undated") {
    const written = base.note;
    return {
      ...base,
      note: written === null || written === "failed" ? null : { ...written, writtenAt: null },
    };
  }
  return base;
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string | string[]; note?: string | string[] }>;
}) {
  const params = await searchParams;
  const requestedStage: StageSelector | null = pick(params.stage, STAGE_SELECTORS);
  const requestedNote: NoteSelector | null = pick(params.note, NOTE_SELECTORS);

  const { supabase, user } = await getSupabaseWithUser();

  /* THE GATE IS RESOLVED HERE and the result is passed down. The screen has no
     default and no `??` fallback, so a deleted gate is a type error rather
     than an invented resolution in front of a reader.

     `redirect` never yields to the next statement, so below this block `user`
     is known non-null on the loader path without an assertion. */
  let stage: ReviewStage;
  let data: ReviewData | null;

  if (user === null) {
    if (!mobileFixtureScreensEnabled()) redirect("/auth");
    const selector: StageSelector = requestedStage ?? "ready";
    stage = selector === "stale" ? "ready" : selector;
    /* The three states that have nothing to draw draw nothing. */
    if (stage !== "ready") {
      data = null;
    } else {
      const sample = sampleWithNote(requestedNote ?? "written");
      data =
        selector === "stale"
          ? { ...sample, resolvedAt: { ...sample.resolvedAt, overnight: false } }
          : sample;
    }
  } else {
    const loaded = await loadReview(supabase, user.id);
    stage = loaded.stage;
    data = loaded.data;
  }

  return (
    <AppShell pageTitle="Review" mobileFullBleed>
      {/* Gated on the same breakpoint the shell uses to swap the sidebar for
          the tab bar, and gated in a CLASS: an inline display beats the class
          at every breakpoint, which is the defect design-lint rule 10 exists
          to catch.

          `h-full` is load bearing. The screen root carries `minHeight: 100%`
          and a footer that does not scroll, both of which resolve against this
          wrapper. Without it the percentage resolves to nothing, the footer
          stops being pinned, and a short screen ends at its content height
          with the shell's parchment showing below the espresso. */}
      <div className="md:hidden h-full">
        <ReviewScreen
          stage={stage}
          data={data}
          /* Null on this branch. `goEntry` in the prototype targets the Entry
             screen, build step 6, reserved at `/entry` and not built yet. A
             control pointing at a 404 is worse than one that is absent. */
          entryHref={null}
        />
      </div>

      {/* Above the breakpoint this route has no layout of its own. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: "500 17px/1.4 var(--font-playfair-display), serif", color: "var(--c-ink)" }}>
          Review is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: "400 13px/1.6 var(--font-inter), sans-serif", color: "var(--c-secondary)" }}>
          On a wider screen your resolved calls sit on your record rather than in a set piece.
        </p>
      </div>
    </AppShell>
  );
}

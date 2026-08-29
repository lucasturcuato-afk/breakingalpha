import {
  DEFAULT_ADOPT_HORIZON,
  HORIZON_LABEL,
  HORIZON_PHRASE,
  HORIZON_TYPES,
  adoptWindowForCall,
  adoptWindowPhrase,
  adoptWindowValue,
  horizonLabelForDays,
  resolveAdoptWindow,
  type AdoptWindow,
  type HorizonType,
} from "@/lib/call-horizons";
import { COMMIT_NOTE_MAX, COMMIT_NOTE_MIN } from "@/components/commit/commit-target";

/**
 * Compose's SHAPE, its caps, its horizons and its date helpers. No content.
 *
 * Split out of `./fixture` so the client component can reach all of this
 * without pulling the sample draft, the sample note and the two invented
 * proposals into the browser bundle. A `"use client"` module that value-imports
 * from `./fixture` downloads every string in it: the gate stops the render, not
 * the download, so the invented NVDA proposal reached `.next/static` even on a
 * production build where `?stage=` cannot select it.
 *
 * Nothing in this file states a fact about a market or a reader. The only
 * numbers are two character caps, two design minimums and one fixed anchor
 * date. That is the property that makes it safe on both sides of the boundary,
 * and it is the property to check before adding anything to it.
 */

/**
 * The anchor the FIXTURE's two sample proposals are dated from.
 *
 * FIXTURE ONLY. It used to be the anchor every window on this screen was
 * measured from, and that was safe exactly as long as the screen wrote
 * nothing. It is not safe now. `/api/radar/claims` POST requires
 * `resolution_window_end > todayIso`, so a wired screen resolving its window
 * off a date in the past sends a window that has already closed, and every
 * write comes back `gradeable: false` while looking to the reader as though it
 * worked. The live window is resolved from `sessionIso`, a required prop the
 * server page supplies from `todayPt()`, the same way `src/lib/ledger-data.ts`
 * supplies it to /ledger and `commit-target.ts` documents for the sheet.
 *
 * What survives of the original argument: a sample proposal must not read the
 * wall clock, or `src/components/compose/fixture.ts` stops matching itself a
 * day later. 2026-08-06 is the date PR #643 quotes on the Review screen for
 * the same draft.
 */
export const COMPOSE_ANCHOR_ISO = "2026-08-06";

/** The claim routes cap a claim at 400 characters. Mirrored, not guessed. */
export const MAX_CLAIM_CHARS = 400;

/**
 * The note's floor and ceiling, RE-EXPORTED rather than restated.
 *
 * Both numbers live in `@/components/commit/commit-target`, which is pure and
 * imports nothing, so a client screen and a server route can each reach them
 * without reaching each other. They were literals here, and a second copy of
 * either is how a field starts disagreeing with the column behind it: the
 * ceiling is what `readCommitNote` slices at in both write routes, and the
 * floor is what the commit sheet unlocks on. One ruling, one module.
 */
export const MAX_NOTE_CHARS = COMMIT_NOTE_MAX;

/** Characters of draft before the claim box reads as a claim. Design value. */
export const DRAFT_MIN_CHARS = 24;

/** Characters of note before the commit control unlocks. See above. */
export const NOTE_MIN_CHARS = COMMIT_NOTE_MIN;

export type Direction = "bullish" | "bearish" | "neutral";

/**
 * The lifecycle states Compose can be in.
 *
 * Lives here rather than beside the component because the route reads it, and
 * a value exported from a "use client" module arrives on the server as a
 * client reference rather than as the array itself.
 */
export type ComposeStage =
  | "empty"
  | "analyzing"
  | "gradeable"
  | "context"
  | "analyze-error"
  | "saving"
  | "save-error"
  | "committed"
  | "committed-context";

export const COMPOSE_STAGES: ComposeStage[] = [
  "empty",
  "analyzing",
  "gradeable",
  "context",
  "analyze-error",
  "saving",
  "save-error",
  "committed",
  "committed-context",
];

export interface ComposeAlternative {
  claim_type: string;
  target_symbol: string;
  expected_direction: Direction;
  resolution_window_start: string;
  resolution_window_end: string;
  rationale: string;
}

/**
 * A read-back, as the screen keeps it.
 *
 * CARRIES TWO FIELDS THE SCREEN NEVER RENDERS, and that is deliberate.
 * `evidence_entities` and `confidence_in_reduction` are produced by
 * `/api/radar/claims/author` and accepted by the `/api/radar/claims` insert,
 * and while this was a presentation unit they were left out of this type on
 * the grounds that nothing drew them. The moment the screen writes, dropping
 * them stops being tidiness and becomes data loss: every authored claim would
 * store an empty array and a null for values the model actually produced.
 * So they are carried and forwarded, and still not rendered.
 */
export interface ComposeProposal {
  claim_type: string;
  target_symbol: string | null;
  expected_direction: Direction | null;
  resolution_window_start: string | null;
  resolution_window_end: string | null;
  /** Entities the claim references. Carried through the write, never drawn. */
  evidence_entities: string[];
  /**
   * The model's confidence that its REDUCTION is faithful, 0 to 1, or null.
   * Never a probability of the call being right and never rendered as one.
   * Carried through the write so the stored row keeps what the route produced.
   */
  confidence_in_reduction: number | null;
  gradeable: boolean;
  gradeability_note: string | null;
  gradeable_alternative: ComposeAlternative | null;
}

/**
 * The horizons Compose offers.
 *
 * `session` is dropped because `/api/radar/claims` POST line 169 requires
 * `windowEnd > todayIso`, so a same-day window is refused by the server that
 * would have to grade it. Every other member of HORIZON_TYPES is offered,
 * including `week`, which is DEFAULT_ADOPT_HORIZON. See the PR body.
 */
export const COMPOSE_HORIZONS: HorizonType[] = HORIZON_TYPES.filter(
  (t) => t !== "session",
);

export const COMPOSE_DEFAULT_HORIZON: HorizonType = DEFAULT_ADOPT_HORIZON;

/**
 * THE DESK'S OWN WINDOW, KEPT.
 *
 * `/api/radar/claims/author` instructs the model to INFER a span from the
 * claim: 1 to 3 days for a dated event, 5 to 10 for single-name news flow, 14
 * to 30 for a rotation, 45 to 90 for a structural thesis, and in the prompt's
 * own words "do not compress a long-dated thesis into a short window just to
 * resolve it sooner". Most of those numbers are not bucket day counts.
 *
 * The first wiring of this screen held the selection as a bare `HorizonType`
 * and derived it with `horizonTypeFromDates`, which is exact-match and answers
 * null for anything off-bucket. Null fell back to the mount default, so a
 * 60-day structural claim was written as a 7-day window AND read back to its
 * author as "resolves in about a week". Seven of eleven measured spans were
 * wrong. `src/app/radar/calls/page.tsx` spreads the proposal verbatim and has
 * never had this bug; Compose was the only caller that discarded the span.
 *
 * `call-horizons.ts` already had the answer and names this exact failure in
 * its own comment: the selection is a UNION, not a bucket. `as-called` carries
 * the desk's real day count and is what an off-bucket proposal preselects. A
 * reader who then presses a chip overrides it, which is their decision and
 * still wins.
 *
 * One coercion of our own: a `session` bucket becomes as-called at one day.
 * COMPOSE_HORIZONS deliberately drops `session`, so a session selection would
 * leave the chip row with nothing lit, and the route refuses a same-day window
 * anyway. The author route cannot currently produce one (it enforces
 * `windowEnd > todayIso`), so this is a guard rather than a live path.
 */
export function composeWindowFor(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): AdoptWindow {
  const w = adoptWindowForCall(startIso, endIso);
  if (w.kind === "bucket" && w.type === "session") return { kind: "as-called", days: 1 };
  return w;
}

/**
 * The settlement date for a window, derived rather than transcribed.
 *
 * THE ANCHOR IS A PARAMETER, not a module constant, and it has to be. This
 * used to close over `COMPOSE_ANCHOR_ISO`, which meant the date the screen
 * showed a reader and the date a write would have resolved to were the same
 * fixed day in the past. The live screen passes its `sessionIso`; the fixture
 * passes `COMPOSE_ANCHOR_ISO`. Both callers say which day they mean.
 *
 * ONE function, used by the settles line, by the "Make it gradeable" label,
 * and by the write. The date a reader agrees to cannot disagree with the date
 * the row carries, because there is nowhere for a second calculation to live.
 */
export function composeWindowEnd(anchorIso: string, w: AdoptWindow): string {
  return w.kind === "bucket"
    ? resolveAdoptWindow(anchorIso, w.type)
    : resolveAdoptWindow(anchorIso, COMPOSE_DEFAULT_HORIZON, w.days);
}

/** The settlement date for one bucket. The fixture's helper. */
export function settlementDate(anchorIso: string, horizon: HorizonType): string {
  return composeWindowEnd(anchorIso, { kind: "bucket", type: horizon });
}

/**
 * What the RESOLVES row offers: the desk's own span first when it is
 * off-bucket, then every named alternative. Mirrors `adoptWindowOptions`,
 * which cannot be used directly because it includes `session`.
 */
export function composeWindowChoices(current: AdoptWindow): AdoptWindow[] {
  const buckets: AdoptWindow[] = COMPOSE_HORIZONS.map((type) => ({ kind: "bucket", type }));
  return current.kind === "as-called" ? [current, ...buckets] : buckets;
}

/** A stable identity for one choice, for keying and for the pressed test. */
export function composeWindowKey(w: AdoptWindow): string {
  return adoptWindowValue(w);
}

/** The chip's visible text. Short, the way the design draws it. */
export function composeWindowLabel(w: AdoptWindow): string {
  return w.kind === "bucket" ? HORIZON_LABEL[w.type] : horizonLabelForDays(w.days);
}

/**
 * The same window said as a sentence fragment: the READ AS line, and the
 * accessible name of the chip. An off-bucket span states its real length
 * ("resolves in 45 days") rather than being rounded into a bucket it is not.
 */
export function composeWindowPhrase(w: AdoptWindow): string {
  return w.kind === "bucket" ? HORIZON_PHRASE[w.type] : adoptWindowPhrase(w);
}

/** ISO date as the screen states it. Fixed locale so a capture is stable. */
export function longDate(iso: string): string {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** What the composer opens on: a draft, a note and a proposal. */
export interface ComposeSeed {
  draft: string;
  note: string;
  proposal: ComposeProposal | null;
}

/**
 * A composer that has been given nothing. Two blank fields and no proposal,
 * which is what a real composer opens on and what production draws.
 *
 * Content-free on purpose. It is not a spread of anything in `./fixture` and
 * it asserts nothing: no claim, no instrument, no window, no note. This is the
 * value the screen falls to when the gate is shut, so it is the one constant
 * here that must never grow a sentence.
 */
export const EMPTY_SEED: ComposeSeed = { draft: "", note: "", proposal: null };

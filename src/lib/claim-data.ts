/**
 * claim-data - the read path behind `/claim/[id]`.
 *
 * WHY THIS IS A NEW FILE AND NOT A REUSE. Nothing existing gives back this
 * shape. `loadLedger` builds a whole-timeline payload keyed off TODAY's brief,
 * so reusing it would make a bookmarked claim resolvable only while it is still
 * in today's brief, which a bookmark is not. `loadReview` reads from the
 * outcome side. `fetchDeskRecord` reads only calls that already carry an
 * outcome. `your-record.ts` performs no read at all. What IS reused is the
 * select in `loadDeskCalls` (ledger-data.ts:452-509), narrowed to one row, plus
 * `eyebrowFor` from that same module, so the eyebrow rule cannot drift between
 * the card and the screen it opens.
 *
 * WHAT IT READS
 *   morning_brief_calls          the one call, by id. Public read.
 *   morning_brief_call_outcomes  how the desk graded it, if it has.
 *   user_claims                  whether this reader has already taken it onto
 *                                their own record. RLS-scoped, so the database
 *                                decides what the reader may see.
 *
 * THE OUTCOME READ IS NEW AND IT IS NOT A RESTORATION. What stood here before
 * selected `call_id` and nothing else: a bare existence probe, whose one job
 * was to decide whether to suppress the commit control. That probe was deleted
 * because the desk's window has no business deciding that; a commit opens the
 * READER's window today and grades on the reader's dates, and
 * `src/lib/commit-legality.ts` sets out the whole argument. This screen has
 * therefore never at any point held a verdict, an attribution or a metadata
 * blob, so nothing about the wider select below is a revert of that deletion.
 *
 * THE GUARDRAIL IS ONE LINE, and `tests/unit/claim-outcome-render-only.test.ts`
 * pins it:
 *
 *   THE OUTCOME MAY FEED THE RENDER. IT MAY NEVER FEED `variant`,
 *   `commitReason` OR THE `onTrack` GATE.
 *
 * That is structural rather than a promise. `commitLegality(row, today)` takes
 * the call and the date and has NO PARAMETER through which an outcome could
 * reach it. What PR 780 fixed was letting the outcome row decide the control;
 * reading the row was never the defect.
 *
 * A FAILED OUTCOME READ IS NOT AN UNGRADED CALL. It comes back as the literal
 * "unread" rather than as an absent grade, for the reason `radar-calls-data.ts`
 * hands its own list a null map: a surface that drew a failed read as an open
 * call would tell a reader nobody has looked at a call the desk settled weeks
 * ago.
 *
 * WHAT IT STILL CANNOT READ, and therefore what the screen still does not draw.
 * `sql/0003_brief_self_grading.sql:14-24`, plus 0013 and 0014, define
 * morning_brief_calls as id, brief_id, brief_date, claim_text, claim_type,
 * target_symbol, expected_direction, confidence, created_at, is_lead and
 * resolve_on. `backend/synthesize.py:1497-1518` writes exactly those. So:
 *
 *   the desk's reading      two paragraphs in the design. NO COLUMN. The row
 *                           stores the falsifiable sentence and nothing behind
 *                           it.
 *   what would settle it    NO COLUMN. There is no stored statement of what
 *                           would falsify the claim.
 *   confidence              A COLUMN, populated, and BARRED. It is an unguided
 *                           model self-report, never a grading input, and
 *                           `scored-object-map.ts` declines to render it on
 *                           every other surface. It is not selected here.
 *
 * MEASURED AGAINST HAS COME OFF THAT LIST, and it is the schema's reading that
 * changed rather than the schema. It was cut because the grader picks the
 * benchmark when it RUNS, so naming a pair beforehand would be this screen
 * predicting that choice out of a fourth copy of a map already duplicated three
 * times. AFTER GRADING IT IS NOT A PREDICTION: `metadata.benchmarks` names the
 * symbols the grader actually used and the move it actually measured. So the
 * block draws off the outcome row and is absent wherever there is none, which
 * is the honest shape of a value that is unavailable only BEFORE grading.
 *
 * It writes nothing, it makes no model call, and every field it cannot source
 * is null, which the screen draws as absence rather than as a stand-in.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutcomeState } from "@/components/ledger/claim-anatomy";
import { HORIZON_LABEL, daysBetween } from "./call-horizons";
import { commitLegality, commitWindow } from "./commit-legality";
import { eyebrowFor } from "./ledger-data";
import { mobileOutcomeState } from "./mobile-outcome-state";
import { briefResolutionSentence } from "./radar-calls-model";
import {
  scoredCallProps,
  type CallOutcomeMetadata,
  type CallOutcomeRow,
} from "./scored-object-map";
import { todayPt } from "./session-date";

/**
 * The lifecycle the screen paints. One definition, consumed by both the loader
 * and the view, rather than a view copy that can drift from the loader's.
 *
 *   ready        the call was read
 *   loading      the read is in flight
 *   error        the read failed, which is never drawn as emptiness
 *   missing      the read succeeded and there is no such call
 *
 * IT USED TO CARRY A SIXTH, `ungradeable`, which was not a lifecycle at all: it
 * was one of the reasons a commitment is not on offer, wearing a read-state
 * costume. Every such reason now travels on the variant beside the other four,
 * where they can be compared. See ClaimVariant.
 */
export type ClaimStage = "ready" | "loading" | "error" | "missing";

/**
 * Whether this reader can act on this call, resolved HERE rather than on the
 * screen, the way `loadLedger` resolves the card's own variant.
 *
 *   open         not on the reader's record, and the call supports a commitment
 *   onLedger     already on the reader's record
 *   ungradeable  the call itself cannot be committed to, whatever the reader
 *                does. `commitReason` says which of the three things is missing
 *
 * IT IS THE CARD'S OWN THREE, exactly, and that is the repair. It used to carry
 * five: `graded`, `windowClosed` and `noWindow` sat here as extra reasons the
 * control was withheld, and all three are facts about the DESK's window that
 * never reach the row a commit writes. They were the source of the contradiction
 * this screen shipped, where /claim printed "there is nothing left to commit to"
 * over the same call id /ledger successfully committed to. See
 * `src/lib/commit-legality.ts` for the read paths that settle it.
 *
 * What survived the deletion is the honest half of the old design: a control
 * that vanishes with no sentence leaves a reader unable to tell a settled call
 * from a broken one. So the loader still names the reason and the screen still
 * states it. There are simply three real reasons instead of six, and the Ledger
 * now states the same three.
 */
export type ClaimVariant = "open" | "onLedger" | "ungradeable";

/**
 * The desk's own side of the call: what it filed, over what window, and when
 * that window closes.
 *
 * EVERY FIELD IS LABELLED "DESK" ON THE SCREEN and that is the whole point of
 * the block. The complaint this answers is that "the desk graded this
 * Challenged" and "Track this call" sat 400px apart with nothing saying they
 * concern DIFFERENT WINDOWS. The reader's own window is `ClaimData.readerWindow`
 * below, stated beside this one and before the press rather than inside the
 * sheet that opens after it.
 */
export interface ClaimSettlement {
  /**
   * The span of the DESK CALL's own window, already said. Null when the row
   * carries no resolve_on to measure to. See `windowSpan` below for the one
   * case that is not a day count.
   *
   * It is `daysBetween(brief_date, resolve_on)` and it is usually not 90. The
   * fixture this screen replaced wrote "90 days, fixed at entry", which was two
   * untruths in six words: the span is per call, and "entry" reads as the
   * READER's entry while the adopt route writes them a DIFFERENT window, today
   * to today plus their chosen horizon.
   */
  window: string | null;
  /** resolve_on, the date the desk's window closes. Null when it has none. */
  checked: string | null;
  /**
   * brief_date. The brief this call was published in, said as a LINE and never
   * as a link: the brief id is on the row, but no route renders an arbitrary
   * brief for a reader, so a link would have no destination.
   */
  published: string | null;
  /**
   * `claim_type` in words. Fetched since the screen shipped, because the commit
   * rule reads it, and never drawn until now.
   */
  type: string | null;
  /**
   * `expected_direction` in words. Fetched for the same reason and never drawn
   * either. See DIRECTION_WORD: the stored vocabulary has THREE members and the
   * third is `neutral`, which had no word anywhere in this product.
   */
  direction: string | null;
}

/**
 * One symbol and the move the grader measured on it. Never derived and never
 * predicted: both halves come off `metadata` written by
 * `backend/grading/price_attribution.py`.
 */
export interface ClaimBenchmark {
  symbol: string;
  /** Signed, two places, e.g. "+2.31%". The grader's own units are percent points. */
  move: string;
}

/**
 * The price evidence behind the word, as the grader recorded it.
 *
 * PRESENT ONLY AFTER GRADING, and that is the whole licence for it. See the
 * "MEASURED AGAINST" note in this file's header: naming a benchmark before the
 * grader runs is a prediction, naming the one it used afterwards is a fact.
 */
export interface ClaimMeasure {
  /** The entity the call was about, and how far it moved. */
  entity: ClaimBenchmark | null;
  /** Every benchmark the grader actually used, in the order it wrote them. */
  benchmarks: ClaimBenchmark[];
  /** The bar the move had to clear to be credited, e.g. "0.75%". */
  bar: string | null;
}

/**
 * How the desk graded this call, or the honest absence of a grade.
 *
 * IT REACHES ITS WORD THROUGH THE SAME TWO PURE FUNCTIONS THE MOBILE ROW USES,
 * `scoredCallProps` then `mobileOutcomeState`, and nothing here reads a
 * `verdict` column, compares an `attribution` value or picks a state from a
 * row. That is what stops the list and the screen it opens grading the same
 * call two different ways. `OUTCOME_STATES` is closed at four and is not
 * touched; `VERDICT_WORD` and `ScoredObject` render a fifth word and are barred
 * from a mobile surface, so neither is imported.
 */
export interface ClaimOutcome {
  /**
   * One of the four mobile words, or NULL when there is no grade. Null is not
   * "awaiting": `src/lib/mobile-outcome-state.ts` sets out why. The screen draws
   * null as a hollow ring, exactly as the list does, because a fifth filled dot
   * would read as a fifth state.
   */
  state: OutcomeState | null;
  /**
   * Only read when `state` is null. True when the grade is QUEUED rather than
   * refused: gradeable, window closed, and the grader has not reached it. The
   * same structural test `briefRow` applies, not a match on the reason string.
   */
  pending: boolean;
  /**
   * The desk's attribution sentence when there is one, and what the call is
   * watching for when there is not. The identical fallback chain the row uses,
   * `props.attribution ?? props.verdict ?? briefResolutionSentence(call)`.
   */
  reading: string | null;
  /** Why no grade exists. Present only when `state` is null. */
  notGradedReason: string | null;
  /** `graded_at`, ISO date. Present on every outcome row, so it is a fact. */
  gradedOn: string | null;
  /** The benchmark evidence. Null on any call the grader has not settled. */
  measure: ClaimMeasure | null;
}

/**
 * The outcome, or the fact that the read did not answer.
 *
 * "unread" IS NOT A THIRD KIND OF ABSENCE, it is the absence of an answer, and
 * the screen must not draw it as an ungraded call. A literal rather than null
 * so no caller can reach it by forgetting a field.
 */
export type ClaimOutcomeRead = ClaimOutcome | "unread";

/**
 * The READER's window, as it can honestly be stated before the press.
 *
 * IT IS THE SHEET'S NUMBER, taken from `commitWindow`, which is the same
 * `adoptWindowForCall(sessionIso, resolveOn)` the commit sheet calls at
 * `commit-sheet.tsx:126`. Anything else here would name a span a press does not
 * write, which is worse than naming none.
 */
export interface ClaimReaderWindow {
  /** "7 days". The count the sheet shows and the adopt route stores. */
  span: string;
  /** "resolves in about a week", the same span in the product's own words. */
  phrase: string;
  /** The date that window closes, ISO. */
  closes: string;
}

/**
 * `data` is required wherever it appears and has no default anywhere. The
 * screen draws loading or nothing when it is absent, never a sentence about
 * the reader.
 */
export interface ClaimData {
  /**
   * `morning_brief_calls.id`. The only id `/api/radar/claims/adopt` accepts,
   * which is why the commit sheet's target can be built from this shape at all.
   */
  callId: string;
  /** Sector or theme. Rendered as the eyebrow. */
  eyebrow: string;
  /** The falsifiable sentence. */
  claim: string;
  /**
   * The call's own resolve_on, raw ISO, and NEVER RENDERED. The commit sheet
   * preselects the call's span from it; `settlement.checked` beside it is
   * prose and cannot be read back into a date. Mirrors LedgerClaim.resolveOn
   * and the comment at ledger-data.ts:497-499.
   */
  resolveOn: string | null;
  /** The reader's session date, ISO. Passed to the sheet, never drawn. */
  sessionIso: string;
  settlement: ClaimSettlement;
  /**
   * How the desk settled it, or "unread". RENDER ONLY. Nothing below this line
   * reads it, and the test named in the header holds that shut.
   */
  outcome: ClaimOutcomeRead;
  /**
   * The window a press would open, or null when no press is on offer.
   *
   * Null on `ungradeable`, where there is nothing to open, and on `onLedger`,
   * where the reader ALREADY has a window and it is not this one: their stored
   * `resolution_window_end` is a `user_claims` column this loader does not read,
   * and printing a prospective span over an existing commitment would be a
   * second window said as if it were theirs.
   */
  readerWindow: ClaimReaderWindow | null;
  variant: ClaimVariant;
  /**
   * Why no commitment is on offer, or null when one is. Comes straight off
   * `commitLegality`, so it is the same sentence /ledger prints on the same
   * call rather than a second wording of the same fact.
   */
  commitReason: string | null;
}

export interface ClaimLoad {
  /** Null only when there is nothing to draw: a failed read, or no such call. */
  data: ClaimData | null;
  stage: ClaimStage;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The id shape, checked BEFORE the query rather than after it.
 *
 * Two reasons, and the second is the load-bearing one. Postgres rejects a
 * malformed uuid with 22P02, so `/claim/demo` would come back as a failed read
 * and paint "We could not load this claim" over a string that was never an id.
 * And a round trip to establish that "demo" is not a uuid is a round trip
 * this file can decline to make.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The desk call's own window, said in days.
 *
 * A ZERO DAY SPAN IS A REAL WINDOW, not a missing one, and it is the common
 * case: the extractor's `session` bucket resolves a call at the close of the
 * day it was written. "0 days" alone reads as an absent value, so that one
 * count is said in the vocabulary the rest of the product already uses for it,
 * `HORIZON_LABEL.session`, imported rather than typed again.
 *
 * Null when there is nothing to measure, and null when the measurement is
 * negative: a resolve_on before the brief date is a broken row, not a window,
 * and the row is then simply absent from the screen.
 */
function windowSpan(days: number | null): string | null {
  if (days === null || days < 0) return null;
  if (days === 0) return HORIZON_LABEL.session;
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * The stored direction, in the vocabulary this product already uses for it.
 *
 * `resolutionSentence` in `radar-calls-model.ts` says "to the upside", "to the
 * downside" and "by staying flat" MID-SENTENCE. These are the same three facts
 * as a label, so a reader meets one wording of the stored value rather than two.
 *
 * NEUTRAL IS THE REASON THIS TABLE EXISTS RATHER THAN A TERNARY. The column is
 * CHECKed at ('bullish','bearish','neutral') by `sql/0003_brief_self_grading.sql`
 * and `sql/0012_radar_user_claims.sql`, and `backend/grading/price_attribution.py`
 * grades it against a realized "flat". A two-branch expression draws a blank on
 * the third, which is how a value with no word ships as an empty row.
 *
 * Anything outside the three is null, so an unexpected value is absent rather
 * than shown raw.
 */
const DIRECTION_WORD: Record<string, string> = {
  bullish: "To the upside",
  bearish: "To the downside",
  neutral: "Flat",
};

/**
 * The stored claim type, in words.
 *
 * `eyebrowFor` capitalises the raw enum for the eyebrow slot, which is fine
 * where it stands in for a missing symbol and wrong as the value of a row
 * LABELLED "Type": "Ticker" names a column, "Single name" names the thing. An
 * unlisted type falls back to the capitalised enum rather than to nothing,
 * because the enum is at least true.
 */
const CLAIM_TYPE_WORD: Record<string, string> = {
  ticker: "Single name",
  sector: "Sector",
  index: "Index",
  aggregate: "Macro",
};

function typeWord(claimType: string | null): string | null {
  const kind = asText(claimType)?.toLowerCase() ?? null;
  if (!kind) return null;
  return CLAIM_TYPE_WORD[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

function directionWord(direction: string | null): string | null {
  const dir = asText(direction)?.toLowerCase() ?? null;
  return dir ? (DIRECTION_WORD[dir] ?? null) : null;
}

/** Percent points, signed, two places. The grader's own units and format. */
function signedPct(pctPoints: number): string {
  return `${pctPoints >= 0 ? "+" : ""}${pctPoints.toFixed(2)}%`;
}

/**
 * The benchmark evidence off the grader's metadata, or null.
 *
 * NULL RATHER THAN AN EMPTY BLOCK whenever the grader named no entity move and
 * no benchmark. An ungradable row carries `ungradable_reason` in place of the
 * price evidence, and a legacy row from the pre-attribution grader carries
 * neither, so both correctly produce nothing here.
 */
function measureOf(meta: CallOutcomeMetadata | null | undefined): ClaimMeasure | null {
  if (!meta) return null;
  const symbol = asText(meta.entity_symbol);
  const move = typeof meta.entity_move_pct === "number" ? meta.entity_move_pct : null;
  const entity = symbol && move !== null ? { symbol, move: signedPct(move) } : null;
  const benchmarks: ClaimBenchmark[] = (meta.benchmarks ?? [])
    .filter((b) => asText(b?.symbol) && typeof b?.move_pct === "number")
    .map((b) => ({ symbol: b.symbol.trim(), move: signedPct(b.move_pct) }));
  const minExcess = meta.thresholds_pct?.min_excess;
  const bar = typeof minExcess === "number" ? `${minExcess}%` : null;
  if (!entity && benchmarks.length === 0) return null;
  return { entity, benchmarks, bar };
}

interface BriefCallRow {
  id: string;
  claim_text: string | null;
  claim_type: string | null;
  target_symbol: string | null;
  /**
   * Selected because the commit rule reads it. `isAdoptGradeable` refuses a
   * call with no direction, so a screen that did not select this column could
   * only ever guess at the answer the adopt route would give. It is also now
   * DRAWN, in `settlement.direction`.
   */
  expected_direction: string | null;
  brief_date: string | null;
  resolve_on: string | null;
  /**
   * When the call was written. `scoredCallProps` reads it for the called date,
   * falling back to `brief_date`. `confidence` sits beside it on the row and is
   * deliberately NOT selected: see the header.
   */
  created_at: string | null;
}

/**
 * One desk call, for one reader.
 *
 * `[id]` IS a morning_brief_calls id, and the route settles that rather than
 * the string doing it. `src/app/entry/[id]/page.tsx` is the sibling route and
 * takes a user_claims id; both are uuids, so nothing in the text distinguishes
 * them and THIS FILE DOES NOT TRY. It looks the id up in morning_brief_calls,
 * and anything not there is missing. A user_claims id pasted into /claim
 * correctly lands on missing.
 *
 * `userId` null means nobody is signed in. The call still loads, because it is
 * public read, and the adoption question is simply not asked: a reader with no
 * session has no record for the call to be on. That matches the Ledger, whose
 * cards offer the same commit control to a signed-out reader.
 */
export async function loadClaim(
  supabase: SupabaseClient,
  userId: string | null,
  id: string,
): Promise<ClaimLoad> {
  const today = todayPt();

  if (!UUID.test(id.trim())) return { data: null, stage: "missing" };

  const { data, error } = await supabase
    .from("morning_brief_calls")
    .select(
      "id, claim_text, claim_type, target_symbol, expected_direction, brief_date, resolve_on, created_at",
    )
    .eq("id", id.trim())
    .maybeSingle();

  if (error) return { data: null, stage: "error" };

  const row = (data ?? null) as BriefCallRow | null;
  const claim = asText(row?.claim_text);
  // A row with no sentence is not a claim. The screen's missing copy is exactly
  // that: there is no claim at this address.
  if (!row || !claim) return { data: null, stage: "missing" };

  const resolveOn = asText(row.resolve_on)?.slice(0, 10) ?? null;
  const briefDate = asText(row.brief_date)?.slice(0, 10) ?? null;

  /* Two reads that answer two unrelated questions, so they run together rather
     than one after the other.

     THE OUTCOME SELECT IS THE LIST'S, VERBATIM (radar-calls-data.ts:236-239),
     which is what lets the same two pure mappers run over it. `.limit(1)` after
     an ordering by `graded_at` is the one-row form of the list's own
     "keep the latest" reduction: a call can carry more than one outcome row,
     and the newest is the one every other surface renders. */
  const [outcomeRes, adoptedRes] = await Promise.all([
    supabase
      .from("morning_brief_call_outcomes")
      .select(
        "call_id, verdict, attribution, actual_pct_change, actual_direction, verdict_notes, graded_at, metadata",
      )
      .eq("call_id", row.id)
      .order("graded_at", { ascending: false })
      .limit(1),
    /* The reader's own record. RLS scopes it, so the database decides. */
    userId
      ? supabase
          .from("user_claims")
          .select("id")
          .eq("user_id", userId)
          .eq("adopted_from_call_id", row.id)
          .limit(1)
      : Promise.resolve(null),
  ]);

  /* A FAILED READ IS NOT A NO. A failed adoption read offers the control to
     someone who may already have taken this call, and the adopt route answers
     that safely: it finds the existing row and reports alreadyAdopted rather
     than writing a second one. Suppressing the control instead would tell a
     reader their claim is already on a record this read failed to look at. */
  const adopted =
    adoptedRes !== null &&
    !adoptedRes.error &&
    ((adoptedRes.data as unknown[] | null)?.length ?? 0) > 0;

  const span = briefDate && resolveOn ? daysBetween(briefDate, resolveOn) : null;

  /* THE shared question, asked of the shared function. `commitLegality` wraps
     `isAdoptGradeable`, which is the exact predicate /api/radar/claims/adopt
     evaluates before it decides what to write into `gradeable`, so this screen
     cannot promise a commitment the route would refuse or refuse one the route
     would accept. `loadDeskCalls` in ledger-data.ts asks the identical call.

     IT IS PASSED `row` AND `today` AND NOTHING ELSE, which is the guardrail in
     its structural form: `outcomeRes` is read below this line and cannot reach
     it. Being on the reader's own record still outranks it, because that is
     true whatever the call's shape and a reader who has already committed is
     not asking whether they may. */
  const legality = commitLegality(row, today);
  const variant: ClaimVariant = adopted ? "onLedger" : legality.canCommit ? "open" : "ungradeable";

  /* The reader's window, for the one variant that can open one. See
     `ClaimData.readerWindow` for why the other two get null. */
  const window = commitWindow(row, today);
  const readerWindow: ClaimReaderWindow | null =
    variant === "open"
      ? {
          span: window.days === 1 ? "1 day" : `${window.days} days`,
          phrase: window.phrase,
          closes: window.endIso,
        }
      : null;

  return {
    data: {
      callId: row.id,
      eyebrow: eyebrowFor(row),
      claim,
      resolveOn,
      sessionIso: today,
      settlement: {
        window: windowSpan(span),
        checked: resolveOn,
        published: briefDate,
        type: typeWord(row.claim_type),
        direction: directionWord(row.expected_direction),
      },
      outcome: readOutcome(row, outcomeRes, today),
      readerWindow,
      variant,
      commitReason: adopted ? null : legality.reason,
    },
    stage: "ready",
  };
}

/**
 * The desk's grade, reduced to what the screen draws.
 *
 * THE JUDGEMENT IS NOT MADE HERE. `scoredCallProps` decides the state and
 * writes the attribution sentence, `mobileOutcomeState` picks the word, and
 * both are the same pure functions Radar's Calls section runs over the same
 * rows. Nothing in this function reads `verdict`, compares `attribution` or
 * chooses a state, which is what keeps a call from settling two ways on two
 * screens.
 *
 * THE ARGUMENTS ARE `briefRow`'s, deliberately. It passes claim_text,
 * target_symbol, claim_type, created_at and brief_date, and the same five go in
 * here, so the state this screen reaches on a call is the state the row that
 * opened it reached. `confidence` is the sixth thing `briefRow` passes and it
 * is not selected here; the mapper never renders it, so its absence changes
 * nothing it returns.
 */
function readOutcome(
  row: BriefCallRow,
  res: { data: unknown; error: unknown } | null,
  todayIso: string,
): ClaimOutcomeRead {
  // The read did not answer. Never drawn as a call nobody graded.
  if (!res || res.error) return "unread";

  const outcome = ((res.data as CallOutcomeRow[] | null) ?? [])[0] ?? null;
  const props = scoredCallProps(
    {
      claim_text: row.claim_text ?? "",
      target_symbol: row.target_symbol,
      claim_type: row.claim_type,
      created_at: row.created_at,
      brief_date: row.brief_date,
    },
    outcome,
    todayIso,
  );
  const state = mobileOutcomeState(props.state);

  /* The row's own fallback chain, in the row's own order. `briefResolutionSentence`
     reads brief_date and resolve_on only; `confidence` is required by its
     argument type and is not a column this file selects, so it is passed null
     rather than fetched for a function that never looks at it. */
  const reading =
    props.attribution ??
    props.verdict ??
    briefResolutionSentence({
      id: row.id,
      claim_text: row.claim_text ?? "",
      claim_type: row.claim_type,
      target_symbol: row.target_symbol,
      brief_date: row.brief_date,
      resolve_on: row.resolve_on,
      created_at: row.created_at,
      confidence: null,
    });

  return {
    state,
    /* The same structural test `briefRow` applies: no outcome row and a closed
       window is a call the grader has not reached, not one it refused. Derived
       from the two facts, never by matching the reason string. */
    pending: state === null && outcome === null,
    reading,
    notGradedReason: state === null ? (props.notGradedReason ?? null) : null,
    gradedOn: asText(outcome?.graded_at)?.slice(0, 10) ?? null,
    measure: measureOf(outcome?.metadata),
  };
}

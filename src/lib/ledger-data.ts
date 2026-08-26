/**
 * ledger-data - the read path behind the mobile Ledger.
 *
 * The Ledger was built against `src/components/ledger/fixture.ts`, whose header
 * says the shape below IS the contract a real loader has to satisfy. This is
 * that loader. It runs on the server, it makes no model call, and it writes
 * nothing.
 *
 * WHAT IT READS
 *   briefings                    the newest morning brief, exactly the row
 *                                `/api/briefing?type=morning` serves. The
 *                                predicate is copied from that route verbatim
 *                                so the phone and the desk cannot disagree
 *                                about which row is today's.
 *   morning_brief_calls          the desk's calls attached to that brief.
 *   morning_brief_call_outcomes  which of those calls has been graded.
 *   user_profiles                the reader's own sector list.
 *   user_claims                  the reader's own calls.
 *   user_claim_outcomes          how the reader's own calls resolved.
 *
 * The first three are public-read. The last three are RLS-scoped, so they are
 * read through the caller's cookie-backed client and the database, not this
 * file, decides what the reader may see. A signed-out caller gets the brief
 * and nothing personal.
 *
 * WHAT IT REFUSES TO DO
 *
 * Every field it cannot source is `null`, and the screen draws nothing for a
 * null rather than a plausible stand-in. Specifically: the "since you last
 * looked" card has no source at all (nothing records when a reader last looked)
 * so it is null here and absent on the screen, and the market-pulse driver
 * pills need a per-driver bull or bear reading that no column carries, so that
 * list is empty. Inventing either is the exact defect that put "One of your
 * calls was checked overnight" in front of real readers.
 *
 * Nothing here is averaged, divided or scored. Every figure it produces is a
 * count of real rows or a value copied off one. That is a product rule and it
 * reaches the loader, not just the view.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { scoredCallProps, type CallOutcomeRow } from "./scored-object-map";
import { RESOLUTION_BY_STATE, type Resolution } from "./verdict-vocabulary";
import { VIX_CALM_LEVEL, VIX_ELEVATED_LEVEL } from "./market-regime";
import { sessionDatePt, todayPt } from "./session-date";
import type { LedgerClaim, LedgerData, LedgerDay, LedgerEntry } from "@/components/ledger/fixture";
import type { OutcomeState } from "@/components/ledger/claim-anatomy";

/** The lifecycle the screen paints. Mirrors `BriefStage` in ledger-screen. */
export type LedgerStage = "ready" | "loading" | "error" | "none" | "stale";

export interface LedgerLoad {
  /** Null only when the read itself failed. Otherwise a real, partial shape. */
  data: LedgerData | null;
  stage: LedgerStage;
}

/** Days rendered on the record before "N entries before this" takes over. */
const RECORD_DAY_LIMIT = 6;
/** Rows read for the reader's own record. Counts are over exactly this many. */
const CLAIM_LIMIT = 200;
/** Older than this and the brief on screen is yesterday's. Matches the API. */
const STALE_AFTER_HOURS = 20;
/** Words per minute behind the "N min read" badge. */
const READING_PACE = 200;

const ET = "America/New_York";
const PT = "America/Los_Angeles";

/* ── formatting ─────────────────────────────────────────────────────── */

/** "6:45 AM ET" from an ISO instant. */
function clockEt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const t = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return `${t} ET`;
}

/** Noon UTC, so a bare "YYYY-MM-DD" cannot slip a day when read in PT. */
function fromSessionDate(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

/** "Thursday, August 6" from a "YYYY-MM-DD" session date. */
function longDate(day: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PT,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(fromSessionDate(day));
}

/** "Sep 7" from a "YYYY-MM-DD" session date. */
function shortDay(day: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PT,
    month: "short",
    day: "numeric",
  }).format(fromSessionDate(day));
}

/** Whole days from one session date to another. Negative means already past. */
function daysBetween(fromDay: string, toDay: string): number {
  const a = fromSessionDate(fromDay).getTime();
  const b = fromSessionDate(toDay).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * "in 14 days" for a live window, or a plain statement that it has closed.
 * Derived from two stored dates, never from a guess about how long a quarter
 * feels.
 */
function relativeWindow(today: string, resolveOn: string): string {
  const days = daysBetween(today, resolveOn);
  if (days < 0) return "window closed";
  if (days === 0) return "today";
  if (days === 1) return "in 1 day";
  return `in ${days} days`;
}

function paragraphs(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function countWords(parts: string[]): number {
  return parts.reduce((n, p) => n + p.split(/\s+/).filter(Boolean).length, 0);
}

/** Postgres jsonb arrives parsed; an older text column arrives as a string. */
function asObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/* ── row shapes ─────────────────────────────────────────────────────── */

interface BriefRow {
  id: string;
  created_at: string | null;
  headline: string | null;
  market_pulse: unknown;
  market_tape: unknown;
}

interface DeskCallRow {
  id: string;
  claim_text: string | null;
  claim_type: string | null;
  target_symbol: string | null;
  brief_date: string | null;
  created_at: string | null;
  confidence: number | null;
  resolve_on: string | null;
}

interface UserClaimRow {
  id: string;
  user_claim: string | null;
  claim_type: string | null;
  target_symbol: string | null;
  created_at: string | null;
  adopted_from_call_id: string | null;
}

interface UserOutcomeRow {
  claim_id: string;
  verdict: string | null;
  attribution: string | null;
  actual_pct_change: number | null;
  actual_direction: string | null;
  verdict_notes: string | null;
  graded_at: string | null;
  metadata: unknown;
}

/* ── mapping ────────────────────────────────────────────────────────── */

/**
 * The shared four-word vocabulary, reached through the same table the desk
 * record and the reader's own record already bucket through. A second literal
 * mapping here is how two surfaces start disagreeing about what "supported"
 * means.
 */
const OUTCOME_BY_RESOLUTION: Record<Resolution, OutcomeState> = {
  supported: "supported",
  challenged: "challenged",
  noCleanRead: "developing",
  notGraded: "awaiting",
};

/** Sentence-cased claim type, used as an eyebrow when there is no symbol. */
function eyebrowFor(row: { target_symbol: string | null; claim_type: string | null }): string {
  const symbol = asText(row.target_symbol);
  if (symbol) return symbol;
  const kind = asText(row.claim_type);
  if (!kind) return "Claim";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function toStats(pulse: Record<string, unknown> | null, tape: Record<string, unknown> | null) {
  const stats: LedgerData["stats"] = [];

  const mood = asText(pulse?.sentiment_word);
  if (mood) stats.push({ label: "Mood", value: mood.toUpperCase(), tone: "mood" });

  const vixLevel = asNumber(tape?.vix_level);
  const vixPct = asNumber(tape?.vix_pct);
  if (vixLevel !== null) {
    const move =
      vixPct === null ? "" : ` ${vixPct < 0 ? "▼" : "▲"}${Math.abs(vixPct).toFixed(2)}%`;
    // Tone reads the LEVEL, not the direction, against the same two levels
    // market-regime.ts already names. Between them the figure carries no tone
    // and renders in ink.
    const tone =
      vixLevel >= VIX_ELEVATED_LEVEL ? "stress" : vixLevel <= VIX_CALM_LEVEL ? "calm" : undefined;
    stats.push({ label: "VIX", value: `${vixLevel.toFixed(2)}${move}`, tone });
  }

  return stats;
}

function toPulse(
  pulse: Record<string, unknown> | null,
  stampedAt: string | null,
): LedgerData["pulse"] {
  const verdict = asText(pulse?.sentiment_word);
  const body = paragraphs(asText(pulse?.narrative));
  if (!verdict || body.length === 0) return null;
  return {
    stampedAt: stampedAt ? `MARKET PULSE · ${stampedAt}` : "MARKET PULSE",
    verdict,
    // Empty on purpose. The driver pills carry a bull or bear reading per
    // driver and no column supplies one, so there is nothing to draw.
    drivers: [],
    lede: body[0],
    body: body.slice(1),
  };
}

/* ── the load ───────────────────────────────────────────────────────── */

/**
 * The newest morning brief. The predicate is copied from
 * src/app/api/briefing/route.ts verbatim: newest row of this type with the
 * sentinel headline excluded. Not a date filter, deliberately, so a day the
 * pipeline missed shows the previous brief marked stale rather than nothing at
 * all, and so the phone and the desk cannot disagree about which row is
 * today's.
 */
function briefQuery(supabase: SupabaseClient) {
  return supabase
    .from("briefings")
    .select("id, created_at, headline, market_pulse, market_tape")
    .eq("briefing_type", "morning")
    .neq("headline", "Market Intelligence Unavailable")
    .order("created_at", { ascending: false })
    .limit(1);
}

/**
 * Build the Ledger for one reader.
 *
 * `userId` null means nobody is signed in: the brief still loads, because it is
 * public, and every personal block stays empty. It gives back `data: null` only
 * when the brief read itself failed, which is the one case the screen must
 * report as a failure rather than as an absence.
 *
 * `initials` is derived by the caller, from the reader's own auth record,
 * through `src/lib/user-initials.ts`. It is a parameter rather than a read
 * because the identity lives on the auth record the page already carries and not
 * in any table this file queries, and because that is the same record and the
 * same function `src/components/shell/user-avatar.tsx` uses. It used to be
 * derived here from `user_profiles.full_name`, which is a different store: the
 * two are not kept in step, so a reader who had set a name in one and not the
 * other got one set of letters on the masthead and another in the shell. Null
 * means nothing was derivable and the disc draws empty.
 */
export async function loadLedger(
  supabase: SupabaseClient,
  userId: string | null,
  initials: string | null,
): Promise<LedgerLoad> {
  const today = todayPt();

  // One wave. The wrap time and everything personal depend on nothing in the
  // brief row, so waiting for it cost them a round trip for no reason.
  const [briefRes, wrap, personal] = await Promise.all([
    briefQuery(supabase),
    loadWrapTime(supabase, today),
    loadPersonal(supabase, userId, today),
  ]);
  const { data: briefRows, error: briefError } = briefRes;

  if (briefError) return { data: null, stage: "error" };

  const brief = (briefRows?.[0] ?? null) as BriefRow | null;
  const desk = brief ? await loadDeskCalls(supabase, brief.id, today) : EMPTY_DESK;

  const pulseJson = asObject(brief?.market_pulse);
  const tapeJson = asObject(brief?.market_tape);
  const generatedAt = clockEt(brief?.created_at);
  const pulse = toPulse(pulseJson, generatedAt);

  const ageHours =
    brief?.created_at != null
      ? (Date.now() - new Date(brief.created_at).getTime()) / 3_600_000
      : null;
  const stale = ageHours !== null && ageHours > STALE_AFTER_HOURS;

  // A desk call the reader has already taken onto their own record carries a
  // marker instead of an action. The two reads run in parallel, so the variant
  // is settled here, once both have answered.
  const claims: LedgerClaim[] = desk.claims.map((c) => ({
    ...c,
    variant: personal.adopted.has(c.id) ? "onLedger" : "open",
  }));

  const todayDay: LedgerDay = {
    date: longDate(brief?.created_at ? sessionDatePt(new Date(brief.created_at)) : today),
    claims: claims.length > 0 ? claims : undefined,
  };

  const readWords = pulse ? countWords([pulse.lede, ...pulse.body]) : 0;

  const data: LedgerData = {
    generatedAt,
    initials,
    readMinutes: readWords > 0 ? Math.max(1, Math.round(readWords / READING_PACE)) : null,
    // No source. The masthead line in the design describes the brief's shape
    // and nothing stored says what shape today's brief has.
    tagline: null,
    wrapPublishedAt: wrap,
    sectors: personal.sectors,
    stats: toStats(pulseJson, tapeJson),
    // No source, and the honest answer is nothing. "Since you last looked"
    // needs a record of when the reader last looked, and none is kept.
    continuity: null,
    pulse,
    // The status line carries the decided count ONLY when a read established
    // one. On a failed or unmade read it says how many calls there are, which
    // the answered calls read did establish, and says nothing about how many
    // are decided. The view draws the rest.
    briefProgress:
      // `decided` is null only inside EMPTY_DESK, whose total is 0, so the two
      // conditions are the same condition. Spelling both is what lets the view
      // carry two states instead of an unreachable third.
      desk.total > 0 && desk.decided !== null
        ? {
            decided: desk.decided,
            total: desk.total,
            status:
              typeof desk.decided === "number"
                ? `${desk.total} ${desk.total === 1 ? "call" : "calls"}, ${desk.decided} decided`
                : `${desk.total} ${desk.total === 1 ? "call" : "calls"}`,
          }
        : null,
    // The session date, unformatted. `today.date` beside it is the long form
    // the date rule draws, and nothing downstream can parse that back.
    sessionIso: today,
    today: todayDay,
    past: personal.past,
    entriesBefore: personal.entriesBefore,
  };

  if (!brief) return { data, stage: "none" };
  return { data, stage: stale ? "stale" : "ready" };
}

/* ── the pieces ─────────────────────────────────────────────────────── */

/**
 * Publication time of TODAY's evening wrap, or null.
 *
 * The trigger is the artifact existing on today's session date. An evening wrap
 * from last week is not today's wrap, and an absent wrap at 6pm reads exactly
 * as an absent wrap at 6am.
 */
async function loadWrapTime(supabase: SupabaseClient, today: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("briefings")
    .select("created_at")
    .eq("briefing_type", "evening")
    .neq("headline", "Market Intelligence Unavailable")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return null;
  const at = (data?.[0] as { created_at: string | null } | undefined)?.created_at ?? null;
  if (!at) return null;
  return sessionDatePt(new Date(at)) === today ? clockEt(at) : null;
}

interface DeskLoad {
  claims: LedgerClaim[];
  total: number;
  /**
   * How many of those calls have been graded, in three states.
   *
   *   a number   the outcomes read ANSWERED. Zero is a real zero.
   *   "failed"   it ANSWERED WITH AN ERROR.
   *   null       it WAS NOT MADE, because there were no calls to grade.
   *
   * It is not a plain number, and that is the whole point. A read that never
   * came back and a read that came back with none graded are different facts,
   * and only the second one is "0 decided".
   */
  decided: number | "failed" | null;
}

const EMPTY_DESK: DeskLoad = { claims: [], total: 0, decided: null };

/** The desk's calls on this brief, plus how many of them have been graded. */
async function loadDeskCalls(
  supabase: SupabaseClient,
  briefId: string,
  today: string,
): Promise<DeskLoad> {
  const { data, error } = await supabase
    .from("morning_brief_calls")
    .select("id, claim_text, claim_type, target_symbol, brief_date, created_at, confidence, resolve_on")
    .eq("brief_id", briefId)
    .order("confidence", { ascending: false });
  if (error) return EMPTY_DESK;

  const rows = ((data ?? []) as DeskCallRow[]).filter((r) => asText(r.claim_text));
  if (rows.length === 0) return EMPTY_DESK;

  // The error is read, not discarded. Dropping it here made a failed read
  // indistinguishable from an answered one that found nothing graded, and the
  // screen published the second as fact: "N calls, 0 decided", a 0/N numeral
  // pair and a full row of unfilled progress segments, over a read that never
  // came back. Every other read in this file degrades to absence and this one
  // degraded to a number. A FAILED READ IS NOT A ZERO.
  const { data: graded, error: gradedError } = await supabase
    .from("morning_brief_call_outcomes")
    .select("call_id")
    .in(
      "call_id",
      rows.map((r) => r.id),
    );
  const decided: number | "failed" = gradedError
    ? "failed"
    : new Set(((graded ?? []) as { call_id: string }[]).map((g) => g.call_id)).size;

  const claims: LedgerClaim[] = rows.map((r) => {
    const resolveOn = asText(r.resolve_on);
    return {
      id: r.id,
      eyebrow: eyebrowFor(r),
      claim: r.claim_text as string,
      // No source. morning_brief_calls carries the falsifiable sentence and
      // its window, not the reasoning behind it.
      reasoning: undefined,
      window: resolveOn ? `reviewed ${shortDay(resolveOn)}` : undefined,
      windowRelative: resolveOn ? relativeWindow(today, resolveOn) : undefined,
      // Raw, unformatted, and never rendered. The commit sheet preselects the
      // call's own span from it; the two fields above are prose and cannot be
      // read back into a date.
      resolveOn: resolveOn ?? null,
      variant: "open",
    };
  });

  return { claims, total: rows.length, decided };
}

interface PersonalLoad {
  sectors: string[];
  past: LedgerDay[];
  entriesBefore: number | null;
  /** Ids of desk calls this reader has already taken onto their own record. */
  adopted: Set<string>;
}

const EMPTY_PERSONAL: PersonalLoad = {
  sectors: [],
  past: [],
  entriesBefore: null,
  adopted: new Set(),
};

/**
 * Everything that belongs to the reader: their sector list and their own
 * resolved calls, grouped by the day each was graded.
 *
 * Only the reader's OWN outcome rows are read. A claim adopted from the desk is
 * graded over its own window, so the desk's verdict answers a different
 * question and never appears here. That is the rule src/lib/claim-outcome.ts
 * enforces by construction and this read does not go around it.
 */
async function loadPersonal(
  supabase: SupabaseClient,
  userId: string | null,
  today: string,
): Promise<PersonalLoad> {
  if (!userId) return EMPTY_PERSONAL;

  const [profileRes, claimRes] = await Promise.all([
    supabase.from("user_profiles").select("sectors").eq("id", userId).maybeSingle(),
    supabase
      .from("user_claims")
      .select("id, user_claim, claim_type, target_symbol, created_at, adopted_from_call_id")
      .eq("user_id", userId)
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(CLAIM_LIMIT),
  ]);

  // The profile read's error is checked, deliberately and not incidentally.
  // It used to be destructured for `.data` alone, and it degraded to absence
  // only because `null?.sectors` happens to be undefined. That is the right
  // OUTCOME reached by accident, one function away from the read whose
  // identical shape published "0 decided" over a failure, and the accident is
  // the thing worth removing.
  //
  // Absence IS the correct rendering here, and this is where a sector list
  // differs from a count. The banner reads "Personalized for:" over the
  // reader's own sectors, so an empty list draws no banner at all and asserts
  // nothing: not that the reader has no sectors, not that a read succeeded. A
  // failure notice over a personalization strip would be noise about a block
  // that carries no claim. So a failed read and an empty list render the same
  // nothing, on purpose, which is not true of anything this file counts.
  const profile = profileRes.error
    ? null
    : (profileRes.data as { sectors: unknown } | null);
  const rawSectors = profile?.sectors;
  const sectors = Array.isArray(rawSectors)
    ? rawSectors.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];

  if (claimRes.error) return { ...EMPTY_PERSONAL, sectors };
  const rows = (claimRes.data ?? []) as UserClaimRow[];
  const claims = rows.filter((c) => asText(c.user_claim));

  const adopted = new Set(
    claims.map((c) => c.adopted_from_call_id).filter((id): id is string => Boolean(id)),
  );
  if (claims.length === 0) return { sectors, past: [], entriesBefore: null, adopted };

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
  if (outcomeError) return { sectors, past: [], entriesBefore: null, adopted };

  // Newest row per claim. There is no unique constraint on claim_id.
  const latest = new Map<string, UserOutcomeRow>();
  for (const row of (outcomeData ?? []) as UserOutcomeRow[]) {
    const prev = latest.get(row.claim_id);
    if (!prev || (row.graded_at ?? "") > (prev.graded_at ?? "")) latest.set(row.claim_id, row);
  }

  // One entry per claim that has its OWN verdict. A claim still inside its
  // window is awaiting and is simply not on the record yet.
  const dated: { day: string; at: string; entry: LedgerEntry }[] = [];
  for (const claim of claims) {
    const own = latest.get(claim.id);
    if (!own?.graded_at) continue;

    const outcome: CallOutcomeRow = {
      call_id: claim.id,
      verdict: own.verdict ?? "",
      attribution: (own.attribution ?? null) as CallOutcomeRow["attribution"],
      actual_pct_change: own.actual_pct_change,
      actual_direction: own.actual_direction as CallOutcomeRow["actual_direction"],
      verdict_notes: own.verdict_notes,
      graded_at: own.graded_at,
      metadata: (own.metadata ?? null) as CallOutcomeRow["metadata"],
    };
    const props = scoredCallProps(
      {
        claim_text: claim.user_claim as string,
        target_symbol: claim.target_symbol,
        claim_type: claim.claim_type,
        created_at: claim.created_at,
        brief_date: null,
      },
      outcome,
      today,
    );

    const result = props.attribution ?? props.notGradedReason ?? asText(own.verdict_notes);
    dated.push({
      day: sessionDatePt(new Date(own.graded_at)),
      at: own.graded_at,
      entry: {
        id: claim.id,
        state: OUTCOME_BY_RESOLUTION[RESOLUTION_BY_STATE[props.state]],
        instrument: eyebrowFor(claim),
        claim: claim.user_claim as string,
        // The grader's benchmark line, verbatim. Never a sentence written here.
        result: result ?? "",
      },
    });
  }

  dated.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const byDay = new Map<string, LedgerEntry[]>();
  for (const row of dated) {
    const bucket = byDay.get(row.day);
    if (bucket) bucket.push(row.entry);
    else byDay.set(row.day, [row.entry]);
  }

  const days = [...byDay.entries()].slice(0, RECORD_DAY_LIMIT);
  const shown = days.reduce((n, [, entries]) => n + entries.length, 0);
  const past: LedgerDay[] = days.map(([day, entries]) => ({ date: longDate(day), entries }));

  // "N entries before this" is a total, so it is published only when this read
  // saw every claim. At CLAIM_LIMIT there may be older ones it never fetched,
  // and the remainder is then a number this file does not know. Null, and the
  // screen draws no line at all, rather than an undercount stated as a total.
  const capped = rows.length >= CLAIM_LIMIT;
  const before = dated.length - shown;
  return {
    sectors,
    past,
    entriesBefore: !capped && before > 0 ? before : null,
    adopted,
  };
}

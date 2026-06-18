/**
 * Stale-republish detector, Layer 1 (price cross-check).
 *
 * THE PROBLEM. A market event from N days ago is re-emitted with a fresh feed
 * pubDate. The republish carries a today-dated `published_at`, so the dashboard
 * renders it as "today" (timeAgo reads published_at) and it pins to the top of
 * Top Stories at its saturated relevance_score. The existing guards miss it:
 * the 7-day published_at ceiling does not exclude a fresh-dated republish, the
 * 48h same-event collapse window is far too narrow to cluster a 6-day-apart
 * pair, and the signal-blend freshness penalty reads the lying pubDate as age 0.
 * Widening the same-event window was already rejected (80% bad-merge at 168h).
 *
 * THE FIX (Layer 1). For a headline that claims a QUANTIFIED price move
 * ("soars 60%", "plunges 20%"), the claim is checkable against price reality.
 * Parse the percent and the direction, fetch the ticker's daily bars, and ask:
 * did a move of roughly that size in that direction happen on the pubDate
 * session? If not, scan a bounded lookback for the session where it DID happen.
 * If found elsewhere, the row is a stale republish and the inferred event date
 * is that session. The detector is FAIL-SAFE: it only ever flags when it has
 * positive price evidence the move happened on a DIFFERENT day; missing bars,
 * half-days, thin tickers, or no-match all resolve to "no flag" (false negative
 * preferred over false positive).
 *
 * THE MOVE-VERB GATE is the single most important guard. `parseHeadlineMagnitude`
 * does NOT distinguish a realized move ("surges 30%") from a non-move percent
 * ("30% sales growth", "26% upside", "owns 12% stake"). Without the verb gate,
 * Layer 1 would fetch price for "30% sales growth", find no 30% price day, and
 * FALSELY flag fresh content as stale. The gate requires a move VERB adjacent to
 * the percent. Validated offline: TSM "30% sales growth" and MGNI "26% upside"
 * are correctly EXCLUDED; YYGH "soaring 60%" and ROKU "surges 20%" pass.
 *
 * SHADOW DEFAULT. STALE_REPUBLISH_MODE = off | shadow | active, default shadow.
 * Shadow computes the verdict and logs STALE_REPUBLISH_SHADOW but WRITES
 * NOTHING, changes NO recency, changes NO ranking, so merging this changes prod
 * behavior by zero. Active (default OFF, do NOT enable) corrects displayed
 * recency to the inferred event date and applies a targeted rank penalty in
 * top-stories.ts keyed on the corrected date. Durable storage of the inferred
 * date needs an `inferred_event_at` column; that migration is a flip-time HUMAN
 * step, so shadow logs the date WITHOUT persisting and this build adds no column.
 *
 * CORE-RANKING FLAG: this touches the Top Stories ranking and the dashboard
 * recency display, which are Lucas-reviewed. Nothing flips without a human.
 *
 * Layer 2 (non-quantified recurrence) is deferred future work; see the recon
 * doc docs/recon/stale-republish-detector.md.
 */

// ---------------------------------------------------------------------------
// Mode switch
// ---------------------------------------------------------------------------

export type StaleRepublishMode = "off" | "shadow" | "active";

/** Resolve the mode from the environment, defaulting to shadow (prod-neutral). */
export function resolveStaleRepublishMode(
  raw: string | null | undefined = typeof process !== "undefined"
    ? process.env.STALE_REPUBLISH_MODE
    : undefined,
): StaleRepublishMode {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "off" || v === "active") return v;
  return "shadow";
}

// ---------------------------------------------------------------------------
// Magnitude + direction parsing
// ---------------------------------------------------------------------------

/**
 * Parse the headline percent MOVE ("surges 15%", "soars 60%", "down 4.8%") and
 * return the largest, or null. PORTED VERBATIM from
 * src/lib/article-signal-score.ts (branch fix/signal-score-decouple) so the two
 * stay in lockstep. Guards a non-move noun AFTER the sign ("60% of", "5% stake",
 * "4% yield") via lookahead, and a yield/dividend noun BEFORE it via lookbehind.
 * It does NOT guard "30% sales growth" / "26% upside" -- that is the verb gate's
 * job below.
 */
export function parseHeadlineMagnitude(title: string | null | undefined): number | null {
  if (!title) return null;
  const re =
    /(?<!\b(?:yields?|dividend|coupon|payout)\s)(\d{1,3}(?:\.\d+)?)\s*%(?!\s*(?:of|stake|yield|chance|odds|probabilit)\b)/gi;
  let best: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(title)) !== null) {
    const v = parseFloat(m[1]);
    if (Number.isFinite(v) && (best === null || v > best)) best = v;
  }
  return best;
}

// Realized-move verbs, split by direction. A percent is move-grounded only when
// one of these sits adjacent to it (see hasMoveVerbNearPercent). "growth",
// "upside", "stake", "yield", "owns" are intentionally ABSENT: those are the
// non-move percents the gate must exclude.
const UP_VERBS = [
  "surge", "surges", "surged", "surging",
  "soar", "soars", "soared", "soaring",
  "jump", "jumps", "jumped", "jumping",
  "rocket", "rockets", "rocketed", "rocketing",
  "spike", "spikes", "spiked", "spiking",
  "pop", "pops", "popped", "popping",
  "rally", "rallies", "rallied", "rallying",
  "climb", "climbs", "climbed", "climbing",
  "gain", "gains", "gained", "gaining",
  "rise", "rises", "rose", "rising",
  "skyrocket", "skyrockets", "skyrocketed", "skyrocketing",
  "up",
];

const DOWN_VERBS = [
  "plunge", "plunges", "plunged", "plunging",
  "tumble", "tumbles", "tumbled", "tumbling",
  "crash", "crashes", "crashed", "crashing",
  "sink", "sinks", "sank", "sunk", "sinking",
  "plummet", "plummets", "plummeted", "plummeting",
  "slump", "slumps", "slumped", "slumping",
  "slide", "slides", "slid", "sliding",
  "drop", "drops", "dropped", "dropping",
  "fall", "falls", "fell", "fallen", "falling",
  "sink", "tank", "tanks", "tanked", "tanking",
  "crater", "craters", "cratered", "cratering",
  "down",
];

const MOVE_VERBS = new Set([...UP_VERBS, ...DOWN_VERBS]);
const UP_VERB_SET = new Set(UP_VERBS);
const DOWN_VERB_SET = new Set(DOWN_VERBS);

export type MoveDirection = "up" | "down";

// How many word tokens may sit between a move verb and the percent for the gate
// to consider them adjacent. "soaring nearly 60%" -> verb at 0, percent at 2.
const VERB_PERCENT_PROXIMITY = 4;

/** Tokenize a title into lowercase word tokens, keeping the percent token. */
function wordTokens(title: string): string[] {
  // split on whitespace, lowercase, strip surrounding punctuation but keep "%".
  return title
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^[^\w%]+|[^\w%]+$/g, ""))
    .filter((t) => t.length > 0);
}

/**
 * True when a realized-move verb sits within VERB_PERCENT_PROXIMITY tokens of a
 * percent token. This is the load-bearing guard: "30% sales growth" /
 * "26% upside" / "owns 12% stake" have NO move verb near the percent and are
 * excluded; "soaring nearly 60% premarket" / "surges 20%" pass.
 */
export function hasMoveVerbNearPercent(title: string | null | undefined): boolean {
  if (!title) return false;
  const toks = wordTokens(title);
  const pctIdx: number[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (/\d/.test(toks[i]) && toks[i].includes("%")) pctIdx.push(i);
  }
  if (pctIdx.length === 0) return false;
  for (const p of pctIdx) {
    const lo = Math.max(0, p - VERB_PERCENT_PROXIMITY);
    const hi = Math.min(toks.length - 1, p + VERB_PERCENT_PROXIMITY);
    for (let i = lo; i <= hi; i++) {
      if (i === p) continue;
      if (MOVE_VERBS.has(toks[i])) return true;
    }
  }
  return false;
}

// Multi-session PERIOD qualifiers. A percent qualified by one of these is a
// CUMULATIVE / trailing move ("plummets 13% with a 5-day losing streak",
// "plunges 32% in a year", "skyrocketed 87.8% last month", "surges 30% in May",
// "up 71% one-year", "after 28% weekly drop", "165% this year", "YTD"). It is
// NOT a single-session same-day claim, so the price cross-check (which compares
// the claim to ONE session) must not run on it: re-dating it to a single
// inferred session would be wrong, and scanning a volatile name for a matching
// single session produces a false flag. This guard was added after the full-set
// offline validation surfaced exactly this class (CRM "5-day losing streak",
// SMCI "in a Year", MU "Last Month") as the dominant false-positive source the
// recon's 2-example check missed. The single-day senses ("today", "premarket",
// "after hours", "intraday") are intentionally NOT here.
const PERIOD_QUALIFIER_RE =
  /\b(?:this\s+(?:week|month|year|quarter)|last\s+(?:week|month|year|quarter)|year[- ]?to[- ]?date|ytd|one[- ]?year|two[- ]?year|six[- ]?month|6[- ]?month|in\s+(?:a|the|two|three)?\s*(?:day|days|week|weeks|month|months|year|years|january|february|march|april|may|june|july|august|september|october|november|december)|\d+[- ]?day(?:s)?(?:\s+(?:losing|winning))?(?:\s+(?:streak|spree|run|skid|slide|sell[- ]?off))?|weekly|monthly|yearly|losing\s+streak|losing\s+spree|winning\s+streak|since\s+(?:last|debut|ipo|inception)|over\s+the\s+(?:past|last)|past\s+(?:week|month|year|\d+))\b/i;

/**
 * True when the headline's percent is qualified by a multi-session PERIOD word
 * (week/month/year/YTD/"N-day losing streak"/"in May"/...). Such a percent is a
 * cumulative move, not a same-day claim, and is EXCLUDED from the single-session
 * price cross-check. See PERIOD_QUALIFIER_RE.
 */
export function hasPeriodQualifier(title: string | null | undefined): boolean {
  if (!title) return false;
  return PERIOD_QUALIFIER_RE.test(title);
}

/**
 * Infer the claimed move direction from the verb adjacent to the percent.
 * Returns "up"/"down", or null when no move verb is near the percent (gate fail).
 */
export function parseClaimedDirection(title: string | null | undefined): MoveDirection | null {
  if (!title) return null;
  const toks = wordTokens(title);
  const pctIdx: number[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (/\d/.test(toks[i]) && toks[i].includes("%")) pctIdx.push(i);
  }
  if (pctIdx.length === 0) return null;
  // Prefer the verb closest to a percent token.
  let bestDist = Infinity;
  let bestDir: MoveDirection | null = null;
  for (const p of pctIdx) {
    const lo = Math.max(0, p - VERB_PERCENT_PROXIMITY);
    const hi = Math.min(toks.length - 1, p + VERB_PERCENT_PROXIMITY);
    for (let i = lo; i <= hi; i++) {
      if (i === p) continue;
      const dir: MoveDirection | null = UP_VERB_SET.has(toks[i])
        ? "up"
        : DOWN_VERB_SET.has(toks[i])
          ? "down"
          : null;
      if (dir && Math.abs(i - p) < bestDist) {
        bestDist = Math.abs(i - p);
        bestDir = dir;
      }
    }
  }
  return bestDir;
}

// ---------------------------------------------------------------------------
// Ticker resolution
// ---------------------------------------------------------------------------

/** Ticker embedded in the Google News source label, e.g. "Google News (YYGH)". */
export function parseSourceTicker(source: string | null | undefined): string | null {
  if (!source) return null;
  const m = source.match(/Google News \(([^)]+)\)/);
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Price data: daily bars over a lookback window
// ---------------------------------------------------------------------------

export interface DailyBar {
  /** Unix seconds of the session (Yahoo timestamp). */
  ts: number;
  /** Exchange-local calendar day index (floor((ts+gmtoffset)/86400)). */
  day: number;
  open: number;
  close: number;
  high: number;
  low: number;
}

const DAY_SECONDS = 86_400;

/**
 * Parse a Yahoo v8 chart body (interval=1d, range=Nmo) into ordered daily bars.
 * Mirrors the bar-extraction in src/lib/yahoo-daily.ts but keeps O/H/L/C and the
 * exchange-local day index for each session. Never throws; returns [] on garbage.
 */
export function parseYahooDailyBars(chartJson: unknown): DailyBar[] {
  try {
    const result = (chartJson as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as
      | {
          meta?: Record<string, unknown>;
          timestamp?: Array<number | null>;
          indicators?: {
            quote?: Array<{
              open?: Array<number | null>;
              close?: Array<number | null>;
              high?: Array<number | null>;
              low?: Array<number | null>;
            }>;
          };
        }
      | undefined;
    if (!result) return [];
    const meta = result.meta ?? {};
    const gmtoffset = typeof meta.gmtoffset === "number" ? meta.gmtoffset : 0;
    const ts = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    const opens = q.open ?? [];
    const closes = q.close ?? [];
    const highs = q.high ?? [];
    const lows = q.low ?? [];
    const bars: DailyBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      const o = opens[i];
      const c = closes[i];
      const h = highs[i];
      const l = lows[i];
      // Require open+close finite (the move math needs them). High/low fall back
      // to the max/min of open/close when Yahoo null-pads a half-day.
      if (t == null || o == null || c == null || !isFinite(o) || !isFinite(c)) continue;
      const high = h != null && isFinite(h) ? h : Math.max(o, c);
      const low = l != null && isFinite(l) ? l : Math.min(o, c);
      bars.push({ ts: t, day: Math.floor((t + gmtoffset) / DAY_SECONDS), open: o, close: c, high, low });
    }
    bars.sort((a, b) => a.ts - b.ts);
    return bars;
  } catch {
    return [];
  }
}

/** Injectable price fetcher: ticker -> ordered daily bars (oldest first). */
export type DailyBarsFetcher = (ticker: string) => Promise<DailyBar[]>;

/**
 * Default fetcher: Yahoo v8 keyless, range=1mo (covers any pubDate in the 7-day
 * Top Stories window plus the ~10-session lookback). Browser UA bypasses the
 * server-fetch 403. Yahoo uses hyphens for US class shares (BRK-B not BRK.B).
 * Returns [] on any failure (caller fails safe to no-flag).
 */
export async function fetchYahooDailyBars(
  ticker: string,
  opts: { timeoutMs?: number; range?: string } = {},
): Promise<DailyBar[]> {
  const yahooSymbol = ticker.replace(/\./g, "-");
  const range = opts.range ?? "1mo";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahooSymbol,
  )}?interval=1d&range=${encodeURIComponent(range)}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 6000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Signalera/1.0)" },
    });
    if (!res.ok) return [];
    return parseYahooDailyBars(await res.json());
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Per-session realized move
// ---------------------------------------------------------------------------

/**
 * The realized move magnitude (percent, absolute) on a given session, taking the
 * LARGER of the regular-session move (close vs open) and the gap-inclusive move
 * (the session high/low vs the prior close). Premarket / after-hours headlines
 * describe a gap, not a close-vs-open, so the gap path is what catches a
 * "60% premarket" claim. Returns the signed percent (positive = up).
 */
export function sessionRealizedMove(bars: DailyBar[], idx: number): { up: number; down: number } {
  const bar = bars[idx];
  const prior = idx > 0 ? bars[idx - 1] : null;
  // Regular-session move.
  const dayPct = bar.open !== 0 ? ((bar.close - bar.open) / bar.open) * 100 : 0;
  // Gap-inclusive extremes vs prior close (catches premarket spikes that fade).
  let upMove = Math.max(dayPct, 0);
  let downMove = Math.max(-dayPct, 0);
  if (prior && prior.close !== 0) {
    const highPct = ((bar.high - prior.close) / prior.close) * 100;
    const lowPct = ((bar.low - prior.close) / prior.close) * 100;
    const closePct = ((bar.close - prior.close) / prior.close) * 100;
    upMove = Math.max(upMove, highPct, closePct);
    downMove = Math.max(downMove, -lowPct, -closePct);
  }
  return { up: Math.max(0, upMove), down: Math.max(0, downMove) };
}

/**
 * The PERSISTED directional move on a session: the move that survived to the
 * close (the larger of close-vs-open and close-vs-prior-close), NOT the intraday
 * high/low wick. A real "soaring 60%" event gaps up AND holds into the close; a
 * down day with a brief intraday spike to a +77% high (then closing -15%) is NOT
 * a "soaring" event. Using the wick alone re-dated the canonical YYGH "60%
 * premarket" original (true event 06-10, close +32% vs prior) to an EARLIER
 * 06-04 session that merely WICKED +77% on a -15% close day. The offline
 * validation caught exactly that false positive; the persistence check fixes it.
 */
export function sessionPersistedMove(bars: DailyBar[], idx: number): { up: number; down: number } {
  const bar = bars[idx];
  const prior = idx > 0 ? bars[idx - 1] : null;
  const dayPct = bar.open !== 0 ? ((bar.close - bar.open) / bar.open) * 100 : 0;
  let up = dayPct;
  let down = -dayPct;
  if (prior && prior.close !== 0) {
    const closePct = ((bar.close - prior.close) / prior.close) * 100;
    up = Math.max(up, closePct);
    down = Math.max(down, -closePct);
  }
  return { up: Math.max(0, up), down: Math.max(0, down) };
}

/**
 * Does a session's realized move MATCH the claimed move (size + direction)?
 *
 * Tolerance band: the realized magnitude must reach
 * max(claim * MATCH_FLOOR_FRACTION, claim - MATCH_FLOOR_ABS_PP) in the claimed
 * direction. A 60% premarket claim matches a 30% gap (60*0.5 = 30 floor); the
 * band is generous downward because intraday spikes fade by the daily bar.
 *
 * `requirePersistence` (used by the inferred-event scan, NOT the pubDate check):
 * additionally requires the move to have HELD into the close (sessionPersistedMove
 * >= PERSISTENCE_FLOOR_FRACTION * claim). This excludes intraday-wick sessions
 * from being named the "real event day", which is the YYGH-06-04-wick false
 * positive. The pubDate "did it happen here" check stays lenient (no persistence)
 * so a genuine same-day gap-and-fade still counts as "the move happened today"
 * and the row is correctly left fresh.
 */
export const MATCH_FLOOR_FRACTION = 0.5;
// 25pp, not 15pp: a "nearly 60% premarket" headline on a microcap commonly
// realizes as a ~40% gap-and-hold on the daily bar (the premarket spike fades by
// the close). The canonical YYGH event closed +32% / gapped +42% on a "60%"
// claim, so the absolute band must tolerate ~20pp of fade to recognise it.
export const MATCH_FLOOR_ABS_PP = 25;
export const PERSISTENCE_FLOOR_FRACTION = 0.4;

export function sessionMatchesClaim(
  bars: DailyBar[],
  idx: number,
  claimPct: number,
  direction: MoveDirection,
  requirePersistence = false,
): boolean {
  const realized = sessionRealizedMove(bars, idx);
  const got = direction === "up" ? realized.up : realized.down;
  const floor = Math.max(claimPct * MATCH_FLOOR_FRACTION, claimPct - MATCH_FLOOR_ABS_PP);
  if (got < floor) return false;
  if (requirePersistence) {
    const persisted = sessionPersistedMove(bars, idx);
    const held = direction === "up" ? persisted.up : persisted.down;
    if (held < PERSISTENCE_FLOOR_FRACTION * claimPct) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

// Bounded lookback: how many trading sessions before the pubDate session to scan
// for the day the move actually happened.
export const LOOKBACK_SESSIONS = 10;

export interface StaleRepublishInput {
  id: string;
  title: string | null;
  source: string | null;
  /** ISO pubDate (the feed timestamp that may lie). */
  publishedAt: string | null;
  /** Optional explicit ticker (overrides the gnews source label). */
  ticker?: string | null;
}

export type StaleAction = "redate" | "rerank" | "both" | "none";

export interface StaleVerdict {
  stale: boolean;
  /** Why no flag, for shadow-log debuggability. */
  reason:
    | "flagged"
    | "no-magnitude"
    | "no-move-verb"
    | "period-qualified"
    | "no-direction"
    | "no-ticker"
    | "no-pubdate"
    | "no-price-data"
    | "pubdate-bar-missing"
    | "move-on-pubdate"
    | "no-match-in-lookback";
  ticker: string | null;
  claimPct: number | null;
  direction: MoveDirection | null;
  /** Realized move on the pubDate session, in the claimed direction, or null. */
  pubDateMove: number | null;
  /** ISO date (YYYY-MM-DD) of the inferred real event session, or null. */
  inferredEventDate: string | null;
  /** The on-hit action the active path WOULD take. */
  action: StaleAction;
}

function isoDay(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

/** Calendar day index (UTC) for an ISO timestamp, comparable to DailyBar.day. */
function pubDateDayIndex(iso: string): number | null {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000 / DAY_SECONDS);
}

/**
 * Core Layer 1 verdict. Pure given the bars; the fetch is injected so it is
 * unit-testable with no network. FAIL-SAFE at every branch: any uncertainty
 * resolves to { stale: false }.
 */
export function evaluateStaleAgainstBars(input: StaleRepublishInput, bars: DailyBar[]): StaleVerdict {
  const ticker = (input.ticker?.trim() || parseSourceTicker(input.source)) ?? null;
  const claimPct = parseHeadlineMagnitude(input.title);
  const direction = parseClaimedDirection(input.title);

  const base: Omit<StaleVerdict, "stale" | "reason" | "action"> = {
    ticker,
    claimPct,
    direction,
    pubDateMove: null,
    inferredEventDate: null,
  };
  const noFlag = (reason: StaleVerdict["reason"]): StaleVerdict => ({
    ...base,
    stale: false,
    reason,
    action: "none",
  });

  if (claimPct === null) return noFlag("no-magnitude");
  if (!hasMoveVerbNearPercent(input.title)) return noFlag("no-move-verb");
  if (hasPeriodQualifier(input.title)) return noFlag("period-qualified");
  if (direction === null) return noFlag("no-direction");
  if (!ticker) return noFlag("no-ticker");
  if (!input.publishedAt) return noFlag("no-pubdate");
  if (bars.length === 0) return noFlag("no-price-data");

  const pubDay = pubDateDayIndex(input.publishedAt);
  if (pubDay === null) return noFlag("no-pubdate");

  // Locate the pubDate session: the last bar whose session day is <= the pubDate
  // day. (Premarket pubDate on a trading day maps to that day's bar; a weekend
  // pubDate maps to the prior Friday, which is correct -- the move it claims must
  // have a session.)
  let pubIdx = -1;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].day <= pubDay) pubIdx = i;
    else break;
  }
  if (pubIdx < 0) return noFlag("pubdate-bar-missing");

  // Did the claimed move happen on the pubDate session, OR the NEXT session?
  // The next-session check handles the after-hours / late-evening pubDate whose
  // "after hours" / "premarket" move actually prints on the following session's
  // bar (e.g. an "XOS jumps 25% after-hours" row stamped late on day D refers to
  // day D+1's premarket). Without it the back-scan would wrongly re-date such a
  // row to an OLDER session. Either adjacent match => NOT stale (fail safe).
  const adjacentMatch =
    sessionMatchesClaim(bars, pubIdx, claimPct, direction) ||
    (pubIdx + 1 < bars.length && sessionMatchesClaim(bars, pubIdx + 1, claimPct, direction));
  if (adjacentMatch) {
    const realized = sessionRealizedMove(bars, pubIdx);
    return {
      ...base,
      stale: false,
      reason: "move-on-pubdate",
      pubDateMove: direction === "up" ? realized.up : realized.down,
      action: "none",
    };
  }

  // Scan the bounded prior lookback for the session where the move DID happen.
  // requirePersistence=true: the named event day must have HELD the move into the
  // close, not just wicked it intraday, so a brief spike on a down day is never
  // named the real event (the YYGH-06-04-wick false positive).
  const lo = Math.max(0, pubIdx - LOOKBACK_SESSIONS);
  for (let i = pubIdx - 1; i >= lo; i--) {
    if (sessionMatchesClaim(bars, i, claimPct, direction, true)) {
      const realizedPub = sessionRealizedMove(bars, pubIdx);
      return {
        ...base,
        stale: true,
        reason: "flagged",
        pubDateMove: direction === "up" ? realizedPub.up : realizedPub.down,
        inferredEventDate: isoDay(bars[i].ts),
        // BOTH: re-date the displayed recency AND down-rank. Re-dating alone will
        // not sink a relevance-saturated row under a relevance-primary sort; the
        // rank penalty (see applyStaleRankPenalty in top-stories.ts) is what
        // de-pins it. See recon doc Phase D.
        action: "both",
      };
    }
  }

  // The claimed move is nowhere in the lookback: it may be a non-price percent
  // that slipped the verb gate, or a thin ticker. Fail safe to no-flag.
  return noFlag("no-match-in-lookback");
}

/**
 * Full Layer 1 evaluation with the (injectable) price fetch. Default fetcher is
 * Yahoo v8 keyless. Always resolves; never throws.
 */
export async function evaluateStaleRepublish(
  input: StaleRepublishInput,
  fetcher: DailyBarsFetcher = fetchYahooDailyBars,
): Promise<StaleVerdict> {
  const ticker = (input.ticker?.trim() || parseSourceTicker(input.source)) ?? null;
  const claimPct = parseHeadlineMagnitude(input.title);
  // Cheap pre-checks: skip the network entirely when the row can't be Layer-1
  // eligible.
  if (claimPct === null) return evaluateStaleAgainstBars(input, []);
  if (!hasMoveVerbNearPercent(input.title)) return evaluateStaleAgainstBars(input, []);
  if (hasPeriodQualifier(input.title)) return evaluateStaleAgainstBars(input, []);
  if (!ticker) return evaluateStaleAgainstBars(input, []);
  let bars: DailyBar[] = [];
  try {
    bars = await fetcher(ticker);
  } catch {
    bars = [];
  }
  return evaluateStaleAgainstBars(input, bars);
}

// ---------------------------------------------------------------------------
// Shadow logging
// ---------------------------------------------------------------------------

/**
 * In shadow mode, emit one greppable line per flagged row and WRITE NOTHING.
 * Mirrors the BLOCKLIST_SHADOW_DIVERGENCE tag convention in backend/ingest.py.
 * Returns the log line (also returned for testability); a no-op string when the
 * verdict is not stale.
 */
export function shadowLogLine(input: StaleRepublishInput, verdict: StaleVerdict): string | null {
  if (!verdict.stale) return null;
  return (
    `STALE_REPUBLISH_SHADOW id=${input.id} ticker=${verdict.ticker ?? "?"} ` +
    `claim_pct=${verdict.claimPct ?? "?"} dir=${verdict.direction ?? "?"} ` +
    `pubdate=${input.publishedAt ?? "?"} pubdate_move=${verdict.pubDateMove?.toFixed(1) ?? "?"} ` +
    `inferred_event=${verdict.inferredEventDate ?? "?"} layer=1 action=${verdict.action} ` +
    `title=${JSON.stringify((input.title ?? "").slice(0, 120))}`
  );
}

// ---------------------------------------------------------------------------
// Active-path helpers (DEFAULT OFF -- implemented, not enabled)
// ---------------------------------------------------------------------------

/**
 * The corrected ISO recency a render surface SHOULD use when active. In active
 * mode, a stale-flagged row's displayed recency is the inferred event date, not
 * the lying pubDate. In off/shadow mode this returns the original pubDate
 * unchanged (prod-neutral). The dashboard timeAgo call (page.tsx:260) would read
 * this corrected value when, and only when, mode === "active".
 *
 * Durable storage of inferredEventDate needs an `inferred_event_at` column
 * (flip-time human migration); until then the active path computes it at render
 * for the in-window candidate set and persists nothing.
 */
export function correctedRecencyIso(
  mode: StaleRepublishMode,
  originalPublishedAt: string | null,
  verdict: StaleVerdict | null,
): string | null {
  if (mode !== "active") return originalPublishedAt;
  if (verdict?.stale && verdict.inferredEventDate) {
    // Anchor at the session UTC midnight; sufficient for day-granular timeAgo.
    return `${verdict.inferredEventDate}T00:00:00.000Z`;
  }
  return originalPublishedAt;
}

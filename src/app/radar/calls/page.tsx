"use client";

/**
 * Radar / Calls — Tiers 2 and 3. Scored objects with REAL verdicts from
 * the attribution grader (user claims via user_claim_outcomes, adopted
 * calls joined to the ORIGINAL morning_brief_call_outcomes row, brief
 * calls as trackable views), plus a Tier-2 "evidence leaning" thesis
 * strip that is deliberately soft and visually distinct: thesis evidence
 * NEVER renders in the hard Right/Wrong scored-object language.
 *
 * HONESTY RULES enforced here:
 *  - Resolved states only from real outcome rows (scoredCallProps).
 *  - Context-only claims (gradeable=false) render as an explicit
 *    "not graded" absence with their honest gradeability_note; they are
 *    never shown as pending verdicts they will never get.
 *  - The record ring is computed from real graded outcomes only; with
 *    no graded calls it says so instead of showing a hollow 0%.
 *  - confidence_in_reduction and stored LLM confidence are never shown.
 *  - The authoring flow preserves the user's words verbatim as the
 *    headline; only the resolution beneath is standardized.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { AppShell } from "@/components/shell";
import { RadarTabs } from "@/components/radar/RadarTabs";
import { ScoredObject } from "@/components/scored-object/ScoredObject";
import {
  scoredCallProps,
  type CallOutcomeRow,
  type OpenCallInput,
} from "@/lib/scored-object-map";
import { matchFollow, type FollowRow } from "@/lib/radar-following";
import { resolveClaimOutcome } from "@/lib/claim-outcome";
import { TrackedViews } from "@/components/thesis/TrackedViews";
import { EvidenceMap } from "@/components/radar/EvidenceMap";
import type { Article as MapArticle } from "@/lib/clustering-utils";
import { GroupJumpNav, useGroupScrollSpy } from "@/components/radar/GroupJumpNav";
import { useMotionSettled } from "@/lib/use-motion-settled";
import { useTopicClusters } from "@/lib/use-topic-clusters";
import { HorizonChip } from "@/components/calls/HorizonChip";
import {
  CallLedgerLine,
  TrackCallControl,
  TrackTrustLine,
} from "@/components/calls/TrackCallControl";
import {
  DEFAULT_ADOPT_HORIZON,
  horizonFromDates,
  type HorizonType,
} from "@/lib/call-horizons";

const SERIF = "var(--font-playfair-display), serif";

interface UserClaim {
  id: string;
  user_claim: string;
  evidence_entities?: string[] | null;
  claim_type: string;
  target_symbol: string | null;
  expected_direction: string | null;
  resolution_window_start: string | null;
  resolution_window_end: string | null;
  gradeable: boolean;
  gradeability_note: string | null;
  status: string;
  source: "authored" | "adopted";
  adopted_from_call_id: string | null;
  created_at: string;
}

interface BriefCallRow {
  id: string;
  claim_text: string;
  claim_type: string | null;
  target_symbol: string | null;
  brief_date: string | null;
  /** Set at creation from the fixed horizon map. NULL on pre-migration-0014 calls. */
  resolve_on: string | null;
  created_at: string | null;
  confidence: number | null;
}

interface AuthorProposal {
  claim_type: string;
  target_symbol: string | null;
  expected_direction: string | null;
  resolution_window_start: string | null;
  resolution_window_end: string | null;
  evidence_entities: string[];
  gradeable: boolean;
  gradeability_note: string | null;
  confidence_in_reduction: number | null;
  gradeable_alternative: {
    claim_type: string;
    target_symbol: string;
    expected_direction: string;
    resolution_window_start: string;
    resolution_window_end: string;
    rationale: string;
  } | null;
}

type TopMode = "record" | "pinned" | "resolving";
const TOP_MODE_KEY = "radar-calls-top";
const PINNED_KEY = "radar-calls-pinned";

interface BriefGroup {
  id: string;
  label: string;
  calls: BriefCallRow[];
}

function groupSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/**
 * Group brief calls by what they are ABOUT: single-name calls under
 * their company's real sector (from the companies table), then sector
 * calls, indices, and macro. A ticker with no resolved sector lands in
 * an honest "Single names" bucket rather than a guessed sector.
 */
function groupBriefCalls(
  calls: BriefCallRow[],
  tickerSectors: Record<string, string>,
): BriefGroup[] {
  const groups = new Map<string, BriefCallRow[]>();
  const push = (label: string, c: BriefCallRow) => {
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(c);
  };
  for (const c of calls) {
    const type = c.claim_type ?? "";
    if (type === "ticker") {
      push((c.target_symbol && tickerSectors[c.target_symbol]) || "Single names", c);
    } else if (type === "sector") push("Sector calls", c);
    else if (type === "index") push("Indices", c);
    else if (type === "aggregate") push("Macro", c);
    else push("Other", c);
  }
  return [...groups.entries()]
    .map(([label, groupCalls]) => ({ id: groupSlug(label), label, calls: groupCalls }))
    .sort((a, b) => b.calls.length - a.calls.length);
}

function todayPt(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/** A plain sentence for what a call is watching for and how it
 *  resolves, derived from its resolution method. Informative, never
 *  decorative; context-only claims state their honest note. */
function resolutionSentence(c: UserClaim): string {
  if (!c.gradeable) {
    return c.gradeability_note ?? "Tracked as context only; no price resolution.";
  }
  const dir =
    c.expected_direction === "bearish"
      ? "to the downside"
      : c.expected_direction === "neutral"
        ? "by holding flat"
        : "to the upside";
  const windowText =
    c.resolution_window_start && c.resolution_window_start !== c.resolution_window_end
      ? `over ${c.resolution_window_start} to ${c.resolution_window_end}`
      : `against the ${c.resolution_window_end ?? "session"} close`;
  if (c.claim_type === "index") {
    return `Watching whether ${c.target_symbol} moves ${dir} on its own, ${windowText}; indices are graded on their absolute move.`;
  }
  if (c.claim_type === "sector") {
    return `Watching whether ${c.target_symbol} beats SPY ${dir} ${windowText}.`;
  }
  return `Watching whether ${c.target_symbol} beats its sector ETF and SPY ${dir} ${windowText}; a move the market explains is not credited.`;
}

function briefResolutionSentence(c: BriefCallRow): string {
  const h = horizonFromDates(c.brief_date, c.resolve_on);
  // A horizon-bearing call states its real window. A pre-horizons call (NULL
  // resolve_on) keeps the old sentence rather than implying a window it does
  // not have.
  if (h && h.days > 0) {
    return `Resolves over ${c.brief_date} to ${c.resolve_on} with benchmark attribution: only a move beyond sector and market counts.`;
  }
  return `Resolves against the ${c.brief_date ?? "session"} market close with benchmark attribution: only a move beyond sector and market counts.`;
}

// HorizonChip moved to @/components/calls/HorizonChip so BriefCallsSection
// renders the identical chip instead of a second copy. Imported above.

function claimToCallInput(c: UserClaim): OpenCallInput {
  return {
    claim_text: c.user_claim,
    target_symbol: c.target_symbol,
    claim_type: c.claim_type,
    created_at: c.created_at,
    brief_date: c.resolution_window_end ?? c.created_at?.slice(0, 10) ?? null,
  };
}

export default function CallsPage() {
  const motionSettled = useMotionSettled();
  const [claims, setClaims] = useState<UserClaim[]>([]);
  const [tickerSectors, setTickerSectors] = useState<Record<string, string>>({});
  const [claimOutcomes, setClaimOutcomes] = useState<Record<string, CallOutcomeRow>>({});
  const [unavailable, setUnavailable] = useState(false);
  const [briefCalls, setBriefCalls] = useState<BriefCallRow[]>([]);
  const [briefOutcomes, setBriefOutcomes] = useState<Map<string, CallOutcomeRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [topMode, setTopMode] = useState<TopMode>("record");
  const [pinned, setPinned] = useState<string[]>([]);
  const [adoptBusy, setAdoptBusy] = useState<string | null>(null);
  /** Per-call horizon picked in the track control. Defaults per call, not globally. */
  const [adoptHorizon, setAdoptHorizon] = useState<Record<string, HorizonType>>({});
  /** Inline per-call failure text. Replaces the adopt toast, which adopt was
   *  the only writer of; tracking state now resolves in place on the card. */
  const [adoptError, setAdoptError] = useState<Record<string, string>>({});
  /** Calls committed in THIS session. Drives the one-time stamp only; tracked
   *  state itself always comes from the server claims read, so a reload renders
   *  the end state with no animation. */
  const [stamped, setStamped] = useState<Set<string>>(new Set());
  const [mapClaimId, setMapClaimId] = useState<string | null>(null);
  const [mapArticles, setMapArticles] = useState<MapArticle[] | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [draftText, setDraftText] = useState<string | null>(null);
  const [deepLinkThesisId, setDeepLinkThesisId] = useState<string | null>(null);
  const [openViews, setOpenViews] = useState(false);
  /** ?adopt=<call_id> from the Morning Brief email's "Track this thesis" link.
   *  The email is complete as a read; this click exists only because taking a
   *  commitment has to happen on the site. It scrolls the named call into view
   *  and rings it so the track control is unmistakable on arrival. */
  const [adoptCallId, setAdoptCallId] = useState<string | null>(null);

  useEffect(() => {
    // Prefill authoring from ?draft= (Track action on articles elsewhere).
    const params = new URLSearchParams(window.location.search);
    const draft = params.get("draft");
    if (draft) setDraftText(draft.slice(0, 400));
    // Deep links from the retired /radar/theses destination: ?thesis=<id>
    // opens that tracked view inline; ?views=open just opens the section.
    const thesisId = params.get("thesis");
    if (thesisId) setDeepLinkThesisId(thesisId);
    if (params.get("views") === "open") setOpenViews(true);
    const adoptId = params.get("adopt");
    if (adoptId) setAdoptCallId(adoptId);
    const stored = window.localStorage.getItem(TOP_MODE_KEY);
    if (stored === "record" || stored === "pinned" || stored === "resolving") setTopMode(stored);
    try {
      const p = JSON.parse(window.localStorage.getItem(PINNED_KEY) ?? "[]");
      if (Array.isArray(p)) setPinned(p.filter((x): x is string => typeof x === "string"));
    } catch {
      /* fresh start */
    }
  }, []);
  // Deep-linked adopt target: scroll it into view once the calls are on screen.
  // Keyed on briefCalls so it fires after the fetch, not before the node exists.
  useEffect(() => {
    if (!adoptCallId || briefCalls.length === 0) return;
    const node = document.getElementById(`call-${adoptCallId}`);
    if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [adoptCallId, briefCalls]);

  const changeTop = (m: TopMode) => {
    setTopMode(m);
    window.localStorage.setItem(TOP_MODE_KEY, m);
  };
  const togglePin = (id: string) => {
    setPinned((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-6);
      window.localStorage.setItem(PINNED_KEY, JSON.stringify(next));
      return next;
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // User claims + their real outcomes.
      const res = await fetch("/api/radar/claims");
      if (res.ok) {
        const json = await res.json();
        setClaims(json.claims ?? []);
        setClaimOutcomes(json.outcomes ?? {});
        // json.adoptedOutcomes is provenance only and is deliberately not read
        // here: a claim's verdict is its own outcome row. See lib/claim-outcome.
        setUnavailable(Boolean(json.unavailable));
      }

      const sb = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );

      // Recent brief calls (public read) as adoptable tracked views.
      const since = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
      const { data: callRows } = await sb
        .from("morning_brief_calls")
        .select("id, claim_text, claim_type, target_symbol, brief_date, resolve_on, created_at, confidence")
        .gte("brief_date", since)
        .order("brief_date", { ascending: false })
        .limit(20);
      const calls = (callRows as BriefCallRow[] | null) ?? [];
      setBriefCalls(calls);

      // Real sectors for single-name calls, from the companies table;
      // unresolved tickers stay in an honest generic group.
      const symbols = [
        ...new Set(
          calls
            .filter((c) => (c.claim_type ?? "") === "ticker" && c.target_symbol)
            .map((c) => c.target_symbol!),
        ),
      ];
      if (symbols.length) {
        const { data: companyRows } = await sb
          .from("companies")
          .select("ticker, sector")
          .in("ticker", symbols);
        const sectorByTicker: Record<string, string> = {};
        for (const row of (companyRows as { ticker: string | null; sector: string | null }[] | null) ?? []) {
          if (row.ticker && row.sector) sectorByTicker[row.ticker] = row.sector;
        }
        setTickerSectors(sectorByTicker);
      } else {
        setTickerSectors({});
      }

      if (calls.length) {
        const { data: outcomeRows, error: outcomeError } = await sb
          .from("morning_brief_call_outcomes")
          .select(
            "call_id, verdict, attribution, actual_pct_change, actual_direction, verdict_notes, graded_at, metadata",
          )
          .in("call_id", calls.map((c) => c.id));
        if (outcomeError) {
          setBriefOutcomes(null); // least-claiming state: everything Open
        } else {
          const byCall = new Map<string, CallOutcomeRow>();
          for (const o of (outcomeRows as CallOutcomeRow[] | null) ?? []) {
            const prev = byCall.get(o.call_id);
            if (!prev || (o.graded_at ?? "") > (prev.graded_at ?? "")) byCall.set(o.call_id, o);
          }
          setBriefOutcomes(byCall);
        }
      } else {
        setBriefOutcomes(new Map());
      }
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Track a brief call as a forward claim of the user's own, over `horizon`.
   * Resolves inline: the card swaps to a tracked state in place. No toast, no
   * modal, no navigation, so the user never loses their position in the list.
   */
  const adopt = async (callId: string, horizon: HorizonType) => {
    setAdoptBusy(callId);
    setAdoptError((prev) => {
      const next = { ...prev };
      delete next[callId];
      return next;
    });
    try {
      const res = await fetch("/api/radar/claims/adopt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_id: callId, horizon }),
      });
      const json = await res.json();
      if (!res.ok) {
        setStamped((prev) => { const n = new Set(prev); n.delete(callId); return n; });
        setAdoptError((prev) => ({ ...prev, [callId]: json.error ?? "Could not track." }));
        return;
      }
      setStamped((prev) => new Set(prev).add(callId));
      await load();
    } catch {
      setStamped((prev) => { const n = new Set(prev); n.delete(callId); return n; });
      setAdoptError((prev) => ({ ...prev, [callId]: "Could not track." }));
    } finally {
      setAdoptBusy(null);
    }
  };

  const toggleEvidenceMap = async (claim: UserClaim) => {
    if (mapClaimId === claim.id) {
      setMapClaimId(null);
      setMapArticles(null);
      return;
    }
    setMapClaimId(claim.id);
    setMapArticles(null);
    setMapLoading(true);
    try {
      const sb = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      const keywords = [
        ...(claim.evidence_entities ?? []),
        ...(claim.target_symbol ? [claim.target_symbol] : []),
      ].filter(Boolean);
      const synthetic: FollowRow = {
        id: claim.id,
        follow_type: "company",
        target: claim.target_symbol ?? claim.user_claim,
        display_name: null,
        matched_keywords: keywords,
        embedding: null,
        muted: false,
        created_at: claim.created_at,
      };
      const matched = await matchFollow(sb, synthetic, 14);
      setMapArticles(
        matched.map((a) => ({
          ...a,
          source: a.source ?? undefined,
          summary: a.summary ?? undefined,
          url: a.url ?? undefined,
          published_at: a.published_at ?? undefined,
          industry_verticals: a.industry_verticals ?? undefined,
          activity_types: a.activity_types ?? undefined,
        })),
      );
    } catch {
      setMapArticles([]);
    } finally {
      setMapLoading(false);
    }
  };

  const archive = async (id: string) => {
    await fetch("/api/radar/claims", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "archived" }),
    });
    await load();
  };

  // ── Derived: outcome per claim + record math from REAL outcomes only ──
  // One rule for both sources: a claim's verdict is its OWN outcome row.
  // resolveClaimOutcome takes no brief-call map, so the old inheritance through
  // adopted_from_call_id is impossible by construction rather than by care.
  const outcomeForClaim = useCallback(
    (c: UserClaim): CallOutcomeRow | null =>
      resolveClaimOutcome(c, claimOutcomes) as CallOutcomeRow | null,
    [claimOutcomes],
  );

  const record = useMemo(() => {
    let right = 0, wrong = 0, noCleanRead = 0, notGraded = 0, open = 0;
    for (const c of claims) {
      const o = outcomeForClaim(c);
      if (!o) {
        if (!c.gradeable && c.source === "authored") notGraded += 1;
        else open += 1;
        continue;
      }
      if (o.verdict === "ungradable" || o.attribution == null) notGraded += 1;
      else if (o.attribution !== "clean") noCleanRead += 1;
      else if (o.verdict === "correct") right += 1;
      else if (o.verdict === "wrong") wrong += 1;
      else noCleanRead += 1; // partial + clean: graded, no attributable hit
    }
    const graded = right + wrong;
    return { right, wrong, noCleanRead, notGraded, open, graded,
      hitRate: graded > 0 ? right / graded : null };
  }, [claims, outcomeForClaim]);

  const resolvingSoon = useMemo(
    () =>
      claims
        .filter((c) => c.gradeable && c.status === "open" && c.resolution_window_end)
        .sort((a, b) => (a.resolution_window_end! < b.resolution_window_end! ? -1 : 1))
        .slice(0, 5),
    [claims],
  );
  const pinnedClaims = useMemo(
    () => claims.filter((c) => pinned.includes(c.id)),
    [claims, pinned],
  );

  const briefGroups = useMemo(
    () => groupBriefCalls(briefCalls.slice(0, 12), tickerSectors),
    [briefCalls, tickerSectors],
  );
  const briefSpy = useGroupScrollSpy(briefGroups.map((g) => g.id));

  // Shared clustering resource for the per-claim evidence map.
  const mapArticleIds = useMemo(() => (mapArticles ?? []).map((a) => a.id), [mapArticles]);
  const claimClusters = useTopicClusters(mapArticleIds.length >= 4 ? mapArticleIds : null);

  const today = todayPt();

  return (
    <AppShell pageTitle="Radar">
      <div
        data-radar-page
        data-motion-settling={motionSettled ? undefined : ""}
        className="motion-page-enter p-6 max-w-[1080px]"
      >
        <RadarTabs active="calls" />

        {loading ? null : (
          <>
            {unavailable && (
              <p className="mb-4 rounded-lg border border-border-subtle bg-elevated px-4 py-3 font-sans text-[12px] text-signal-warn">
                Your calls storage is not set up yet (migration pending). Brief
                calls below still show their real grades.
              </p>
            )}

            {/* ── Premium top: three equally-built options ── */}
            <div className="mb-2 flex items-center justify-end gap-1 font-sans text-[12px]">
              {(
                [
                  ["record", "Record"],
                  ["pinned", "Pinned"],
                  ["resolving", "Resolving soon"],
                ] as [TopMode, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => changeTop(key)}
                  className={
                    "rounded-md px-2.5 py-1 " +
                    (topMode === key
                      ? "bg-espresso font-semibold text-cream dark:bg-overlay dark:text-foreground"
                      : "text-text-muted hover:text-text-primary")
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <div key={topMode} className="motion-rise-in">
              {topMode === "record" && <RecordHero record={record} />}
              {topMode === "pinned" && (
                <PinnedHero claims={pinnedClaims} today={today} outcomeFor={outcomeForClaim} />
              )}
              {topMode === "resolving" && <ResolvingHero claims={resolvingSoon} today={today} />}
            </div>

            {/* ── Authoring ── */}
            <AuthorClaim onSaved={load} disabled={unavailable} initialText={draftText} />

            {/* ── Your calls ── */}
            <section className="mt-8">
              <h2 className="mb-3 font-sans text-[12px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                Your calls
              </h2>
              {claims.length === 0 ? (
                <p className="rounded-lg border border-border-subtle bg-elevated px-4 py-4 font-sans text-[13px] text-text-muted">
                  No calls tracked yet. Put one in your own words above, or
                  adopt a call from the brief below; verdicts come from real
                  outcomes only.
                </p>
              ) : (
                <div className="motion-stagger grid gap-3 md:grid-cols-2">
                  {claims.map((c) => {
                    const outcome = outcomeForClaim(c);
                    let props = scoredCallProps(claimToCallInput(c), outcome, today);
                    if (!outcome && !c.gradeable && c.source === "authored") {
                      // Context-only: never gets a verdict; say so instead of
                      // rendering an eternal Open.
                      props = {
                        ...props,
                        state: "notGraded",
                        notGradedReason:
                          c.gradeability_note ?? "Tracked as context only.",
                      };
                    }
                    return (
                      <div key={c.id} className="group">
                        <div className="mb-1 flex items-baseline justify-between px-1 font-sans text-[11px] text-text-faint">
                          <span>
                            {c.source === "adopted"
                              ? "Adopted from the brief"
                              : "Your call"}
                          </span>
                          <span className="flex gap-2">
                            <button
                              onClick={() => void toggleEvidenceMap(c)}
                              className="hover:text-text-primary"
                            >
                              {mapClaimId === c.id ? "Hide map" : "Evidence map"}
                            </button>
                            <button
                              onClick={() => togglePin(c.id)}
                              className="hover:text-text-primary"
                            >
                              {pinned.includes(c.id) ? "Unpin" : "Pin"}
                            </button>
                            <button
                              onClick={() => void archive(c.id)}
                              className="hover:text-signal-dn"
                            >
                              Archive
                            </button>
                          </span>
                        </div>
                        <div className="card-hover-lift">
                          <ScoredObject {...props} />
                        </div>
                        <p className="motion-fade-reveal mt-1 px-1 font-sans text-[11px] leading-snug text-text-muted">
                          {resolutionSentence(c)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
              {mapClaimId && (
                <div className="mt-4">
                  {mapLoading ? (
                    <p className="font-sans text-[12px] text-text-faint">
                      Matching the corpus…
                    </p>
                  ) : mapArticles ? (
                    <EvidenceMap
                      centerLabel={
                        claims.find((c) => c.id === mapClaimId)?.user_claim ?? ""
                      }
                      articles={mapArticles}
                      tree={claimClusters.tree}
                      clusterStatus={claimClusters.status}
                      onVisibleNodes={claimClusters.labelNodes}
                    />
                  ) : null}
                </div>
              )}
            </section>

            {/* ── From the brief (Tier 3 tracked views, adoptable) ── */}
            <section className="mt-8">
              <h2 className="mb-3 font-sans text-[12px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                From the brief
                <span className="ml-2 font-normal normal-case tracking-normal text-text-faint">
                  last 14 days · graded by the attribution grader
                </span>
              </h2>
              {briefCalls.length === 0 ? (
                <p className="rounded-lg border border-border-subtle bg-elevated px-4 py-4 font-sans text-[13px] text-text-muted">
                  No brief calls captured in the last two weeks.
                </p>
              ) : (
                <>
                <GroupJumpNav
                  groups={briefGroups.map((g) => ({ id: g.id, label: g.label, count: g.calls.length }))}
                  activeId={briefSpy.activeId}
                  onSelect={briefSpy.jumpTo}
                  ariaLabel="Jump to call group"
                  bleed
                />
                {briefGroups.map((group) => (
                <div key={group.id} id={`group-${group.id}`} className="mb-6 scroll-mt-14 last:mb-0">
                  <h3 className="mb-2.5 flex items-baseline gap-2 border-b border-border-subtle pb-1.5 font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                    {group.label}
                    <span className="font-mono text-[10px] font-normal" style={{ color: "var(--gold)" }}>
                      {group.calls.length}
                    </span>
                  </h3>
                <div className="motion-stagger grid gap-3 md:grid-cols-2">
                  {group.calls.map((c) => {
                    const props = briefOutcomes
                      ? scoredCallProps(c, briefOutcomes.get(c.id) ?? null, today)
                      : scoredCallProps(c, null, c.brief_date ?? today);
                    const trackedClaim = claims.find(
                      (uc) => uc.adopted_from_call_id === c.id,
                    );
                    const chosen = adoptHorizon[c.id] ?? DEFAULT_ADOPT_HORIZON;
                    return (
                      <div
                        key={c.id}
                        id={`call-${c.id}`}
                        className={`group scroll-mt-24 ${
                          trackedClaim ? "call-tracked-edge " : ""
                        }${
                          adoptCallId === c.id
                            ? "rounded-lg ring-2 ring-[var(--gold)]"
                            : ""
                        }`}
                      >
                        <div className="mb-1 flex items-baseline justify-between gap-2 px-1 font-sans text-[11px] text-text-faint">
                          <span className="flex items-baseline gap-1.5">
                            Signalera brief · {c.brief_date}
                            <HorizonChip anchor={c.brief_date} resolveOn={c.resolve_on} />
                          </span>
                          {/* Shared control (@/components/calls/TrackCallControl).
                              Present on EVERY call including already-scored ones:
                              tracking is a fresh forward claim from today over the
                              user's own window, not a re-run of the brief's
                              already-settled verdict. */}
                          <TrackCallControl
                            callId={c.id}
                            tracked={trackedClaim ?? null}
                            available={!unavailable}
                            busy={adoptBusy === c.id}
                            horizon={chosen}
                            onHorizonChange={(h) =>
                              setAdoptHorizon((prev) => ({ ...prev, [c.id]: h }))
                            }
                            onTrack={() => void adopt(c.id, chosen)}
                            justStamped={stamped.has(c.id)}
                          />
                        </div>
                        <div className="card-hover-lift">
                          <ScoredObject {...props} />
                        </div>
                        {/* Committed: the ledger entry. Not committed: the reason to. */}
                        {trackedClaim ? (
                          <CallLedgerLine claim={trackedClaim} justStamped={stamped.has(c.id)} />
                        ) : !unavailable ? (
                          <TrackTrustLine callId={c.id} />
                        ) : null}
                        <p className="motion-fade-reveal mt-1 px-1 font-sans text-[11px] leading-snug text-text-muted">
                          {briefResolutionSentence(c)}
                        </p>
                        {adoptError[c.id] && (
                          <p className="mt-1 px-1 font-sans text-[11px] text-text-muted">
                            {adoptError[c.id]}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                </div>
                ))}
                </>
              )}
            </section>

            {/* ── Tier 2: the thesis workspace, folded in as TRACKED
                 VIEWS. Deliberately demoted below the graded calls:
                 soft evidence leanings, LLM-judged, never Right/Wrong.
                 Detail (evidence feed, why-this-thesis, notes, archive,
                 review timeline) expands in place; no separate page. ── */}
            <TrackedViews initialThesisId={deepLinkThesisId} initialOpen={openViews} />
          </>
        )}
      </div>
    </AppShell>
  );
}

/* ── Premium top options ── */

function RecordHero({
  record,
}: {
  record: {
    right: number; wrong: number; noCleanRead: number; notGraded: number;
    open: number; graded: number; hitRate: number | null;
  };
}) {
  const R = 34;
  const C = 2 * Math.PI * R;
  return (
    <div className="mb-6 flex items-center gap-6 rounded-xl bg-espresso px-6 py-5 text-cream dark:border dark:border-border-default dark:bg-elevated">
      <div className="relative h-24 w-24 shrink-0">
        <svg viewBox="0 0 84 84" className="h-24 w-24 -rotate-90">
          <circle cx="42" cy="42" r={R} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="7" />
          {record.hitRate != null && (
            <circle
              cx="42" cy="42" r={R} fill="none"
              stroke="var(--gold)" strokeWidth="7" strokeLinecap="round"
              strokeDasharray={`${C * record.hitRate} ${C}`}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-[17px] font-bold">
            {record.hitRate != null ? `${Math.round(record.hitRate * 100)}%` : "—"}
          </span>
        </div>
      </div>
      <div className="font-sans text-[13px]">
        {record.hitRate != null ? (
          <p className="text-[15px] font-semibold">
            {record.right} right · {record.wrong} wrong
            <span className="ml-1 font-normal opacity-70">on clean attribution</span>
          </p>
        ) : (
          <p className="text-[15px] font-semibold">No graded calls yet.</p>
        )}
        <p className="mt-1 opacity-70">
          {record.noCleanRead} no clean read · {record.notGraded} not graded ·{" "}
          {record.open} open
        </p>
        <p className="mt-1.5 text-[11px] opacity-50">
          Earned from real outcomes only; confounded moves are never counted
          as hits.
        </p>
      </div>
    </div>
  );
}

function windowProgress(c: UserClaim, today: string): number {
  if (!c.resolution_window_start || !c.resolution_window_end) return 0;
  const start = new Date(c.resolution_window_start).getTime();
  const end = new Date(c.resolution_window_end).getTime();
  const now = new Date(today).getTime();
  if (end <= start) return 1;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

function PinnedHero({
  claims,
  today,
  outcomeFor,
}: {
  claims: UserClaim[];
  today: string;
  outcomeFor: (c: UserClaim) => CallOutcomeRow | null;
}) {
  if (claims.length === 0) {
    return (
      <div className="mb-6 rounded-xl border border-border-subtle bg-elevated px-5 py-4 font-sans text-[13px] text-text-muted">
        Nothing pinned. Pin a call from the list below to keep it up here.
      </div>
    );
  }
  return (
    <div className="mb-6 grid gap-3 md:grid-cols-3">
      {claims.map((c) => {
        const progress = windowProgress(c, today);
        const o = outcomeFor(c);
        return (
          <div
            key={c.id}
            className="rounded-lg border-l-2 border border-border-subtle bg-elevated px-4 py-3"
            style={{ borderLeftColor: "var(--gold)" }}
          >
            <p
              className="text-text-primary"
              style={{ fontFamily: SERIF, fontSize: "13px", lineHeight: 1.35, fontWeight: 600 }}
            >
              {c.user_claim}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <svg viewBox="0 0 20 20" className="h-4 w-4 -rotate-90">
                <circle cx="10" cy="10" r="8" fill="none" stroke="var(--border-hi)" strokeWidth="3" />
                <circle
                  cx="10" cy="10" r="8" fill="none" stroke="var(--gold)" strokeWidth="3"
                  strokeDasharray={`${2 * Math.PI * 8 * progress} ${2 * Math.PI * 8}`}
                />
              </svg>
              <span className="font-sans text-[11px] text-text-faint">
                {o
                  ? "Resolved"
                  : c.resolution_window_end
                    ? `Resolves ${c.resolution_window_end}`
                    : "Context only"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ResolvingHero({ claims, today }: { claims: UserClaim[]; today: string }) {
  if (claims.length === 0) {
    return (
      <div className="mb-6 rounded-xl border border-border-subtle bg-elevated px-5 py-4 font-sans text-[13px] text-text-muted">
        Nothing resolving soon. Gradeable calls appear here as their windows
        close.
      </div>
    );
  }
  return (
    <div className="mb-6 space-y-2">
      {claims.map((c) => {
        const progress = windowProgress(c, today);
        return (
          <div key={c.id} className="rounded-lg border border-border-subtle bg-elevated px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p
                className="min-w-0 flex-1 truncate text-text-primary"
                style={{ fontFamily: SERIF, fontSize: "13px", fontWeight: 600 }}
              >
                {c.user_claim}
              </p>
              <span className="shrink-0 font-mono text-[11px] text-text-faint">
                {c.resolution_window_end}
              </span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-border-subtle">
              <div className="h-1 rounded-full" style={{ width: `${progress * 100}%`, backgroundColor: "var(--gold)" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Authoring flow ── */

function AuthorClaim({
  onSaved,
  disabled,
  initialText,
}: {
  onSaved: () => Promise<void>;
  disabled: boolean;
  initialText?: string | null;
}) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (initialText) setText(initialText);
  }, [initialText]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<AuthorProposal | null>(null);
  const [proposedFor, setProposedFor] = useState("");

  const propose = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/radar/claims/author", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim_text: text.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not analyze the claim.");
        return;
      }
      setProposal(json.proposal);
      setProposedFor(json.user_claim);
    } catch {
      setError("Could not analyze the claim.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!proposal) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/radar/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_claim: proposedFor, ...proposal }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not save the call.");
        return;
      }
      setProposal(null);
      setText("");
      await onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-border-subtle bg-elevated px-5 py-4">
      <h2 className="font-sans text-[12px] font-semibold uppercase tracking-[0.14em] text-text-muted">
        Make a call
      </h2>
      {!proposal ? (
        <>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) void propose();
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={400}
              disabled={disabled}
              placeholder="In your own words, e.g. NVDA gives back the ramp hype by earnings"
              className="flex-1 rounded-md border border-border-default bg-transparent px-3 py-2 font-sans text-[13px] text-text-primary outline-none focus:border-gold disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || disabled || !text.trim()}
              className="rounded-md bg-espresso px-3.5 py-2 font-sans text-[13px] font-semibold text-cream disabled:opacity-50 dark:bg-overlay dark:text-foreground"
            >
              {busy ? "Analyzing…" : "Propose"}
            </button>
          </form>
          <p className="mt-2 font-sans text-[11px] text-text-faint">
            Your words stay the headline. We only standardize how it resolves;
            if it cannot be graded honestly, it is tracked as context and says
            so.
          </p>
        </>
      ) : (
        <div className="mt-3">
          {/* The user's words, verbatim, as the headline. */}
          <p
            className="text-text-primary"
            style={{ fontFamily: SERIF, fontSize: "17px", lineHeight: 1.35, fontWeight: 600 }}
          >
            {proposedFor}
          </p>
          <div className="mt-3 rounded-md border border-border-subtle px-3.5 py-3 font-sans text-[12px] text-text-secondary">
            {proposal.gradeable ? (
              <>
                <p>
                  <span className="font-semibold">Resolves by price attribution:</span>{" "}
                  {proposal.target_symbol} · {proposal.expected_direction} ·
                  window {proposal.resolution_window_start} →{" "}
                  {proposal.resolution_window_end}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5">
                    Direction
                    <select
                      value={proposal.expected_direction ?? "bullish"}
                      onChange={(e) =>
                        setProposal({ ...proposal, expected_direction: e.target.value })
                      }
                      className="rounded border border-border-default bg-transparent px-1.5 py-0.5"
                    >
                      <option value="bullish">bullish</option>
                      <option value="bearish">bearish</option>
                      <option value="neutral">neutral</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5">
                    Window ends
                    <input
                      type="date"
                      value={proposal.resolution_window_end ?? ""}
                      onChange={(e) =>
                        setProposal({ ...proposal, resolution_window_end: e.target.value })
                      }
                      className="rounded border border-border-default bg-transparent px-1.5 py-0.5"
                    />
                  </label>
                </div>
              </>
            ) : (
              <>
                <p>
                  <span className="font-semibold">Not price-gradeable as written:</span>{" "}
                  {proposal.gradeability_note}
                </p>
                {proposal.gradeable_alternative && (
                  <p className="mt-1.5 text-text-faint">
                    Proxy that captures the intent:{" "}
                    {proposal.gradeable_alternative.rationale}
                  </p>
                )}
              </>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 font-sans text-[13px]">
            {/* Propose-and-confirm, not reject: a one-tap gradeable proxy
                when the claim as written cannot be price-graded. The user's
                words stay the headline either way. */}
            {!proposal.gradeable && proposal.gradeable_alternative && (
              <button
                onClick={() => {
                  const alt = proposal.gradeable_alternative!;
                  setProposal({
                    ...proposal,
                    claim_type: alt.claim_type,
                    target_symbol: alt.target_symbol,
                    expected_direction: alt.expected_direction,
                    resolution_window_start: alt.resolution_window_start,
                    resolution_window_end: alt.resolution_window_end,
                    gradeable: true,
                    gradeability_note: null,
                  });
                }}
                className="rounded-md border px-3.5 py-1.5 font-semibold text-espresso dark:text-foreground"
                style={{ borderColor: "var(--gold)", backgroundColor: "color-mix(in srgb, var(--gold) 12%, transparent)" }}
              >
                Make it gradeable: {proposal.gradeable_alternative.target_symbol} ·{" "}
                {proposal.gradeable_alternative.expected_direction} · by{" "}
                {proposal.gradeable_alternative.resolution_window_end}
              </button>
            )}
            <button
              onClick={() => void confirm()}
              disabled={busy}
              className="rounded-md bg-espresso px-3.5 py-1.5 font-semibold text-cream disabled:opacity-50 dark:bg-overlay dark:text-foreground"
            >
              {busy ? "Saving…" : proposal.gradeable ? "Track it" : "Track as context"}
            </button>
            <button
              onClick={() => setProposal(null)}
              className="rounded-md px-3 py-1.5 text-text-muted hover:text-text-primary"
            >
              Edit words
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 font-sans text-[12px] text-signal-dn">{error}</p>}
    </section>
  );
}

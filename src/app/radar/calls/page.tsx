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
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import { AppShell } from "@/components/shell";
import { RadarTabs } from "@/components/radar/RadarTabs";
import { ScoredObject } from "@/components/scored-object/ScoredObject";
import {
  scoredCallProps,
  type CallOutcomeRow,
  type OpenCallInput,
} from "@/lib/scored-object-map";
import {
  neutralizeThesisTitle,
  verdictDisplayLabel,
} from "@/lib/track-record-live-score";
import { matchFollow, type FollowRow } from "@/lib/radar-following";
import { EvidenceMap } from "@/components/radar/EvidenceMap";
import type { Article as MapArticle } from "@/lib/clustering-utils";

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
  created_at: string | null;
  confidence: number | null;
}

interface ThesisLean {
  id: string;
  title: string;
  sector: string | null;
  live_verdict: string | null;
  outcome: string | null;
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

const BRIEF_GROUPS: { key: string; label: string }[] = [
  { key: "ticker", label: "Single names" },
  { key: "sector", label: "Sectors" },
  { key: "index", label: "Indices" },
  { key: "aggregate", label: "Macro" },
];

function groupBriefCalls(calls: BriefCallRow[]): { label: string; calls: BriefCallRow[] }[] {
  return BRIEF_GROUPS.map((g) => ({
    label: g.label,
    calls: calls.filter((c) => (c.claim_type ?? "") === g.key),
  }))
    .concat([{ label: "Other", calls: calls.filter((c) => !BRIEF_GROUPS.some((g) => g.key === (c.claim_type ?? ""))) }])
    .filter((g) => g.calls.length > 0)
    .sort((a, b) => b.calls.length - a.calls.length);
}

function todayPt(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/** A plain sentence for what a call is watching for and how it
 *  resolves, derived from its resolution method. Informative, never
 *  decorative; context-only claims state their honest note. */
function resolutionSentence(c: UserClaim): string {
  if (c.source === "adopted") {
    return `Resolves with the original brief call against the ${c.resolution_window_end ?? "session"} market close, with benchmark attribution.`;
  }
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
  return `Resolves against the ${c.brief_date ?? "session"} market close with benchmark attribution: only a move beyond sector and market counts.`;
}

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
  const [claims, setClaims] = useState<UserClaim[]>([]);
  const [claimOutcomes, setClaimOutcomes] = useState<Record<string, CallOutcomeRow>>({});
  const [adoptedOutcomes, setAdoptedOutcomes] = useState<Record<string, CallOutcomeRow>>({});
  const [unavailable, setUnavailable] = useState(false);
  const [briefCalls, setBriefCalls] = useState<BriefCallRow[]>([]);
  const [briefOutcomes, setBriefOutcomes] = useState<Map<string, CallOutcomeRow> | null>(null);
  const [theses, setTheses] = useState<ThesisLean[]>([]);
  const [loading, setLoading] = useState(true);
  const [topMode, setTopMode] = useState<TopMode>("record");
  const [pinned, setPinned] = useState<string[]>([]);
  const [adoptBusy, setAdoptBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [leaningsOpen, setLeaningsOpen] = useState(false);
  const [mapClaimId, setMapClaimId] = useState<string | null>(null);
  const [mapArticles, setMapArticles] = useState<MapArticle[] | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [draftText, setDraftText] = useState<string | null>(null);

  useEffect(() => {
    // Prefill authoring from ?draft= (Track action on articles elsewhere).
    const draft = new URLSearchParams(window.location.search).get("draft");
    if (draft) setDraftText(draft.slice(0, 400));
    const stored = window.localStorage.getItem(TOP_MODE_KEY);
    if (stored === "record" || stored === "pinned" || stored === "resolving") setTopMode(stored);
    try {
      const p = JSON.parse(window.localStorage.getItem(PINNED_KEY) ?? "[]");
      if (Array.isArray(p)) setPinned(p.filter((x): x is string => typeof x === "string"));
    } catch {
      /* fresh start */
    }
  }, []);
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
        setAdoptedOutcomes(json.adoptedOutcomes ?? {});
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
        .select("id, claim_text, claim_type, target_symbol, brief_date, created_at, confidence")
        .gte("brief_date", since)
        .order("brief_date", { ascending: false })
        .limit(20);
      const calls = (callRows as BriefCallRow[] | null) ?? [];
      setBriefCalls(calls);
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

      // Tier-2: theses as soft evidence leanings.
      const { data: thesisRows } = await sb
        .from("theses")
        .select("id, title, sector, live_verdict, outcome")
        .order("generated_at", { ascending: false })
        .limit(6);
      setTheses((thesisRows as ThesisLean[] | null) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const adopt = async (callId: string) => {
    setAdoptBusy(callId);
    try {
      const res = await fetch("/api/radar/claims/adopt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_id: callId }),
      });
      const json = await res.json();
      setToast(
        res.ok
          ? json.alreadyAdopted
            ? "Already in your calls."
            : "Tracking this call."
          : (json.error ?? "Could not adopt."),
      );
      if (res.ok) await load();
    } finally {
      setAdoptBusy(null);
      setTimeout(() => setToast(null), 2500);
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
  const outcomeForClaim = useCallback(
    (c: UserClaim): CallOutcomeRow | null => {
      if (c.source === "adopted") {
        return c.adopted_from_call_id
          ? ((adoptedOutcomes[c.adopted_from_call_id] as CallOutcomeRow | undefined) ?? null)
          : null;
      }
      const o = claimOutcomes[c.id] as (CallOutcomeRow & { claim_id?: string }) | undefined;
      return o ? { ...o, call_id: o.claim_id ?? c.id } : null;
    },
    [adoptedOutcomes, claimOutcomes],
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

  const today = todayPt();

  return (
    <AppShell pageTitle="Radar">
      <div data-radar-page className="motion-page-enter p-6 max-w-[1080px]">
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
                groupBriefCalls(briefCalls.slice(0, 12)).map((group) => (
                <div key={group.label} className="mb-6 last:mb-0">
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
                    const alreadyAdopted = claims.some(
                      (uc) => uc.adopted_from_call_id === c.id,
                    );
                    return (
                      <div key={c.id} className="group">
                        <div className="mb-1 flex items-baseline justify-between px-1 font-sans text-[11px] text-text-faint">
                          <span>Signalera brief · {c.brief_date}</span>
                          <button
                            disabled={adoptBusy === c.id || alreadyAdopted || unavailable}
                            onClick={() => void adopt(c.id)}
                            className="hover:text-text-primary disabled:opacity-50"
                          >
                            {alreadyAdopted
                              ? "Tracking"
                              : adoptBusy === c.id
                                ? "Adopting…"
                                : "Track this call"}
                          </button>
                        </div>
                        <div className="card-hover-lift">
                          <ScoredObject {...props} />
                        </div>
                        <p className="motion-fade-reveal mt-1 px-1 font-sans text-[11px] leading-snug text-text-muted">
                          {briefResolutionSentence(c)}
                        </p>
                      </div>
                    );
                  })}
                </div>
                </div>
                ))
              )}
            </section>

            {/* ── Tier 2: theses as SOFT evidence leanings. Deliberately
                 DEMOTED behind a default-closed disclosure: the primary
                 Calls experience is the user's own graded calls, not the
                 system-thesis workstation. ── */}
            {theses.length > 0 && (
              <section className="mt-8 border-t border-border-subtle pt-4">
                <button
                  onClick={() => setLeaningsOpen((v) => !v)}
                  className="flex w-full items-baseline justify-between gap-3 text-left"
                >
                  <span className="font-sans text-[12px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                    Evidence leanings
                    <span className="ml-2 font-normal normal-case tracking-normal text-text-faint">
                      {theses.length} system theses · LLM-judged, not verdicts
                    </span>
                  </span>
                  <span className="font-sans text-[12px] text-text-faint">
                    {leaningsOpen ? "Hide" : "Show"}
                  </span>
                </button>
                {leaningsOpen && (
                  <div className="mt-3">
                    <p className="mb-3 font-sans text-[12px] text-text-faint">
                      Theses graded by evidence review, not benchmark
                      attribution. A leaning is not a verdict; the full
                      workspace is in{" "}
                      <Link href="/radar/theses" className="underline hover:text-text-primary">
                        the evidence workspace
                      </Link>{" "}
                      and the{" "}
                      <Link href="/radar/track-record" className="underline hover:text-text-primary">
                        Tracker
                      </Link>
                      .
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {theses.map((t) => (
                        <Link
                          key={t.id}
                          href={`/radar/theses?thesis=${t.id}`}
                          className="flex items-baseline justify-between gap-3 rounded-md px-3 py-2 hover:bg-overlay"
                        >
                          <span
                            className="min-w-0 flex-1 truncate text-text-secondary"
                            style={{ fontFamily: SERIF, fontSize: "14px" }}
                          >
                            {neutralizeThesisTitle(t.title)}
                          </span>
                          <span className="shrink-0 font-sans text-[11px] italic text-text-muted">
                            {verdictDisplayLabel(t.live_verdict ?? "Awaiting verdict")}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {toast && (
              <div className="fixed bottom-6 right-6 rounded-md bg-espresso px-4 py-2 font-sans text-[13px] text-cream shadow-lg dark:bg-overlay dark:text-foreground">
                {toast}
              </div>
            )}
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

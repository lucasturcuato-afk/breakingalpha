"use client";

/**
 * BriefCallsSection - the desk's calls, organized by what the reader can DO.
 *
 * Three layers, in order of usefulness:
 *   LIVE      the desk's OPEN, ungraded calls across recent briefs, freshest
 *             first, each with the one-tap track control. This is the
 *             actionable layer; a resolved call never appears here and never
 *             carries a track affordance.
 *   RECORD    the desk's graded accuracy, computed from ALL real outcome rows
 *             and shown ONCE at section level as a trust signal, not as a
 *             scoreboard of stale calls mixed into today's action.
 *   THIS BRIEF the brief's own calls that have resolved, each shown with its
 *             real outcome and then a forward hook: the most specific REAL
 *             related object that already exists (an open desk call on the
 *             same symbol or sector, or an emerging Radar trend cluster - see
 *             @/lib/brief-call-related). If nothing real matches, it says
 *             "no related live call yet" rather than inventing one.
 *
 * Data is real end to end: calls come from morning_brief_calls and verdicts
 * from morning_brief_call_outcomes (both public-readable), written by the
 * attribution grader. A call renders a resolved state ONLY when a real
 * outcome row exists; otherwise it is Open (window still live) or an honest
 * "Not graded" (window closed, no credible grade). No verdict is ever
 * fabricated, and the stored LLM confidence is never rendered.
 *
 * Fail-soft, stated: if the open-pool read errors the LIVE layer says so; if
 * the outcomes read errors the record says "unavailable" and this brief's
 * calls fall back to Open (the least-claiming state). Errors are never
 * rendered as emptiness.
 *
 * The track control is the SAME affordance as the Radar calls page: same
 * horizon vocabulary (@/lib/call-horizons), same POST to
 * /api/radar/claims/adopt. Nothing about adopting is reimplemented here.
 */

import { useCallback, useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { ScoredObject } from "@/components/scored-object/ScoredObject";
import {
  openCallProps,
  scoredCallProps,
  shortDate,
  type CallOutcomeRow,
} from "@/lib/scored-object-map";
import {
  adoptWindowForCall,
  adoptWindowRequest,
  adoptWindowValue,
  isPriceableClaimType,
  type AdoptWindow,
} from "@/lib/call-horizons";
import {
  CallCommitFooter,
  CallsTrustLine,
  hasCommitFooter,
} from "@/components/calls/TrackCallControl";
import {
  findNextToWatch,
  type EmergingCluster,
  type RelatedNext,
} from "@/lib/brief-call-related";
import { trackClientEvent } from "@/lib/track-event";
import { notifyRadarLanded } from "@/lib/radar-landed";
import { buildTrackProvenance } from "@/lib/call-track-provenance";
import {
  readProvenance,
  secondsSinceObjectFirstInView,
} from "@/lib/attention-context";

interface BriefCall {
  id: string;
  claim_text: string;
  target_symbol: string | null;
  claim_type: string | null;
  confidence: number | null;
  created_at: string | null;
  brief_date: string | null;
  /** Set at creation from the fixed horizon map. NULL on pre-migration-0014 calls. */
  resolve_on: string | null;
}

/** The subset of a user_claims row this component needs to show tracked state. */
interface TrackedClaim {
  id: string;
  adopted_from_call_id: string | null;
  resolution_window_start: string | null;
  resolution_window_end: string | null;
}

type LoadState = "loading" | "loaded" | "error";

/** One trust line per section; every card's button describes itself with it. */
const TRUST_LINE_ID = "brief-calls-track-why";

/** How many open desk calls the LIVE layer shows. */
const LIVE_MAX = 5;

/** How far back the open-pool and cluster reads look, in days. */
const POOL_LOOKBACK_DAYS = 14;
const CLUSTER_LOOKBACK_DAYS = 7;

/** The desk's graded record, computed from real outcome rows only. */
interface DeskRecord {
  correct: number;
  wrong: number;
  partial: number;
  ungradable: number;
}

/** What a surface needs to observe one rendered call card. Identity included,
 *  so the observer never has to read it back out of the DOM. */
export interface CallCardExposure {
  callId: string;
  rank: number;
  listLength: number;
}

export default function BriefCallsSection({
  briefId,
  briefDate,
  heading = "Today's Calls",
  surface = "brief",
  observeCard,
}: {
  /** Match calls by their brief_id (morning brief). Takes precedence. */
  briefId?: string | null;
  /** Match calls by brief_date (YYYY-MM-DD), used on the evening wrap, whose own
   *  briefing id differs from the morning brief that owns the calls. */
  briefDate?: string | null;
  heading?: string;
  /** Telemetry surface only. Does not change behavior. */
  surface?: "brief" | "wrap";
  /**
   * Hand the page a ref for each card, WITH the call's identity.
   *
   * This replaces observing the grid from the outside and sniffing the id back
   * out of an `aria-describedby` anchor. That resolver ran before the async
   * claims read had rendered the control it was looking for, so it returned
   * null on every row ever written, and #535 then removed the anchor outright.
   * Passing identity down is the retirement #519 called for.
   */
  observeCard?: (card: CallCardExposure) => ((el: HTMLElement | null) => void) | undefined;
}) {
  const [calls, setCalls] = useState<BriefCall[]>([]);
  // null = outcomes unavailable (query failed): render Open, claim nothing.
  const [outcomes, setOutcomes] = useState<Map<string, CallOutcomeRow> | null>(null);
  const [todayPt, setTodayPt] = useState<string>("");
  const [status, setStatus] = useState<LoadState>("loading");
  // The open pool: recent desk calls whose window is still live. null after a
  // failed read, which renders as an error line, never as emptiness.
  const [pool, setPool] = useState<BriefCall[] | null>([]);
  // Desk record aggregated from ALL real outcome rows. null = unavailable.
  const [record, setRecord] = useState<DeskRecord | null>(null);
  // ticker -> companies.sector, for the relatedness ladder. Best-effort.
  const [sectorByTicker, setSectorByTicker] = useState<Record<string, string>>({});
  // Recent emerging trend clusters, for the relatedness ladder. Best-effort.
  const [clusters, setClusters] = useState<EmergingCluster[]>([]);

  // Tracking state. `tracked` is null until we know: either the user is signed
  // out, or the claims read failed. In that case the control is not rendered at
  // all, because offering a button that can only 401 is worse than omitting it.
  const [tracked, setTracked] = useState<Map<string, TrackedClaim> | null>(null);
  const [windowFor, setWindowFor] = useState<Record<string, AdoptWindow>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [trackError, setTrackError] = useState<Record<string, string>>({});
  /** Calls committed in THIS session. Drives the one-time stamp only; it is
   *  never what makes a card read tracked (that comes from server data), so a
   *  reload renders the end state with no animation. */
  const [stamped, setStamped] = useState<Set<string>>(new Set());

  /** Read the user's claims so already-tracked calls render as tracked.
   *  Fail-open: any failure leaves `tracked` null and simply hides the control. */
  const loadTracked = useCallback(async () => {
    try {
      const res = await fetch("/api/radar/claims", { credentials: "include" });
      if (!res.ok) {
        setTracked(null); // 401 signed out, or 500: no control, no false state
        return;
      }
      const json = await res.json();
      const map = new Map<string, TrackedClaim>();
      for (const c of (json.claims ?? []) as TrackedClaim[]) {
        if (c.adopted_from_call_id) map.set(c.adopted_from_call_id, c);
      }
      setTracked(map);
    } catch {
      setTracked(null);
    }
  }, []);

  useEffect(() => {
    if (!briefId && !briefDate) {
      setStatus("loaded");
      setCalls([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const sb = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        );
        const today = new Date().toLocaleDateString("en-CA", {
          timeZone: "America/Los_Angeles",
        });
        setTodayPt(today);

        const CALL_COLS =
          "id, claim_text, target_symbol, claim_type, confidence, created_at, brief_date, resolve_on";

        let q = sb.from("morning_brief_calls").select(CALL_COLS);
        q = briefId ? q.eq("brief_id", briefId) : q.eq("brief_date", briefDate as string);

        const poolCutoff = new Date(Date.now() - POOL_LOOKBACK_DAYS * 86_400_000)
          .toISOString()
          .slice(0, 10);
        const clusterCutoff = new Date(
          Date.now() - CLUSTER_LOOKBACK_DAYS * 86_400_000,
        ).toISOString();

        // The brief's own calls, the open pool, the desk record and the
        // emerging clusters are independent reads; fetch them together.
        const [briefRes, poolRes, recordRes, clusterRes] = await Promise.all([
          q.order("confidence", { ascending: false }),
          sb
            .from("morning_brief_calls")
            .select(CALL_COLS)
            .gte("resolve_on", today)
            .gte("brief_date", poolCutoff)
            .order("brief_date", { ascending: false })
            .limit(24),
          sb.from("morning_brief_call_outcomes").select("verdict").limit(1000),
          sb
            .from("trend_clusters")
            .select("id, label, headline, top_sectors, created_at")
            .eq("cluster_type", "emerging")
            .gte("created_at", clusterCutoff)
            .order("created_at", { ascending: false })
            .limit(20),
        ]);
        if (cancelled) return;
        if (briefRes.error) {
          setStatus("error");
          return;
        }
        const rows = (briefRes.data as BriefCall[] | null) ?? [];
        setCalls(rows);

        const poolRows = poolRes.error ? null : ((poolRes.data as BriefCall[] | null) ?? []);
        setPool(poolRows);

        if (recordRes.error) {
          setRecord(null);
        } else {
          const rec: DeskRecord = { correct: 0, wrong: 0, partial: 0, ungradable: 0 };
          for (const r of (recordRes.data as { verdict: string }[] | null) ?? []) {
            if (r.verdict === "correct") rec.correct += 1;
            else if (r.verdict === "wrong") rec.wrong += 1;
            else if (r.verdict === "partial") rec.partial += 1;
            else rec.ungradable += 1;
          }
          setRecord(rec);
        }

        // Clusters are a best-effort enrichment for the forward hooks;
        // a failed read degrades to fewer hooks, never to invented ones.
        setClusters(
          clusterRes.error ? [] : ((clusterRes.data as EmergingCluster[] | null) ?? []),
        );

        // Outcomes for every call this section may render (brief + pool):
        // resolved state for the brief's calls, and the open-pool filter
        // (a graded call is not live no matter what its window says).
        const idsForOutcomes = [
          ...new Set([...rows.map((r) => r.id), ...(poolRows ?? []).map((r) => r.id)]),
        ];
        if (idsForOutcomes.length > 0) {
          const { data: outcomeData, error: outcomeError } = await sb
            .from("morning_brief_call_outcomes")
            .select(
              "call_id, verdict, attribution, actual_pct_change, actual_direction, verdict_notes, graded_at, metadata",
            )
            .in("call_id", idsForOutcomes);
          if (cancelled) return;
          if (outcomeError) {
            setOutcomes(null); // fall back to Open; never guess a verdict
          } else {
            // Latest row per call (no unique constraint on call_id in the DB).
            const byCall = new Map<string, CallOutcomeRow>();
            for (const o of (outcomeData as CallOutcomeRow[] | null) ?? []) {
              const prev = byCall.get(o.call_id);
              if (!prev || (o.graded_at ?? "") > (prev.graded_at ?? "")) {
                byCall.set(o.call_id, o);
              }
            }
            setOutcomes(byCall);
          }
          if (!cancelled) void loadTracked();
        } else {
          setOutcomes(new Map());
        }

        // Sector labels for every ticker in play, so the relatedness ladder
        // can match a closed NVO call to an open XLV call. Best-effort.
        const tickers = [
          ...new Set(
            [...rows, ...(poolRows ?? [])]
              .filter((c) => (c.claim_type ?? "").toLowerCase() === "ticker")
              .map((c) => (c.target_symbol ?? "").trim().toUpperCase())
              .filter(Boolean),
          ),
        ];
        if (tickers.length > 0) {
          const { data: compData, error: compError } = await sb
            .from("companies")
            .select("ticker, sector")
            .in("ticker", tickers);
          if (!cancelled && !compError) {
            const bySym: Record<string, string> = {};
            for (const c of (compData as { ticker: string; sector: string | null }[] | null) ?? []) {
              if (c.ticker && c.sector) bySym[c.ticker.toUpperCase()] = c.sector;
            }
            setSectorByTicker(bySym);
          }
        }
        setStatus("loaded");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [briefId, briefDate, loadTracked]);

  /**
   * Track a brief call as a forward claim of the user's own, over `window`.
   *
   * Optimistic, then reconciled. The card flips to tracked immediately so the
   * tap feels answered, and the server response replaces the placeholder with
   * the real window. On ANY failure the optimistic row is removed and an honest
   * inline message takes its place: a false tracked state is worse than an
   * error, because the user would believe a claim exists that does not.
   *
   * Never a modal, a toast, or a navigation. The reader stays in the brief.
   */
  const track = async (
    call: BriefCall,
    window: AdoptWindow,
    offeredWindow: AdoptWindow,
  ) => {
    setBusy(call.id);
    // Read provenance at the TAP, not after the round trip: every elapsed-time
    // number would otherwise carry the adopt request's latency. Identity comes
    // from `call`, which is a prop of this render, so the block is meaningful
    // even when no attention context is open at all (the evening wrap).
    const provenance = buildTrackProvenance({
      callId: call.id,
      sourceType: "brief_call",
      briefingId: briefId ?? null,
      // Both sides in the SAME vocabulary. adoptWindowRequest maps every
      // off-bucket window onto the "week" fallback horizon, so comparing the
      // request bodies would record "accepted as offered" for a reader who
      // deliberately changed a 13-day window to one week. adoptWindowValue
      // distinguishes them, which is what horizon_changed is measuring.
      horizon: adoptWindowValue(window),
      offeredHorizon: adoptWindowValue(offeredWindow),
      readAmbient: readProvenance,
      secondsSinceSourceInView: secondsSinceObjectFirstInView("brief_call", call.id),
    });
    setTrackError((prev) => {
      const next = { ...prev };
      delete next[call.id];
      return next;
    });

    // Optimistic placeholder. No dates yet, so HorizonChip renders nothing
    // rather than guessing a window the server has not confirmed.
    setTracked((prev) => {
      const next = new Map(prev ?? []);
      next.set(call.id, {
        id: `pending-${call.id}`,
        adopted_from_call_id: call.id,
        resolution_window_start: null,
        resolution_window_end: null,
      });
      return next;
    });

    const revert = (message: string) => {
      setTracked((prev) => {
        if (!prev) return prev;
        const next = new Map(prev);
        next.delete(call.id);
        return next;
      });
      setStamped((prev) => {
        const next = new Set(prev);
        next.delete(call.id);
        return next;
      });
      setTrackError((prev) => ({ ...prev, [call.id]: message }));
    };

    try {
      const res = await fetch("/api/radar/claims/adopt", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // adoptWindowRequest sends window_days for an off-bucket span, which
        // the route already accepts (resolveAdoptWindow's explicitDays). No
        // API change was needed for variable horizons.
        body: JSON.stringify({ call_id: call.id, ...adoptWindowRequest(window) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        revert(json.error ?? "Could not track this call.");
        return;
      }
      // Reconcile against the window the server actually stored.
      setTracked((prev) => {
        const next = new Map(prev ?? []);
        next.set(call.id, {
          id: json.id ?? `pending-${call.id}`,
          adopted_from_call_id: call.id,
          resolution_window_start: json.resolution_window_start ?? null,
          resolution_window_end: json.resolution_window_end ?? null,
        });
        return next;
      });
      setStamped((prev) => new Set(prev).add(call.id));
      // Peripheral confirmation: a brief pulse on the Radar nav row. Not a
      // toast, not a banner, and never a navigation.
      notifyRadarLanded();
      // Moat event: immediate flush, since a dropped track corrupts the
      // dataset rather than just adding noise.
      trackClientEvent(
        `${surface}.call.tracked`,
        {
          // Provenance first: the ambient enricher's keys are the same names,
          // and anything measured here must win over anything inferred there.
          ...provenance,
          horizon: adoptWindowRequest(window).horizon,
          // The real span, so a 13-day commitment is not filed as a week.
          window_days: adoptWindowRequest(window).window_days ?? null,
          window_kind: window.kind,
          already_tracked: json.alreadyAdopted === true,
          gradeable: json.gradeable ?? null,
          resolution_window_end: json.resolution_window_end ?? null,
          call_resolve_on: call.resolve_on,
          target_symbol: call.target_symbol,
          claim_type: call.claim_type,
        },
        { entity_type: "brief_call", entity_id: call.id, immediate: true },
      );
    } catch {
      revert("Could not track this call.");
    } finally {
      setBusy(null);
    }
  };

  // Loading: render nothing (the brief around it stays intact).
  if (status === "loading") return null;

  // ── Layer derivation, all from real rows ─────────────────────────────
  // Live = window still open AND no outcome row. A graded call is never live
  // no matter what its window says, and never carries a track affordance.
  const livePool =
    pool === null || outcomes === null
      ? null
      : pool.filter((c) => !outcomes.get(c.id) && (c.resolve_on ?? "") >= todayPt);
  const live = (livePool ?? []).slice(0, LIVE_MAX);
  const liveIds = new Set(live.map((c) => c.id));
  // This brief's calls that are NOT rendered in the live layer above.
  const briefLayer = calls.filter((c) => !liveIds.has(c.id));

  /** One live/open card with the track control as its footer. */
  const renderTrackableCard = (c: BriefCall, i: number, listLength: number) => {
    const trackedClaim = tracked?.get(c.id) ?? null;
    // Preselects the call's OWN span (its resolve_on, fixed at creation from
    // the claim's nature). The horizon is system-inferred; the reader sees it
    // as a sentence with a "change" affordance, never a mandatory menu.
    const offered = adoptWindowForCall(c.brief_date, c.resolve_on);
    const chosen = windowFor[c.id] ?? offered;
    const justStamped = stamped.has(c.id);
    return (
      // The wrapper carries the observing surface's ref and the anchor id the
      // "next to watch" hooks point at. No class, no style: layout untouched.
      <div
        key={c.id}
        id={`live-call-${c.id}`}
        ref={observeCard?.({ callId: c.id, rank: i, listLength })}
      >
        <ScoredObject
          {...openCallProps(c)}
          // The call's REAL window end, stated on the card. openCallProps
          // omits it only because its input type predates resolve_on.
          resolvesWhen={shortDate(c.resolve_on)}
          committed={!!trackedClaim}
          footer={
            hasCommitFooter({
              tracked: trackedClaim,
              available: tracked !== null,
              gradeable: isPriceableClaimType(c.claim_type),
            }) ? (
              <CallCommitFooter
                callId={c.id}
                tracked={trackedClaim}
                available={tracked !== null}
                busy={busy === c.id}
                window={chosen}
                onWindowChange={(w) =>
                  setWindowFor((prev) => ({ ...prev, [c.id]: w }))
                }
                onTrack={() => void track(c, chosen, offered)}
                justStamped={justStamped}
                gradeable={isPriceableClaimType(c.claim_type)}
                trustLineId={TRUST_LINE_ID}
                error={trackError[c.id] ?? null}
              />
            ) : undefined
          }
        />
      </div>
    );
  };

  /** The forward hook under a resolved call: the most specific REAL related
   *  object, or an honest "no related live call yet". Never generated. */
  const renderNextToWatch = (next: RelatedNext | null) => {
    if (!next) {
      return (
        <p className="mt-1 font-sans text-[11px] text-text-faint" data-testid="next-none">
          No related live call yet.
        </p>
      );
    }
    if (next.kind === "call") {
      const target = next.call;
      const inLive = liveIds.has(target.id);
      return (
        <p className="mt-1 font-sans text-[11px] text-text-muted" data-testid="next-call">
          Next to watch{" "}
          <span className="text-text-faint">({next.why}, live now)</span>:{" "}
          <a
            href={inLive ? `#live-call-${target.id}` : "/radar/calls"}
            className="font-semibold text-text-secondary underline underline-offset-2 hover:text-text-primary"
          >
            {target.target_symbol ?? "desk call"}
            {target.resolve_on ? ` · resolves ${shortDate(target.resolve_on)}` : ""}
          </a>
        </p>
      );
    }
    return (
      <p className="mt-1 font-sans text-[11px] text-text-muted" data-testid="next-cluster">
        Emerging on Radar:{" "}
        <a
          href="/trends"
          className="font-semibold text-text-secondary underline underline-offset-2 hover:text-text-primary"
        >
          {next.cluster.label ?? next.cluster.headline ?? "view trends"}
        </a>
      </p>
    );
  };

  const gradedTotal = record ? record.correct + record.wrong + record.partial : 0;

  return (
    <section>
      <h2 className="font-display text-[15px] font-semibold text-text-primary leading-snug">
        {heading}
      </h2>
      <p className="font-sans text-[12px] text-text-muted mt-0.5">
        Open calls you can track now, the desk&apos;s graded record, and how
        this brief&apos;s calls resolved.
      </p>
      {/* The reason to commit, said ONCE. Every card's button points here with
          aria-describedby, so the relationship survives the copy appearing one
          time instead of above every card. */}
      {tracked !== null && (
        <div className="mt-2 mb-3">
          <CallsTrustLine id={TRUST_LINE_ID} />
        </div>
      )}

      {/* ── LIVE: the actionable layer, freshest first ─────────────────── */}
      <div className="mt-3">
        <p className="font-data text-[10px] tracking-[0.12em] uppercase text-gold-dark mb-2">
          Live now
        </p>
        {livePool === null ? (
          <p className="font-sans text-[12px] text-text-muted">
            Live calls are momentarily unavailable.
          </p>
        ) : live.length === 0 ? (
          <p className="font-sans text-[12px] text-text-muted">
            No open desk calls right now.
          </p>
        ) : (
          <div className="grid gap-2">
            {live.map((c, i) => renderTrackableCard(c, i, live.length))}
          </div>
        )}
      </div>

      {/* ── DESK RECORD: credibility, said once at section level ───────── */}
      <div className="mt-4" data-testid="desk-record">
        {record === null ? (
          <p className="font-sans text-[11px] text-text-faint">
            Desk record unavailable.
          </p>
        ) : (
          <p className="font-sans text-[11px] text-text-muted">
            <span className="font-data text-[10px] tracking-[0.12em] uppercase text-text-faint mr-2">
              Desk record
            </span>
            {record.correct}W · {record.wrong}L · {record.partial} partial
            {gradedTotal > 0
              ? ` · ${Math.round((100 * record.correct) / gradedTotal)}% hit rate across ${gradedTotal} graded calls`
              : ""}
            {" · "}graded by price attribution
          </p>
        )}
      </div>

      {/* ── THIS BRIEF: resolved outcomes with a real forward hook ─────── */}
      {status === "error" ? (
        <div className="mt-4 rounded-lg border border-border-subtle bg-elevated px-4 py-4">
          <p className="font-sans text-[13px] text-text-muted">
            Calls are momentarily unavailable.
          </p>
        </div>
      ) : briefLayer.length === 0 ? (
        calls.length === 0 && live.length === 0 ? (
          <div className="mt-4 rounded-lg border border-border-subtle bg-elevated px-4 py-4">
            <p className="font-sans text-[13px] text-text-muted">
              No scored calls were captured for this brief yet.
            </p>
          </div>
        ) : null
      ) : (
        <div className="mt-4">
          <p className="font-data text-[10px] tracking-[0.12em] uppercase text-text-faint mb-2">
            From this brief
          </p>
          <div className="grid gap-2">
            {briefLayer.map((c) => {
              const outcome = outcomes?.get(c.id) ?? null;
              const windowClosed =
                !!todayPt && !!c.resolve_on && c.resolve_on < todayPt;
              const isSettled = !!outcome || windowClosed;
              // Outcomes unavailable: fall back to Open cards with no track
              // affordance and no hooks. Claiming nothing beats guessing.
              if (outcomes === null || !todayPt) {
                return (
                  <div key={c.id}>
                    <ScoredObject {...openCallProps(c)} />
                  </div>
                );
              }
              // A settled call is never trackable; it gets its real outcome
              // and a forward hook instead.
              if (isSettled) {
                const next = findNextToWatch(
                  c,
                  livePool ?? [],
                  sectorByTicker,
                  clusters,
                );
                return (
                  <div key={c.id}>
                    <ScoredObject {...scoredCallProps(c, outcome, todayPt)} />
                    {renderNextToWatch(next)}
                  </div>
                );
              }
              // Still open but not in the live layer (older than the pool
              // lookback, or squeezed out by the cap): trackable here.
              return renderTrackableCard(c, 0, 1);
            })}
          </div>
        </div>
      )}
    </section>
  );
}

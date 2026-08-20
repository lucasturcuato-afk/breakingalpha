"use client";

/**
 * CompanyAutoResolve -- invisible client trigger rendered ONLY in the
 * route-level miss branch (alongside EmptyState in
 * src/app/company/[id]/page.tsx). On mount it asks POST /api/company/resolve to
 * resolve the looked-up ticker/name via Finnhub and create a minimal companies
 * row if it is genuinely new. On a hit/create it navigates to the canonical
 * ticker route (deterministic resolveAlias ticker match) so the Primer mounts.
 *
 * Outcome handling:
 *  - 404 not_found: Finnhub has no match. EmptyState is the terminal state,
 *    so stay invisible (return null).
 *  - 5xx / network error: a real failure (e.g. SUPABASE_SERVICE_ROLE_KEY unset
 *    in this env -> service insert blocked by RLS -> 500). This is NOT the same
 *    as "no such company", so log it and surface a retry instead of a silent
 *    dead-end.
 *
 * Fan-out guard: a sessionStorage flag keyed on the query means a StrictMode
 * double-mount, a re-render, or a back-nav never re-POSTs. Explicit retry clears
 * the flag. The component only exists when getCompanyDetail missed, so once the
 * row exists the Primer mounts and this never renders again -- no loop.
 *
 * onPhaseChange is additive and optional. It reports the lifecycle of the same
 * lookup this component already performs, so CompanyMissState can render copy
 * that matches what is actually known. Nothing about the request, the dedup
 * guards, or the navigation changed to add it.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ResolvePhase } from "./company-miss-copy";

interface Props {
  query: string;
  onPhaseChange?: (phase: ResolvePhase) => void;
}

export function CompanyAutoResolve({ query, onPhaseChange }: Props) {
  const router = useRouter();
  const fired = useRef(false);
  const [failed, setFailed] = useState(false);

  // Held in a ref so `attempt` keeps a stable identity. If onPhaseChange were
  // a dep, an inline arrow from a caller would change `attempt` every render,
  // the fetch effect would re-run, and its cleanup would abort the in-flight
  // request while the `fired` guard blocked the retry. That leaves the lookup
  // permanently in flight from the reader's point of view.
  const phaseRef = useRef(onPhaseChange);
  useEffect(() => {
    phaseRef.current = onPhaseChange;
  }, [onPhaseChange]);
  const report = useCallback((phase: ResolvePhase) => {
    phaseRef.current?.(phase);
  }, []);

  const attempt = useCallback(
    async (signal?: AbortSignal) => {
      report("checking");
      try {
        const res = await fetch("/api/company/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
          signal,
        });
        if (res.status === 404) {
          report("unresolved"); // genuine not_found: no listed match
          return;
        }
        if (!res.ok) {
          console.error(`[CompanyAutoResolve] resolve failed: HTTP ${res.status}`);
          report("failed");
          setFailed(true);
          return;
        }
        setFailed(false);
        const json = (await res.json()) as {
          status?: string;
          company?: { ticker: string | null } | null;
        };
        // A 200 carrying neither status is off-contract. Treat it as a miss
        // rather than a failure: that is what this branch rendered before.
        if (json.status !== "created" && json.status !== "exists") {
          report("unresolved");
          return;
        }

        const ticker = json.company?.ticker;
        if (ticker) {
          // Navigate to the ticker route: resolveAlias resolves it by exact
          // ticker, so the new/found row mounts the Primer deterministically.
          router.push(`/company/${encodeURIComponent(ticker)}`);
        } else {
          router.refresh();
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return; // unmount
        console.error("[CompanyAutoResolve] resolve network error:", e);
        report("failed");
        setFailed(true);
      }
    },
    [query, router, report],
  );

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const guardKey = `ondemand-resolve:${query.toLowerCase()}`;
    try {
      if (sessionStorage.getItem(guardKey) === "1") {
        // Already POSTed this query this session and we are still on the miss
        // branch, so the earlier attempt did not produce a row. Report the
        // terminal phase: without this the reader sits on "Looking up ..."
        // forever on a back-nav, because no fetch is ever issued.
        //
        // This settles state from inside an effect on purpose. sessionStorage
        // does not exist during SSR, so the answer cannot be computed in the
        // initial render without a hydration mismatch. One extra render pass
        // before paint is the price of not showing a dead end.
        report("unresolved");
        return;
      }
      sessionStorage.setItem(guardKey, "1");
    } catch {
      // sessionStorage unavailable (private mode): the useRef guard still
      // prevents a double fire within this mount.
    }

    const ctrl = new AbortController();
    void attempt(ctrl.signal);
    return () => ctrl.abort();
  }, [query, attempt, report]);

  const onRetry = useCallback(() => {
    const guardKey = `ondemand-resolve:${query.toLowerCase()}`;
    try {
      sessionStorage.removeItem(guardKey);
    } catch {
      // ignore: retry still proceeds via the direct attempt() call below
    }
    setFailed(false);
    void attempt();
  }, [query, attempt]);

  if (!failed) return null;

  return (
    <div
      role="alert"
      className="mb-3 flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
      style={{ borderColor: "var(--border-base)", background: "var(--cream-hi)" }}
      data-testid="company-resolve-error"
    >
      <span className="font-sans text-[13px]" style={{ color: "var(--espresso)" }}>
        Couldn&apos;t resolve this ticker right now. Please try again.
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="flex-shrink-0 font-sans text-[10px] font-bold uppercase px-3 py-1.5 rounded-lg border cursor-pointer"
        style={{ borderColor: "var(--gold-border)", background: "var(--gold-muted)", color: "var(--gold-deep)" }}
      >
        Try again
      </button>
    </div>
  );
}

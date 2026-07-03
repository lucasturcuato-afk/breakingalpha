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
 *  - 404 not_found: Finnhub has no match. EmptyState is the correct terminal
 *    state, so stay invisible (return null).
 *  - 5xx / network error: a real failure (e.g. SUPABASE_SERVICE_ROLE_KEY unset
 *    in this env -> service insert blocked by RLS -> 500). This is NOT the same
 *    as "no such company", so log it and surface a retry instead of a silent
 *    dead-end.
 *
 * Fan-out guard: a sessionStorage flag keyed on the query means a StrictMode
 * double-mount, a re-render, or a back-nav never re-POSTs. Explicit retry clears
 * the flag. The component only exists when getCompanyDetail missed, so once the
 * row exists the Primer mounts and this never renders again -- no loop.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  query: string;
}

export function CompanyAutoResolve({ query }: Props) {
  const router = useRouter();
  const fired = useRef(false);
  const [failed, setFailed] = useState(false);

  const attempt = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch("/api/company/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
          signal,
        });
        if (res.status === 404) return; // genuine not_found: EmptyState is correct
        if (!res.ok) {
          console.error(`[CompanyAutoResolve] resolve failed: HTTP ${res.status}`);
          setFailed(true);
          return;
        }
        setFailed(false);
        const json = (await res.json()) as {
          status?: string;
          company?: { ticker: string | null } | null;
        };
        if (json.status !== "created" && json.status !== "exists") return;

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
        setFailed(true);
      }
    },
    [query, router],
  );

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const guardKey = `ondemand-resolve:${query.toLowerCase()}`;
    try {
      if (sessionStorage.getItem(guardKey) === "1") return;
      sessionStorage.setItem(guardKey, "1");
    } catch {
      // sessionStorage unavailable (private mode): the useRef guard still
      // prevents a double fire within this mount.
    }

    const ctrl = new AbortController();
    void attempt(ctrl.signal);
    return () => ctrl.abort();
  }, [query, attempt]);

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

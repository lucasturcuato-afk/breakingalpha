"use client";

/**
 * CompanyAutoResolve -- invisible client trigger rendered ONLY in the
 * route-level miss branch (alongside EmptyState in
 * src/app/company/[id]/page.tsx). On mount it asks POST /api/company/resolve to
 * resolve the looked-up ticker/name via Finnhub and create a minimal companies
 * row if it is genuinely new. On a hit/create it navigates to the canonical
 * ticker route (deterministic resolveAlias ticker match) so the Primer mounts;
 * a not_found leaves EmptyState in place.
 *
 * Fan-out guard: a sessionStorage flag keyed on the query means a StrictMode
 * double-mount, a re-render, or a back-nav never re-POSTs. The component only
 * exists when getCompanyDetail missed, so once the row exists the Primer mounts
 * and this never renders again -- no loop.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

interface Props {
  query: string;
}

export function CompanyAutoResolve({ query }: Props) {
  const router = useRouter();
  const fired = useRef(false);

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
    void (async () => {
      try {
        const res = await fetch("/api/company/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
          signal: ctrl.signal,
        });
        if (!res.ok) return; // 404 not_found / 4xx / 5xx: keep EmptyState
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
      } catch {
        // network/abort: keep EmptyState
      }
    })();

    return () => ctrl.abort();
  }, [query, router]);

  return null;
}

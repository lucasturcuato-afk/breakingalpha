"use client";

/**
 * EmptyStateCTA (PR-E1) -- two-button cluster for the route-level
 * un-indexed company empty state.
 *
 * Primary "Add to watchlist" replicates CompanyDetailHeader.tsx:59-89
 * (POST /api/watchlist + dispatch "watchlist:changed"). The Lucas-protected
 * helpers in src/lib/watchlist-utils.ts and WatchlistAddInput.tsx are NOT
 * touched. Secondary is a plain link to /company (the directory listing).
 *
 * Primary CTA receives focus on mount via a ref forwarded from the caller.
 */

import Link from "next/link";
import { forwardRef, useCallback, useRef, useState } from "react";

const SANS = "var(--font-inter), Inter, sans-serif";
const PENDING = "__pending__";

const btnBase = {
  fontFamily: SANS,
  fontSize: 13,
  fontWeight: 600,
  padding: "8px 14px",
  borderRadius: 6,
} as const;

const btnSecondary = {
  ...btnBase,
  background: "var(--cream)",
  border: "1px solid var(--border-base)",
  color: "var(--espresso)",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
} as const;

const btnPrimary = {
  ...btnBase,
  background: "var(--gold-deep)",
  border: "1px solid var(--gold-deep)",
  color: "var(--cream)",
  cursor: "pointer",
} as const;

interface Props {
  canonical: string;
}

export const EmptyStateCTA = forwardRef<HTMLButtonElement, Props>(
  function EmptyStateCTA({ canonical }, ref) {
    const [entryId, setEntryId] = useState<string | null>(null);
    const inFlight = useRef(false);
    const isOn = entryId !== null && entryId !== PENDING;
    const pending = entryId === PENDING;

    const onAdd = useCallback(async () => {
      if (inFlight.current || isOn || pending) return;
      inFlight.current = true;
      setEntryId(PENDING);
      try {
        const res = await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            identifier: canonical,
            type: "company",
            display_name: canonical,
          }),
        });
        if (!res.ok) throw new Error(`POST failed: ${res.status}`);
        const json = (await res.json()) as { entry?: { id: string } };
        if (json.entry?.id) setEntryId(json.entry.id);
        window.dispatchEvent(new Event("watchlist:changed"));
      } catch (e) {
        console.error("Watchlist add failed:", e);
        setEntryId(null);
      } finally {
        inFlight.current = false;
      }
    }, [canonical, isOn, pending]);

    return (
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <Link
          data-testid="company-empty-state-cta-search"
          href="/company"
          aria-label="Search company directory"
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          style={btnSecondary}
        >
          Search directory
        </Link>
        <button
          ref={ref}
          type="button"
          data-testid="company-empty-state-cta-add"
          aria-pressed={isOn}
          aria-label={isOn ? "Added to watchlist" : "Add to watchlist"}
          disabled={pending || isOn}
          onClick={onAdd}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          style={{
            ...btnPrimary,
            cursor: pending || isOn ? "default" : "pointer",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {isOn ? "On Watchlist" : "Add to watchlist"}
        </button>
      </div>
    );
  },
);

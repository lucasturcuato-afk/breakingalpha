"use client";

/**
 * EmptyState (PR-E1) -- route-level empty state for un-indexed companies.
 *
 * Trigger: src/app/company/[id]/page.tsx renders this inside LiveMoodShell
 * when getCompanyDetail() returns null. Visual mirrors docs/DirectionD.jsx
 * lines 1204-1236 (centered editorial card): 56px gold-faint circle icon,
 * serif h1 (max-width 480), sans body, two inline CTAs.
 *
 * The DirectionD mono metric strip is intentionally omitted -- it is not
 * in the PR-E1 testid manifest and the data (last-indexed / sources-checked
 * / watchlist-count) is not yet wired through to the route.
 *
 * a11y:
 *  - role="region" + aria-labelledby targets the h1
 *  - h1 is the only h1 on the page in this branch (header is gone)
 *  - Primary CTA receives focus on mount; both CTAs have focus-visible rings
 */

import { useEffect, useRef } from "react";

import { EmptyStateCTA } from "./EmptyStateCTA";

const SERIF = "var(--font-display), Georgia, serif";
const SANS = "var(--font-inter), Inter, sans-serif";

interface Props {
  canonical: string;
}

export function EmptyState({ canonical }: Props) {
  const ctaRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    ctaRef.current?.focus();
  }, []);

  return (
    <div
      className="bg-cream p-4"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      <section
        role="region"
        aria-labelledby="company-empty-state-headline"
        data-testid="company-empty-state"
        style={{
          padding: "48px 56px",
          background: "var(--cream-hi)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 12,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            background: "var(--gold-faint)",
            border: "1px solid var(--gold-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: SERIF,
            fontSize: 24,
            fontWeight: 700,
            color: "var(--gold-deep)",
          }}
        >
          -
        </div>
        <h1
          id="company-empty-state-headline"
          data-testid="company-empty-state-headline"
          className="font-display"
          style={{
            fontFamily: SERIF,
            fontSize: 24,
            fontWeight: 700,
            margin: 0,
            letterSpacing: "-0.015em",
            maxWidth: 480,
            color: "var(--espresso)",
          }}
        >
          {canonical} isn&apos;t on Signalera yet.
        </h1>
        <p
          style={{
            fontFamily: SANS,
            fontSize: 14,
            lineHeight: 1.6,
            color: "var(--text-soft)",
            margin: 0,
            maxWidth: 480,
          }}
        >
          We haven&apos;t indexed any qualifying coverage for this company. Add
          it to your watchlist to be notified the moment something publishes,
          or head to the directory to search for a different name or ticker.
        </p>
        <EmptyStateCTA ref={ctaRef} canonical={canonical} />
      </section>
    </div>
  );
}

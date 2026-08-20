"use client";

/**
 * EmptyState (PR-E1) -- route-level state for a company name that did not
 * resolve to a companies row.
 *
 * Trigger: CompanyMissState renders this inside LiveMoodShell when
 * getCompanyDetail() yields null. Visual mirrors docs/DirectionD.jsx
 * lines 1204-1236 (centered editorial card): 56px gold-faint circle icon,
 * serif h1 (max-width 480), sans body, two inline CTAs.
 *
 * The copy is not a constant any more. It varies on `phase`, the lifecycle of
 * the POST /api/company/resolve lookup that CompanyAutoResolve fires. See
 * company-miss-copy.ts for what each phase is allowed to assert and why. The
 * short version: while the lookup is in flight we claim nothing, and when it
 * fails we say the lookup failed rather than guessing at coverage.
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
import { companyMissCopy, type ResolvePhase } from "./company-miss-copy";

const SERIF = "var(--font-display), Georgia, serif";
const SANS = "var(--font-inter), Inter, sans-serif";

interface Props {
  canonical: string;
  /** Lookup lifecycle. Defaults to the terminal no-match phase so a caller
   *  that does not drive the lookup still gets honest copy. */
  phase?: ResolvePhase;
}

export function EmptyState({ canonical, phase = "unresolved" }: Props) {
  const ctaRef = useRef<HTMLButtonElement>(null);
  const copy = companyMissCopy(phase, canonical);

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
        data-phase={phase}
        style={{
          padding: "48px 56px",
          background: "var(--cream-hi)",
          border: "1px solid var(--border-base)",
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
          {/* One expression, no adjacent JSX text: the SWC bug that ate the
              space in "Coca Colaisn't ..." needs a text node next to an
              expression container, and there is not one any more. */}
          {copy.headline}
        </h1>
        <p
          data-testid="company-empty-state-body"
          style={{
            fontFamily: SANS,
            fontSize: 14,
            lineHeight: 1.6,
            color: "var(--text-muted)",
            margin: 0,
            maxWidth: 480,
          }}
        >
          {copy.body}
        </p>
        {copy.action ? (
          <p
            data-testid="company-empty-state-action"
            style={{
              fontFamily: SANS,
              fontSize: 14,
              lineHeight: 1.6,
              color: "var(--text-muted)",
              margin: 0,
              maxWidth: 480,
            }}
          >
            {copy.action}
          </p>
        ) : null}
        <EmptyStateCTA ref={ctaRef} canonical={canonical} />
      </section>
    </div>
  );
}

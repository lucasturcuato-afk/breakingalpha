"use client";

/**
 * CompanyAliasRibbon (PR-B1) -- docs/DirectionD.jsx lines 550-570.
 * CANONICAL eyebrow + canonical name + alias chips with mention counts.
 * Collapses to "+N more" beyond `maxBeforeCollapse` (default 3). Per-alias
 * navigation deferred to a later PR.
 */

import { Fragment, useState } from "react";
import { Eyebrow } from "@/components/ui";
import type { AliasMention } from "@/lib/data-access/getCompanyDetail";

const MONO = "var(--font-mono), ui-monospace, monospace";
const SERIF = "var(--font-display), serif";
const SANS = "var(--font-sans), sans-serif";

interface Props {
  canonical: string;
  aliasMentions: AliasMention[];
  maxBeforeCollapse?: number;
}

export function CompanyAliasRibbon({ canonical, aliasMentions, maxBeforeCollapse = 3 }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (!aliasMentions || aliasMentions.length === 0) return null;

  const visible = expanded ? aliasMentions : aliasMentions.slice(0, maxBeforeCollapse);
  const hiddenCount = expanded ? 0 : Math.max(0, aliasMentions.length - maxBeforeCollapse);

  return (
    <div
      data-testid="alias-ribbon"
      role="region"
      aria-label="Canonical name and aliases"
      className="text-text-muted dark:text-text-secondary"
      style={{
        display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
        fontFamily: MONO, fontSize: 11,
      }}
    >
      <Eyebrow as="span" color="var(--gold-deep)" testId="alias-ribbon-canonical-label">
        <span
          style={{
            padding: "1px 6px", borderRadius: 2,
            background: "var(--gold-faint)", border: "1px solid var(--gold-border)",
            letterSpacing: "0.08em", fontSize: 9,
          }}
        >
          CANONICAL
        </span>
      </Eyebrow>
      <span style={{ fontFamily: SERIF, color: "var(--espresso)", fontWeight: 600 }}>{canonical}</span>
      <span style={{ color: "var(--text-faint)" }}>·</span>
      <span>aka</span>
      {visible.map((alias, i) => (
        <Fragment key={alias.name}>
          {i > 0 ? <span style={{ color: "var(--text-faint)" }}>·</span> : null}
          <button
            type="button"
            data-testid="alias-ribbon-chip"
            aria-label={`View mentions for alias ${alias.name}, ${alias.n} mentions`}
            className="inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-sm"
            style={{ fontFamily: SERIF, fontSize: 11, background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
          >
            <span style={{ color: "var(--espresso)" }}>{alias.name}</span>
            <span style={{ color: "var(--text-faint)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{alias.n}</span>
          </button>
        </Fragment>
      ))}
      {hiddenCount > 0 ? (
        <button
          type="button"
          data-testid="alias-ribbon-more"
          aria-label={`Show ${hiddenCount} more aliases`}
          onClick={() => setExpanded(true)}
          className="text-text-muted dark:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-sm"
          style={{
            fontFamily: SANS, fontSize: 11,
            background: "transparent", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline",
          }}
        >
          +{hiddenCount} more
        </button>
      ) : null}
    </div>
  );
}

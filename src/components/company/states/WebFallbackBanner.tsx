"use client";

/**
 * WebFallbackBanner (PR-E2): the "ALIAS RESOLVED: <from> -> <to>" banner that
 * surfaces above a web-fallback memo when the user's typo was resolved to a
 * canonical name (e.g. "Persing" -> "Pershing"). The `alias_resolved` signal
 * is emitted server-side at `/api/companies` (route.ts:115-165) but is NOT
 * propagated into `/company/[id]/page.tsx` today. This component is therefore
 * presentational-only; wiring the trigger end-to-end is a separate follow-up
 * (the recipe rows J1-J9 are KNOWN-DEFERRED for the same reason).
 *
 * Visual: gold-faint pill + uppercase eyebrow + arrow. Mirrors the
 * CANONICAL ribbon's visual language so the page stays calm.
 */

interface WebFallbackBannerProps {
  /** What the user typed (e.g. "Persing"). */
  from: string;
  /** Canonical name resolved from `aliases.lookup_key` (e.g. "Pershing"). */
  to: string;
  className?: string;
}

const MONO = "var(--font-mono), ui-monospace, monospace";

export function WebFallbackBanner({ from, to, className }: WebFallbackBannerProps) {
  return (
    <div
      data-testid="web-fallback-banner-alias-resolved"
      role="status"
      aria-label={`Alias resolved from ${from} to ${to}`}
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        marginBottom: 12,
        background: "var(--gold-muted)",
        border: "1px solid var(--gold-border)",
        borderRadius: 6,
        fontFamily: MONO,
        fontSize: 11,
        color: "var(--text-secondary)",
      }}
    >
      <span
        style={{
          padding: "1px 6px",
          borderRadius: 2,
          background: "var(--cream-hi)",
          border: "1px solid var(--gold-border)",
          color: "var(--gold-dark)",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        ALIAS RESOLVED
      </span>
      <span style={{ color: "var(--espresso)", fontWeight: 600 }}>{from}</span>
      <span aria-hidden="true" style={{ color: "var(--text-faint)" }}>-&gt;</span>
      <span style={{ color: "var(--espresso)", fontWeight: 600 }}>{to}</span>
    </div>
  );
}

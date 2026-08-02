"use client";

/**
 * HorizonChip - a call's resolution window, DERIVED from its stored dates.
 *
 * Lifted verbatim out of src/app/radar/calls/page.tsx so the brief pages and
 * the Radar calls page render the same chip from the same code. It was private
 * to that page, which is why porting the track control to BriefCallsSection
 * would otherwise have meant a second copy.
 *
 * The label is whatever anchor -> resolveOn actually spans, never hardcoded, so
 * a change to the backend horizon map or a user-chosen window renders correctly
 * with no edit here. Absent entirely when there is no resolveOn to derive from,
 * so a call with no horizon shows nothing rather than a wrong label.
 */

import { horizonFromDates, horizonPhraseForDays } from "@/lib/call-horizons";

export function HorizonChip({
  anchor,
  resolveOn,
  variant = "chip",
}: {
  anchor: string | null | undefined;
  resolveOn: string | null | undefined;
  /**
   * "chip" is the bordered token, kept for any surface still framing a horizon
   * as metadata. "phrase" is the plain-language reading used inside a card,
   * where the horizon is part of a decision and a monospace token reads as
   * debug output. Monospace now belongs to the ledger line alone.
   */
  variant?: "chip" | "phrase";
}) {
  const h = horizonFromDates(anchor, resolveOn);
  if (!h) return null;
  if (variant === "phrase") {
    return (
      <span
        data-testid="horizon-chip"
        title={`Resolves ${resolveOn}`}
        className="font-sans text-[11px] leading-none text-text-muted"
      >
        {horizonPhraseForDays(h.days)}
      </span>
    );
  }
  return (
    <span
      data-testid="horizon-chip"
      title={`Resolves ${resolveOn}`}
      className="rounded-sm border border-border-subtle px-1.5 py-px font-mono text-[10px] leading-none text-text-muted"
    >
      {h.label}
    </span>
  );
}

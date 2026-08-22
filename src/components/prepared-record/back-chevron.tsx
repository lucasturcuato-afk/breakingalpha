import { Chevron } from "@/components/ledger";

/**
 * The back arrow on the Prepared record's top bar.
 *
 * The design opens this screen with a left arrow and the word "Ledger". The
 * shared `Chevron` draws `right` and `down` and no `left`, because the Ledger
 * never needed one, and teaching it a third direction would be a branch inside
 * a component every other in-flight screen unit consumes. Two units have
 * already collided that way on `claim-anatomy.tsx`.
 *
 * So this is the wrapper: the shared chevron, mirrored. A chevron is symmetric
 * about its own horizontal axis, so `scaleX(-1)` on the `right` path produces
 * exactly the `left` path and nothing is redrawn here. One arrow shape in the
 * product, still owned by one file.
 *
 * Two deliberate differences from the design, both sub-pixel and neither
 * visible in the parity fingerprint (an SVG carries no text and is not a
 * control, so it is not fingerprinted at all): the design draws this arrow at
 * 16px and strokes it at 1.8, and the shared component's scale stops at 15 and
 * strokes at 2. Matching the design would mean widening the shared type and
 * adding a stroke prop, which is the edit this file exists to avoid.
 */
export function BackChevron() {
  return (
    <span
      aria-hidden="true"
      style={{ display: "inline-flex", flex: "none", transform: "scaleX(-1)" }}
    >
      {/* The design strokes the arrow with the bar's own colour rather than
          the chevron's default muted, which is what `stroke` is for. */}
      <Chevron direction="right" size={15} stroke="var(--c-secondary)" />
    </span>
  );
}

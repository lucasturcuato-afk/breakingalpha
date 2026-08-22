import type { ReactNode } from "react";

/**
 * ClaimAnatomy. The shared vertical anatomy every claim-bearing object in the
 * mobile design reuses. Extract-first component for the redesign: later
 * batches consume it and must not rebuild it.
 *
 * The anatomy is four slots in a fixed order, and only the type scale changes
 * between the object types the design carries:
 *
 *   lead    an eyebrow on a claim, or a state dot plus its word on an entry
 *   claim   the falsifiable sentence, Playfair in ink
 *   prose   the supporting reading, Inter 400 in body
 *   meta    the window, the result line, or whatever settles it
 *
 * Every value is measured off the rendered prototype with getComputedStyle,
 * not taken from the README:
 *
 *   scale="card"    claim 17.5px/1.4 500   prose 14px/1.6
 *   scale="row"     claim 15px/1.42 500    prose 12.5px/1.5
 *   scale="screen"  claim 21px/1.32 600    prose 13.5px/1.6
 *
 * `screen` is the full-screen expansion of a settled entry, measured off the
 * prototype's isEntry block. It is a third value on the axis this primitive is
 * already parameterised by, not a branch: every per-scale number now lives in
 * the table below, so adding one adds no code path. The card and row rows carry
 * exactly the values they resolved to before, so nothing that consumed them
 * moves.
 *
 * The container is deliberately NOT part of this primitive. A claim sits in a
 * bordered, filled, 12px-radius card and an entry sits in a ruled row with no
 * fill, and those are different objects rather than one object in two skins.
 * Each wrapper owns its own container and passes its content through here.
 */

export type ClaimScale = "card" | "row" | "screen";

const SCALE = {
  card: {
    claim: "500 var(--v3-claim)/1.4 var(--font-playfair-display), serif",
    claimTracking: "normal",
    claimMargin: "10px 0 0",
    prose: "400 var(--v3-body)/var(--v3-lead) var(--font-inter), sans-serif",
    proseMargin: "11px 0 0",
  },
  row: {
    /* The row's own 7px column gap belongs to LedgerEntryRow's frame, which is
       why nothing here sets a margin: the flex column already spaces it. */
    claim: "500 15px/1.42 var(--font-playfair-display), serif",
    claimTracking: "normal",
    claimMargin: "0",
    prose: "400 12.5px/1.5 var(--font-inter), sans-serif",
    proseMargin: "0",
  },
  screen: {
    claim: "600 21px/1.32 var(--font-playfair-display), serif",
    claimTracking: "-0.01em",
    claimMargin: "14px 0 0",
    prose: "400 13.5px/1.6 var(--font-inter), sans-serif",
    proseMargin: "9px 0 0",
  },
} as const;

export interface ClaimAnatomyProps {
  scale: ClaimScale;
  /** Eyebrow on a claim, state dot plus word on an entry. */
  lead?: ReactNode;
  /** The falsifiable sentence. Required: an object with no claim is not one. */
  claim: ReactNode;
  /** Supporting reading. Optional; an entry may carry only its result line. */
  prose?: ReactNode;
  /** Window, result line, or the control row on a card. */
  meta?: ReactNode;
  /** Applied to the prose paragraph, e.g. the line clamp. */
  proseClassName?: string;
  /**
   * Sits on the prose slot's trailing edge, top-aligned. The design puts a
   * chevron here on a card whose reading is clamped, and nothing here on a row.
   *
   * Passing it turns the prose slot into a two-column row: the paragraph takes
   * the remaining width and this keeps its intrinsic one. Leaving it out
   * renders the paragraph exactly as before, which is what the entry row needs,
   * so the row is unchanged by this existing.
   */
  proseTrailing?: ReactNode;
}

export function ClaimAnatomy({
  scale,
  lead,
  claim,
  prose,
  meta,
  proseClassName,
  proseTrailing,
}: ClaimAnatomyProps) {
  const s = SCALE[scale];
  const proseParagraph = prose ? (
    <p
      className={proseClassName}
      style={{
        margin: proseTrailing ? 0 : s.proseMargin,
        /* The clamp needs a definite width to clamp against, which the flex
           row's default `min-width:auto` would not give it: a long unbroken
           reading would push the chevron off the card instead of ellipsing. */
        flex: proseTrailing ? 1 : undefined,
        minWidth: proseTrailing ? 0 : undefined,
        font: s.prose,
        color: "var(--c-body)",
      }}
    >
      {prose}
    </p>
  ) : null;
  return (
    <>
      {lead}
      <p
        style={{
          margin: s.claimMargin,
          font: s.claim,
          letterSpacing: s.claimTracking,
          color: "var(--c-ink)",
          textWrap: "pretty",
        }}
      >
        {claim}
      </p>
      {proseTrailing && proseParagraph ? (
        <div
          style={{
            /* The wrapper IS the prose slot when something trails it, so it
               takes the slot's own margin. The inner paragraph is zeroed above.
               A literal here was the one per-scale number left outside the
               table, and it would have given `screen` the card's 11px. */
            margin: s.proseMargin,
            display: "flex",
            gap: "9px",
            /* Top-aligned, so the chevron sits against the reading's first line
               however many lines the clamp leaves. */
            alignItems: "flex-start",
          }}
        >
          {proseParagraph}
          {proseTrailing}
        </div>
      ) : (
        proseParagraph
      )}
      {meta}
    </>
  );
}

/**
 * The four outcome states, exactly as the compliance rule fixes them. No other
 * word may describe an outcome, and the set is closed on purpose so a fifth
 * cannot be added without this file changing.
 */
export const OUTCOME_STATES = ["supported", "challenged", "developing", "awaiting"] as const;
export type OutcomeState = (typeof OUTCOME_STATES)[number];

/**
 * Base token for the dot, ink token for the word. The dot is a fill and the
 * word is text; swapping the two was the single most common defect the design
 * recorded, so they are separated here rather than derived from one value.
 *
 * awaiting and developing share a hue by design. They are still distinct
 * states and are never rendered by colour alone: every one carries its word.
 */
export const OUTCOME_TOKENS: Record<OutcomeState, { dot: string; text: string }> = {
  supported: { dot: "var(--c-green)", text: "var(--c-greenink)" },
  challenged: { dot: "var(--c-red)", text: "var(--c-redink)" },
  developing: { dot: "var(--c-amber)", text: "var(--c-amberink)" },
  awaiting: { dot: "var(--c-amber)", text: "var(--c-amberink)" },
};

/**
 * The rendered form of each state. Exported so a screen drawing the state at a
 * size this file does not carry still gets its word from here. There is exactly
 * one word table, for the same reason there is exactly one state set: a second
 * one is how a fifth word arrives without this file changing.
 */
export const OUTCOME_LABEL: Record<OutcomeState, string> = {
  supported: "Supported",
  challenged: "Challenged",
  developing: "Developing",
  awaiting: "Awaiting",
};

/**
 * The state dot, its word, and an optional instrument on the trailing edge.
 *
 * transition:none is load bearing. The four words are non-interchangeable, so
 * easing between two semantic hues renders one state's word in another
 * state's colour for the length of the transition. The word and the colour
 * change on the same frame or the record lies.
 */
export function OutcomeLead({ state, instrument }: { state: OutcomeState; instrument?: string }) {
  const t = OUTCOME_TOKENS[state];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <span
        aria-hidden="true"
        style={{
          flex: "none",
          display: "inline-block",
          width: "7px",
          height: "7px",
          borderRadius: "50%",
          backgroundColor: t.dot,
          transition: "none",
        }}
      />
      <span style={{ font: "600 11px/1 var(--font-inter), sans-serif", color: t.text, transition: "none" }}>
        {OUTCOME_LABEL[state]}
      </span>
      {instrument ? (
        <span
          style={{
            marginLeft: "auto",
            font: "400 10px/1 var(--font-jetbrains-mono), monospace",
            letterSpacing: "0.07em",
            color: "var(--c-muted)",
          }}
        >
          {instrument}
        </span>
      ) : null}
    </div>
  );
}

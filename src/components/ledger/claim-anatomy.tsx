import type { ReactNode } from "react";

/**
 * ClaimAnatomy. The shared vertical anatomy every claim-bearing object in the
 * mobile design reuses. Extract-first component for the redesign: later
 * batches consume it and must not rebuild it.
 *
 * The anatomy is four slots in a fixed order, and only the type scale changes
 * between the two object types the Ledger carries:
 *
 *   lead    an eyebrow on a claim, or a state dot plus its word on an entry
 *   claim   the falsifiable sentence, Playfair 500 in ink
 *   prose   the supporting reading, Inter 400 in body
 *   meta    the window, the result line, or whatever settles it
 *
 * Every value is measured off the rendered prototype with getComputedStyle,
 * not taken from the README:
 *
 *   scale="card"  claim 17.5px/1.4   prose 14px/1.6
 *   scale="row"   claim 15px/1.42    prose 12.5px/1.5
 *
 * The container is deliberately NOT part of this primitive. A claim sits in a
 * bordered, filled, 12px-radius card and an entry sits in a ruled row with no
 * fill, and those are different objects rather than one object in two skins.
 * Each wrapper owns its own container and passes its content through here.
 */

export type ClaimScale = "card" | "row";

const SCALE = {
  card: {
    claim: "500 var(--v3-claim)/1.4 'Playfair Display', serif",
    prose: "400 var(--v3-body)/var(--v3-lead) Inter, sans-serif",
    gap: "10px",
  },
  row: {
    claim: "500 15px/1.42 'Playfair Display', serif",
    prose: "400 12.5px/1.5 Inter, sans-serif",
    gap: "7px",
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
}

export function ClaimAnatomy({ scale, lead, claim, prose, meta, proseClassName }: ClaimAnatomyProps) {
  const s = SCALE[scale];
  return (
    <>
      {lead}
      <p
        style={{
          margin: scale === "card" ? `${s.gap} 0 0` : 0,
          font: s.claim,
          color: "var(--c-ink)",
          textWrap: "pretty",
        }}
      >
        {claim}
      </p>
      {prose ? (
        <p
          className={proseClassName}
          style={{
            margin: scale === "card" ? "11px 0 0" : 0,
            font: s.prose,
            color: "var(--c-body)",
          }}
        >
          {prose}
        </p>
      ) : null}
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

const LABEL: Record<OutcomeState, string> = {
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
      <span style={{ font: "600 11px/1 Inter, sans-serif", color: t.text, transition: "none" }}>
        {LABEL[state]}
      </span>
      {instrument ? (
        <span
          style={{
            marginLeft: "auto",
            font: "400 10px/1 'JetBrains Mono', monospace",
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

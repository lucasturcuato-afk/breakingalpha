import { OUTCOME_STATES, type OutcomeState } from "@/components/ledger/claim-anatomy";
import { FONT_DISPLAY } from "@/components/mobile/fonts";

/**
 * The outcome word at set-piece size, on a pinned-espresso surface.
 *
 * A WRAPPER BESIDE `OutcomeLead`, never a branch inside it. Three measured
 * reasons the shipped component cannot render this, all off the prototype at
 * line 502 with getComputedStyle:
 *
 *   size      7px dot and an 11px Inter 600 word there, 11px dot and a 36px
 *             Fraunces 700 word at -0.025em here. A different face and weight,
 *             not a size prop.
 *   surface   `OUTCOME_TOKENS` pairs `--c-red` with `--c-redink`, which are
 *             light-theme values. The README requires the literal on-espresso
 *             values on a pinned-espresso surface.
 *   colour    the word is not coloured at all here. The dot is the only
 *             carrier of hue and the word is `--c-oninv-strong` in both
 *             themes.
 *
 * `OUTCOME_STATES` is imported rather than restated so the closed set stays in
 * one file. A fifth word cannot be added without `claim-anatomy.tsx` changing.
 *
 * DEVIATION FROM THE PROTOTYPE, deliberate, recorded in the PR body. Line 502
 * fills the dot with `var(--c-red)`, which resolves to #dc2626 in light theme.
 * The README: "On pinned-espresso surfaces use the literal on-espresso values,
 * not the ink tokens: #f87171 red, #4ade80 green, #fbbf24 amber. The ink
 * tokens are light-theme values and measure 2.86 to 3.76:1 on espresso."
 * The prototype breaks its own rule on the single most important instance of
 * the outcome word in the product. In dark theme `--c-red` already resolves to
 * #f87171, so the two agree there and differ only in light. Built to the
 * README. `design-lint` sanctions exactly these three literals for exactly
 * this case.
 *
 * No state is signalled by colour alone: every one carries its word, which is
 * why the cream word is defensible on its own terms.
 */

/** Dot fills, on espresso. Literals by ruling, not by omission. */
const ESPRESSO_DOT: Record<OutcomeState, string> = {
  supported: "#4ade80",
  challenged: "#f87171",
  developing: "#fbbf24",
  awaiting: "#fbbf24",
};

const LABEL: Record<OutcomeState, string> = {
  supported: "Supported",
  challenged: "Challenged",
  developing: "Developing",
  awaiting: "Awaiting",
};

export function EspressoOutcomeLead({ state }: { state: OutcomeState }) {
  return (
    <div style={{ marginTop: "16px", display: "flex", alignItems: "center", gap: "12px" }}>
      <span
        aria-hidden="true"
        style={{
          flex: "none",
          display: "inline-block",
          width: "11px",
          height: "11px",
          borderRadius: "50%",
          backgroundColor: ESPRESSO_DOT[state],
          /* The four words are non-interchangeable, so easing between two
             semantic hues renders one state's word in another state's colour
             for the length of the transition. Same reasoning as OutcomeLead. */
          transition: "none",
        }}
      />
      <span
        style={{
          font: `700 36px/1 ${FONT_DISPLAY}`,
          letterSpacing: "-0.025em",
          color: "var(--c-oninv-strong)",
          transition: "none",
        }}
      >
        {LABEL[state]}
      </span>
    </div>
  );
}

/* Exported for the audit: proof the label table is total over the closed set
   and cannot silently lose a state. */
export const ESPRESSO_OUTCOME_WORDS = OUTCOME_STATES.map((s) => LABEL[s]);

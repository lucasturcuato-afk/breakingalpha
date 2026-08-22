import { ClaimAnatomy, OUTCOME_TOKENS, type OutcomeState } from "@/components/ledger";
import styles from "./record.module.css";

/**
 * One entry on the Prepared record.
 *
 * WHY THIS IS NOT `LedgerEntryRow`, since that is the first question a reviewer
 * should ask. The two are different objects, measured off the design:
 *
 *   Ledger row (prototype :446)   dot, state word, ticker on the trailing edge
 *                                 claim, then the result line as prose
 *   Record row (prototype :559)   the entry DATE in mono, then the state word
 *                                 claim, the user's OWN NOTE, then the result
 *
 * The note is the difference that matters. It is the reasoning the user wrote
 * before the outcome was known, it is the whole reason a record is evidence
 * rather than a click log, and `LedgerEntryRow` has no slot for it. Its `claim`
 * and `result` are both `string`, so there is nowhere to put one without
 * changing that component. Teaching it a second lead and a third text slot
 * would be a branch inside a component three other in-flight screen units
 * consume, which the mobile-build contract forbids. So this is the wrapper
 * beside it, and both wrap the same primitive: `ClaimAnatomy` at `scale="row"`
 * supplies the claim's type, unchanged, from one place.
 *
 * A challenged entry renders exactly as a supported one: same size, same
 * weight, same position in sequence, no de-emphasis, no filter. The record is
 * more credible for carrying them, and the only way that stays true is if
 * nothing here treats them differently.
 */

/**
 * The four state ids ARE the four permitted words. Deriving the word from the
 * id means there is no second label table to drift out of step with
 * `OUTCOME_STATES`, and no way to render a fifth word.
 */
function stateWord(state: OutcomeState): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

export interface RecordEntryRowProps {
  /** ISO date the call was entered, rendered verbatim in the mono lead. */
  date: string;
  state: OutcomeState;
  /** The claim as it was made, before the outcome was known. */
  claim: string;
  /** The user's own reasoning, written at entry. */
  note: string;
  /**
   * How it settled, or when it will be checked. One slot: an entry states
   * either what happened or what is still to happen, never both, and the two
   * read at the same size because neither is the more important kind of fact.
   */
  outcome?: string;
  /** Opens the entry. The whole row is the control. */
  onOpen?: () => void;
}

export function RecordEntryRow({ date, state, claim, note, outcome, onOpen }: RecordEntryRowProps) {
  const body = (
    <ClaimAnatomy
      scale="row"
      lead={
        <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
          <span
            style={{
              font: "500 10px/1 'JetBrains Mono', monospace",
              letterSpacing: "0.07em",
              color: "var(--c-muted)",
            }}
          >
            {date}
          </span>
          {/* The dot is this build's, not the design's: the design's record row
              carries the word alone. Compliance fixes state as a dot plus the
              state word, and it costs nothing to hold to that here. */}
          <span
            aria-hidden="true"
            style={{
              flex: "none",
              display: "inline-block",
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              backgroundColor: OUTCOME_TOKENS[state].dot,
              /* The four words are not interchangeable, so easing between two
                 semantic hues would render one state in another state's colour
                 for the length of the transition. */
              transition: "none",
            }}
          />
          <span
            style={{
              font: "600 10.5px/1 Inter, sans-serif",
              color: OUTCOME_TOKENS[state].text,
              transition: "none",
            }}
          >
            {stateWord(state)}
          </span>
        </div>
      }
      claim={claim}
      meta={
        <>
          <p
            style={{
              margin: 0,
              font: "400 italic 13px/1.55 'Playfair Display', serif",
              color: "var(--c-body)",
              textWrap: "pretty",
            }}
          >
            {note}
          </p>
          {outcome ? (
            <p
              style={{
                margin: 0,
                font: "400 11.5px/1.5 Inter, sans-serif",
                color: "var(--c-secondary)",
              }}
            >
              {outcome}
            </p>
          ) : null}
        </>
      }
    />
  );

  const frame: React.CSSProperties = {
    padding: "15px 0",
    borderBottom: "1px solid var(--c-hair)",
    display: "flex",
    flexDirection: "column",
    gap: "7px",
    width: "100%",
    textAlign: "left",
  };

  if (!onOpen) {
    return <div style={frame}>{body}</div>;
  }

  return (
    <button type="button" onClick={onOpen} className={styles.bare} style={frame}>
      {body}
    </button>
  );
}

import { ClaimAnatomy, OutcomeLead, type OutcomeState } from "./claim-anatomy";
import styles from "./ledger.module.css";

/**
 * A settled entry on a past day. Not a card: a ruled row with no fill and no
 * radius, separated from its neighbour by a 1px hairline, measured off the
 * rendered prototype at padding 15px 0 and a 7px column gap.
 *
 * The whole row IS the control, which inverts the claim card's contract. That
 * is why these are two components rather than one with a flag: on a card the
 * container must not be focusable because it contains a button, and here the
 * container must be focusable because it is the button.
 *
 * A challenged entry renders exactly as a supported one. Same size, same
 * weight, same position in sequence, no filter, no de-emphasis. A record
 * carrying challenged calls is more credible than a spotless one, and the only
 * way that stays true is if nothing here treats them differently.
 */

export interface LedgerEntryRowProps {
  state: OutcomeState;
  /** Ticker or instrument, on the trailing edge of the state row. */
  instrument?: string;
  /** The claim as it was made, before the outcome was known. */
  claim: string;
  /** How it settled, against what benchmark. */
  result?: string;
  /** Opens the entry. */
  onOpen?: () => void;
  /** True for the first row under a date rule, which carries the top margin. */
  first?: boolean;
}

export function LedgerEntryRow({
  state,
  instrument,
  claim,
  result,
  onOpen,
  first = false,
}: LedgerEntryRowProps) {
  const body = (
    <ClaimAnatomy
      scale="row"
      lead={<OutcomeLead state={state} instrument={instrument} />}
      claim={claim}
      prose={result}
    />
  );

  const frame: React.CSSProperties = {
    padding: "15px 0",
    borderTop: "1px solid var(--c-hair)",
    marginTop: first ? "10px" : 0,
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

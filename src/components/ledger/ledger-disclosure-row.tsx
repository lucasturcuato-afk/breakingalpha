import type { ReactNode } from "react";
import {
  CLAIM_TYPE_SCALE,
  ClaimAnatomy,
  outcomeEdgeToken,
  type OutcomeState,
} from "./claim-anatomy";
import { Chevron } from "./chevron";
import styles from "./ledger.module.css";

/**
 * A ruled row that opens where it stands.
 *
 * A WRAPPER BESIDE `LedgerEntryRow`, NEVER A BRANCH INSIDE IT. That row's whole
 * contract is that the container IS the control and the control goes somewhere:
 * pass `onOpen` and it becomes a `<button>` that navigates, omit it and it is a
 * plain div. Neither shape can carry `aria-expanded`, and a row that opens in
 * place has to. So this is a second component with the same frame and the same
 * anatomy rather than a flag on that one, which is the same call
 * `ledger-claim-card.tsx` and `ledger-entry-row.tsx` already made about each
 * other.
 *
 * THE FIRST IN-PLACE DISCLOSURE IN THIS REPO, and it follows the two hand-rolled
 * precedents rather than inventing a third shape. `evening-wrap-screen.tsx` and
 * `feed-mobile-screen.tsx` both obey one rule and so does this:
 *
 *   A TOGGLE WITH NOTHING BEHIND IT IS A CONTROL THAT LIES ABOUT WHAT IT DOES.
 *
 * Both of those render their toggle only when there is more to show. Here that
 * is `disclosable` below: with no reading and no detail there is nothing behind
 * the control, so the row renders as a plain div with its claim UNCLAMPED. That
 * pairing is the whole rule in one line. The clamp exists to summarise
 * something that can be opened; a clamp with no opener would hide text with no
 * way to reach it, which is worse than the row it replaced.
 *
 * THE CLAIM IS CLAMPED, NOT THE READING, and that inverts the Ledger's card.
 * The card clamps its reading to three lines and puts a right chevron beside it
 * because the reading continues on another screen. On a record the reading is
 * the second paragraph of every row and it is never the thing a reader is
 * scanning for, so it is the half that goes behind the control. What stays is
 * the state word, the instrument and the claim's first clause.
 *
 * THE CHEVRON POINTS DOWN WHEN OPEN AND RIGHT WHEN CLOSED, which is `Chevron`'s
 * own vocabulary used as it is documented: right for a reading that continues,
 * down for one that is now below. There is no up arm in that component and this
 * does not add one.
 *
 * `detail` IS RENDERED OUTSIDE THE BUTTON, on purpose. It carries a link on
 * both screens that consume this, and a link inside a button is nested
 * interactive content: the row's own control would swallow the destination's
 * tap on some engines and announce two controls as one everywhere. The button
 * is the head, the opened body is its sibling, and the container is a plain
 * div. That also keeps the tap target honest: what is drawn as the control is
 * exactly what is bound to the toggle.
 *
 * CONTROLLED, WITH NO STATE OF ITS OWN. The screens hold one open-set between
 * them, which is what lets a screen close every row when its filter changes
 * without this component knowing a filter exists.
 *
 * ---------------------------------------------------------------------------
 * IT IS A BOXED CARD, AND THAT IS THE ANSWER TO "EVERY ROW IS THE SAME WEIGHT".
 *
 * This shipped drawing `LedgerEntryRow`'s frame: a 1px top hairline and nothing
 * else. On a phone that gives a list where every row weighs exactly what its
 * neighbour weighs and the eye has nothing to grab, which is the complaint the
 * desk made against both screens that consume this. The desk's own list draws
 * raised cards with real boundaries; the phone drew a stack of rules.
 *
 * So the container is now a card: 1px `--c-border`, 12px radius, `--c-card`
 * fill, and an 8px GAP where the hairline used to be. Four sides and air, on
 * every row, whatever state it carries. That last clause is the point. Any
 * scheme that separates rows BY COLOUR cannot separate `developing` from
 * `awaiting`, which share a base token by design and are the majority of the
 * list; the box separates them because a boundary is not a hue.
 *
 * THE STATE MARKER IS A 2px TOP EDGE, which is prescribed rather than merely
 * permitted: the design README bans coloured LEFT borders and names a 2px top
 * edge plus a dot and the state word as the sanctioned replacement. It is the
 * first child of a bordered, 12px-radius, `overflow:hidden` card, which is the
 * shape every top edge in the prototype and in `trend-signal-card.tsx` takes.
 * The dot and the word stay, so no state is ever carried by colour alone.
 *
 * THE PADDING IS 9px 14px, NOT THE CARD'S OWN 18px, and the number was chosen
 * against the fold rather than against the design system. The collapse redesign
 * took Calls from three rows above the fold to six and the record from two to
 * five, and that gain is not negotiable. A card's chrome costs 4px the hairline
 * row did not spend (two borders plus the edge, against one hairline) and the
 * gap costs 8 more, so the vertical padding is the only place the 12 can come
 * back from. It comes back honestly: the head is already a 44px control with
 * its content vertically centred, so 9px of padding still leaves about 11px of
 * clear air between the ink and the border. Measured pitch is 74, one pixel
 * UNDER the hairline row it replaces, and no screen loses a fold row.
 *
 * THE CONTAINER IS STILL NOT FOCUSABLE. It is a plain div with a button head
 * and a sibling body, which is exactly the shape the README requires of a
 * container that already holds a focusable control. Boxing it changed the skin
 * and nothing about what is tappable: the whole card is NOT a control.
 *
 * `LedgerEntryRow` IS NOT TOUCHED and stays a ruled row. The Ledger screen
 * draws today's claims as cards above past entries as rules, and that contrast
 * carries meaning because both shapes are on one screen. Neither screen that
 * consumes THIS component draws the other shape, so there is nothing for a
 * ruled row to contrast with there. `claim-anatomy.tsx` calls a card and a
 * ruled row "different objects rather than one object in two skins"; this file
 * has argued at length that it is a different object from the entry row, and it
 * now owns the container that follows from that rather than borrowing one.
 *
 * That also removes a copy. The five frame numbers were duplicated between
 * `ledger-entry-row.tsx` and this file; they are now one frame each, and a
 * fourth wrapper carrying a third copy was never written.
 */

export interface LedgerDisclosureRowProps {
  /**
   * The state dot and its word, plus the instrument. Passed rather than derived
   * because one of the two screens draws a row that has no outcome word at all
   * and must not be given one.
   */
  lead: ReactNode;
  /** The claim as it was made. Never rewritten, never truncated. */
  claim: string;
  /**
   * The reading behind the control: how it settled, or what it is watching for.
   * Absent means there is nothing to open, and the row draws no control.
   */
  reading?: ReactNode;
  /** Anything else the opened body carries, e.g. a destination. */
  detail?: ReactNode;
  open: boolean;
  onToggle: () => void;
  /** True for the first row under a rule, which carries the top margin. */
  first?: boolean;
  /**
   * Colours the 2px top edge, and nothing else.
   *
   * PASSED SEPARATELY FROM `lead` ON PURPOSE. The lead stays an opaque node
   * because one of the two screens draws a row with no outcome word at all, so
   * this component cannot derive a state from it. The edge is a fill and needs
   * a base token, so the state arrives here as the closed union rather than as
   * a colour string: a caller cannot reach for a hex, an ink token, or a fifth
   * hue, because the mapping lives in `outcomeEdgeToken` and is applied below.
   *
   * REQUIRED, and null is the answer for a row with no grade rather than the
   * absence of one. A card that silently dropped its state marker because a
   * caller forgot the prop is the defect an optional would have allowed.
   */
  state: OutcomeState | null;
}

export function LedgerDisclosureRow({
  lead,
  claim,
  reading,
  detail,
  open,
  onToggle,
  first = false,
  state,
}: LedgerDisclosureRowProps) {
  const disclosable = Boolean(reading) || Boolean(detail);
  const s = CLAIM_TYPE_SCALE.row;

  /* The card. `overflow:hidden` is what lets the 2px edge above sit flush with
     the top of a 12px radius instead of squaring off its corners. */
  const frame: React.CSSProperties = {
    border: "1px solid var(--c-border)",
    borderRadius: "12px",
    backgroundColor: "var(--c-card)",
    overflow: "hidden",
    /* The first card in a list sits a little further off its heading. Every
       other card carries the 8px that used to be a hairline. */
    marginTop: first ? "10px" : "8px",
  };

  /* Inside the edge, so the edge is full bleed and the content is not. */
  const inner: React.CSSProperties = {
    padding: "9px 14px",
    display: "flex",
    flexDirection: "column",
    gap: "7px",
  };

  const head = (
    <ClaimAnatomy
      scale="row"
      lead={
        disclosable ? (
          <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
            {/* flex 1 and min-width 0: the lead is itself a flex row whose
                instrument is pushed right with `margin-left:auto`, and without
                a definite width here a long instrument would push the chevron
                off the row instead of the lead shrinking. */}
            <div style={{ flex: 1, minWidth: 0 }}>{lead}</div>
            <Chevron direction={open ? "down" : "right"} />
          </div>
        ) : (
          lead
        )
      }
      claim={claim}
      claimClassName={disclosable && !open ? styles.clamp1 : undefined}
    />
  );

  /* A base token, never an ink one, and never a fifth fill. A row with no
     grade takes the neutral edge for the same reason its lead draws a hollow
     ring rather than a filled dot: there is nothing to fill in, and a fifth
     hue here would read as a fifth state.

     THE MAPPING IS NOT WRITTEN HERE ANY MORE. It was one inline ternary, which
     left the whole contract of a required prop on a shared component checkable
     only by looking at a rendered card in a browser. `outcomeEdgeToken` in
     `claim-anatomy.tsx` owns it beside the table it reads, and
     `tests/unit/outcome-edge-token.test.ts` pins every arm. */
  const edge = (
    <div
      aria-hidden="true"
      style={{
        height: "2px",
        backgroundColor: outcomeEdgeToken(state),
      }}
    />
  );

  if (!disclosable) {
    return (
      <div data-row style={frame}>
        {edge}
        <div style={inner}>{head}</div>
      </div>
    );
  }

  return (
    <div data-row style={frame}>
      {edge}
      <div style={inner}>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className={`${styles.bare} ${styles.focusable}`}
          style={{
            /* The drawn control is 44px whatever the claim wraps to. `.bare`
               zeroes padding and border, so there is no box to grow past the
               min-height and no `content-box` correction to make. */
            minHeight: "44px",
            width: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "7px",
            textAlign: "left",
          }}
        >
          {head}
        </button>
        {open ? (
          /* The Ledger's own 240ms entrance, which already rests in its drawn
             state and already carries the reduced-motion guard. */
          <div
            className={styles.enter}
            style={{ display: "flex", flexDirection: "column", gap: "9px" }}
          >
            {reading ? (
              /* Drawn from the exported scale rather than from a literal, so the
                 opened reading is the same type as an entry row's reading and
                 cannot drift from it. */
              <p style={{ margin: 0, font: s.prose, color: "var(--c-body)" }}>{reading}</p>
            ) : null}
            {detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

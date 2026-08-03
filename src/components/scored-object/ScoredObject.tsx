/**
 * ScoredObject — the signature component of the Signalera visual identity.
 *
 * A single record whose anatomy is: claim -> timestamped receipt ->
 * verdict-against-reality -> attribution, with a verdict-state left spine and
 * gold reserved for the "reality has spoken" seal. See signalera-design-spec §4.
 *
 * ONE VOICE: the entire card renders in Newsreader (the display serif, loaded as
 * --font-playfair-display). Hierarchy comes from size / weight / color only —
 * there is no font switching inside the card and no all-caps mono.
 *
 * PURELY PRESENTATIONAL. Every value is a prop. The resolved states
 * (right / wrong / inconclusive, shown as supported / challenged / no clean
 * read) carry NO data source and NO invented numbers:
 * if a receipt/calibration/attribution field is not passed, it is not rendered.
 * On live surfaces, resolved states may ONLY be produced by the outcome mapper
 * (scored-object-map.ts scoredCallProps) from a real morning_brief_call_outcomes
 * row; hand-written resolved props belong exclusively to /preview/scored-object.
 *
 * "notGraded" is the honest absence-of-verdict state: the call's window closed
 * but no credible grade exists (ungradable outcome, or never graded). It must
 * not look like a verdict (no gold seal, no verdict word) and must not look
 * like a still-pending Open either.
 */

import type { ReactNode } from "react";

import { RESOLVED_ZONE_TYPE, typeVar } from "@/lib/scored-object-type-scale";
import { verdictWordForState } from "@/lib/verdict-vocabulary";

export type ScoredState = "open" | "right" | "wrong" | "inconclusive" | "notGraded";

export interface ScoredObjectProps {
  /** Verdict state. Drives the spine, seal, and verdict-zone rendering. */
  state: ScoredState;
  /** Sector / topic eyebrow, sentence case (e.g. "Semiconductors"). */
  sector: string;
  /** The assertion being scored. */
  claim: string;

  // ── Receipt line (the trust: captured before the outcome was known) ──
  /** When the call was made, e.g. "Apr 8". */
  calledDate?: string;
  /** Confidence percentage, e.g. 70 -> "70% confidence". Number comes from props only. */
  confidencePct?: number;
  /** Consensus read at call time, e.g. "Street neutral". */
  consensus?: string;

  // ── Open-state verdict zone ──
  /** When it resolves, e.g. "Apr 22". */
  resolvesWhen?: string;
  /** What it resolves against, e.g. "the S&P 500 close". */
  resolvesSource?: string;

  // ── Resolved-state seal + verdict zone ──
  /** Date shown on the gold seal, e.g. "Apr 22" -> "◆ Scored Apr 22". */
  scoredDate?: string;
  /**
   * Verdict word override. Defaults to the shared observational vocabulary
   * (right -> "Supported", wrong -> "Challenged", inconclusive -> "No clean
   * read"); see @/lib/verdict-vocabulary. These are state labels, not grades on
   * a person and not numbers.
   */
  verdict?: string;
  /** Calibration sentence, e.g. "More confident than consensus — a bold, correct call." */
  calibration?: string;
  /**
   * The benchmark evidence, sentence case, e.g.
   * "Attribution: clean - MSFT +3.27% vs XLK -1.19%, SPY +0.32%."
   * The most prominent line in the resolved zone: it is what makes the verdict
   * earned rather than asserted.
   */
  attribution?: string;

  // ── notGraded-state verdict zone ──
  /**
   * Why no grade exists, e.g. "Window closed without a grade." or
   * "No price data for the session." Rendered muted; never a verdict.
   */
  notGradedReason?: string;

  // ── Commitment (presentation only) ──
  /**
   * Rendered inside the card, below a rule, as the card's footer. This is where
   * the commit affordance lives: the card is the unit, and an affordance
   * floating in the gutter above a separately bordered card reads as debug UI
   * rather than as part of the object.
   */
  footer?: ReactNode;
  /**
   * The reader has committed to this call. Swaps the left spine to the same
   * gold a scored card reserves for its seal, so the edge says "this one is on
   * your record" at a glance. Purely visual: it changes no verdict state.
   */
  committed?: boolean;
}

/** Verdict-state spine + verdict-word color, mapped to existing tokens (spec §3, Rule B). */
const STATE_COLOR: Record<ScoredState, string> = {
  open: "var(--border-hi)",
  right: "var(--signal-up)",
  wrong: "var(--signal-dn)",
  inconclusive: "var(--text-muted)",
  // Dimmer than Open: an absence, not an active wait and not a verdict.
  notGraded: "var(--border-subtle)",
};

// The default verdict label now comes from the shared vocabulary table rather
// than a local Right/Wrong map. Only /radar/desk-record passed the observational
// word explicitly, so every other surface fell through to a default that said
// something the grader cannot support. There is nothing left to fall through to.

const SERIF = "var(--font-playfair-display), serif";

export function ScoredObject(props: ScoredObjectProps) {
  const { state, sector, claim } = props;
  const isOpen = state === "open";
  const isNotGraded = state === "notGraded";
  // A committed call takes the gold edge. Everything else keeps its verdict
  // spine, so the accent never overwrites what reality said.
  const spine = props.committed ? "var(--gold)" : STATE_COLOR[state];

  return (
    <article
      className="card-hover-lift relative overflow-hidden rounded-lg bg-elevated border border-border-subtle"
      style={{ fontFamily: SERIF }}
    >
      {/* Left spine — 3px, full height, verdict-state color. Not rounded. */}
      <span
        aria-hidden
        className="scored-object-spine absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ backgroundColor: spine }}
      />

      <div className="pl-5 pr-5 py-4">
        {/* Header row: sector eyebrow (left) · status (right) */}
        <div className="flex items-baseline justify-between gap-3">
          <span
            className="text-text-muted"
            style={{
              fontSize: "var(--type-eyebrow-size)",
              fontWeight: "var(--type-eyebrow-weight)" as unknown as number,
            }}
          >
            {sector}
          </span>
          {isOpen ? (
            <span className="flex items-center gap-1.5 text-text-secondary" style={{ fontSize: "var(--type-eyebrow-size)" }}>
              <span
                aria-hidden
                className="track-record-pending-dot inline-block w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: "var(--text-muted)" }}
              />
              Open
            </span>
          ) : isNotGraded ? (
            // Absence of a verdict: no pending dot (nothing is coming), and
            // no gold seal (reality has not spoken through us here).
            <span className="text-text-muted" style={{ fontSize: "var(--type-eyebrow-size)" }}>
              Not graded
            </span>
          ) : (
            // Resolved seal. Gold is used ONLY on the ◆ glyph (spec §3, Rule A);
            // the "Scored [date]" text stays neutral.
            <span className="text-text-secondary" style={{ fontSize: "var(--type-eyebrow-size)" }}>
              <span aria-hidden style={{ color: "var(--gold)" }}>◆</span>
              {props.scoredDate ? ` Scored ${props.scoredDate}` : " Scored"}
            </span>
          )}
        </div>

        {/* Claim */}
        <p
          className="mt-2 text-text-primary"
          style={{
            fontSize: "var(--type-claim-size)",
            fontWeight: "var(--type-claim-weight)" as unknown as number,
            lineHeight: "var(--type-claim-leading)",
          }}
        >
          {claim}
        </p>

        {/* Receipt line — timestamped, captured before the outcome. */}
        {(props.calledDate || props.confidencePct != null || props.consensus) && (
          <p
            className="mt-2 text-text-muted"
            style={{
              fontSize: "var(--type-receipt-size)",
              fontWeight: "var(--type-receipt-weight)" as unknown as number,
              lineHeight: "var(--type-receipt-leading)",
            }}
          >
            {[
              props.calledDate ? `Called ${props.calledDate}` : null,
              props.confidencePct != null ? `${props.confidencePct}% confidence` : null,
              props.consensus ? `consensus ${props.consensus}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}

        {/* Verdict zone */}
        {isOpen ? (
          <>
            <hr className="mt-3 mb-3 border-t border-border-subtle" />
            {(props.resolvesWhen || props.resolvesSource) && (
              <p
                className="text-text-muted"
                style={{ fontSize: "var(--type-receipt-size)", lineHeight: "var(--type-receipt-leading)" }}
              >
                {`Resolves ${props.resolvesWhen ?? "when the window closes"}`}
                {props.resolvesSource ? `, against ${props.resolvesSource}.` : "."}
              </p>
            )}
          </>
        ) : isNotGraded ? (
          <>
            <hr className="mt-3 mb-3 border-t border-border-subtle" />
            {/* Honest absence: muted note typography, never verdict typography. */}
            <p
              className="text-text-muted"
              style={{ fontSize: "var(--type-receipt-size)", lineHeight: "var(--type-receipt-leading)" }}
            >
              {props.notGradedReason ?? "Window closed without a grade."}
            </p>
          </>
        ) : (
          <div className="resolve-fade-up mt-3">
            {/* The verdict, as a quiet label. It used to be the largest element
                on the card at 31px, which put the loudest weight on the least
                specific fact. State color still carries it at a glance. */}
            <p
              data-testid="scored-object-verdict"
              style={{
                color: spine,
                fontSize: typeVar(RESOLVED_ZONE_TYPE.verdict.sizeVar),
                fontWeight: typeVar(RESOLVED_ZONE_TYPE.verdict.weightVar) as unknown as number,
                lineHeight: "var(--type-verdict-leading)",
              }}
            >
              {props.verdict ?? verdictWordForState(state)}
            </p>
            {/* The evidence, and now the largest thing in the zone. This line is
                the product: a benchmark-attributed move is what separates a
                graded call from an opinion, and it was rendering as a footnote
                in small faint italic. Roman, not italic; italic is an aside. */}
            {props.attribution && (
              <p
                data-testid="scored-object-attribution"
                className="mt-1.5 text-text-primary"
                style={{
                  fontSize: typeVar(RESOLVED_ZONE_TYPE.attribution.sizeVar),
                  fontWeight: typeVar(RESOLVED_ZONE_TYPE.attribution.weightVar) as unknown as number,
                  lineHeight: "var(--type-claim-leading)",
                }}
              >
                {props.attribution}
              </p>
            )}
            {/* The grader's prose. Honest for supported AND challenged
                (spec §4), and it sits below the evidence it is explaining. */}
            {props.calibration && (
              <p
                className="mt-1.5 text-text-secondary"
                style={{
                  fontSize: typeVar(RESOLVED_ZONE_TYPE.calibration.sizeVar),
                  lineHeight: "var(--type-receipt-leading)",
                }}
              >
                {props.calibration}
              </p>
            )}
          </div>
        )}

        {/* Footer: the commit affordance, inside the card it belongs to. */}
        {props.footer ? (
          <>
            <hr className="mt-3 mb-3 border-t border-border-subtle" />
            <div data-testid="scored-object-footer">{props.footer}</div>
          </>
        ) : null}
      </div>
    </article>
  );
}

export default ScoredObject;

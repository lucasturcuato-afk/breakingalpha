"use client";

import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { BackHeader, SectionRule } from "@/components/mobile/screen-chrome";
import { TabBarClearance } from "@/components/mobile/tab-bar-clearance";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";
import styles from "@/components/mobile/mobile.module.css";
import { neutralizeThesisTitle, verdictLean } from "@/lib/track-record-live-score";
import {
  horizonLine,
  instrumentLine,
  leanTokens,
  sectorLeanTokens,
  railTail,
  sectorRows,
  shortDate,
  type TrackerStage,
  type TrackerThesis,
} from "./tracker-model";

/**
 * The evidence tracker, on a phone.
 *
 * WHY THE BACK CONTROL SAYS LEDGER. This screen sits on the Ledger pole. The
 * reasoning is in `mobile-tab-bar.tsx` beside the `owns` entry and in the PR:
 * the pole already owns `/radar/calls`, so the route namespace was never what
 * decided a pole, and the object here is a record of claims and the evidence
 * accumulating against them, which is the Ledger's object and not Radar's.
 * The control names its destination rather than stepping back, so it is a
 * plain link and not `historyAware`. That is the rule `screen-chrome.tsx`
 * states: name a destination and you go on promising it.
 *
 * THERE IS NO SCROLLER INSIDE THIS SCREEN, and that is deliberate. The shell's
 * `#main-content` is the scroll container; a second one nested in it would put
 * the tab-bar clearance below a viewport-height box where it reserves nothing.
 * The root grows, the shell scrolls, and `TabBarClearance` is the last child
 * of the root. See that module for what the shell's own bottom padding does
 * once content overflows, which is nothing.
 *
 * WHAT IS NOT DRAWN HERE, named so the omission is a choice and not an
 * oversight:
 *
 *   a rate    Nothing on this screen divides a count by another count. The
 *             desktop's `supportRate` exists to order the sector table and is
 *             not passed to this component at all. A tracker of graded theses
 *             is exactly the surface a hit rate wants to appear on.
 *   a narrative
 *             The prototype gives every card a sentence of its own ("Four
 *             reviews. The last two read the auction timetable as removing the
 *             scarcity premise."). No column holds that sentence. The review
 *             count and the horizon position are real and are drawn; the
 *             sentence is not, so it is absent.
 *   a call id The prototype heads each card CALL-0413. `theses` has a uuid and
 *             no such number. The ticker and the sector are what the row
 *             actually carries.
 */

const PAD = "var(--v3-pad)";

export interface TrackerScreenData {
  /** Every thesis the page read, already scored. */
  theses: TrackerThesis[];
  /** Theses with no verdict yet, counted by the page over the same universe. */
  awaitingCount: number;
  /** Of those, the ones whose check-after date has passed. */
  overdueCount: number;
  /** graded_at of the newest review anywhere, or null when none has run. */
  lastReviewedAt: string | null;
}

export function TrackerScreen({
  stage,
  data,
}: {
  stage: TrackerStage;
  data: TrackerScreenData;
}) {
  const theses = data.theses;
  const supportive = theses.filter((t) => verdictLean(t.live.verdict) === "supportive").length;
  const against = theses.filter((t) => verdictLean(t.live.verdict) === "against").length;
  const rows = sectorRows(theses);
  /* TWO LISTS, AND THE FIRST ONE EXISTS BECAUSE OF THE COUNT CELLS ABOVE IT.
     With one newest-first list the two figures in the grid named theses the
     reader could not reach: every recently generated thesis is ungraded, so
     the leaning ones sat below the fold of a truncated list. The first list is
     exactly what those two cells count. */
  const moved = theses
    .filter((t) => verdictLean(t.live.verdict) !== "neutral")
    .sort(
      (a, b) =>
        Number(verdictLean(b.live.verdict) === "supportive") -
          Number(verdictLean(a.live.verdict) === "supportive") ||
        Math.abs(b.live.score) - Math.abs(a.live.score),
    )
    .slice(0, 6);
  const movedIds = new Set(moved.map((t) => t.id));
  /* Newest first. The desktop's own "Recent theses" ordering, kept so the two
     surfaces put the same thesis at the top of the same list. */
  const recent = [...theses]
    .filter((t) => t.generatedAt && !movedIds.has(t.id))
    .sort((a, b) => (b.generatedAt ?? "").localeCompare(a.generatedAt ?? ""))
    .slice(0, 12);

  const showBody = stage === "ready" || stage === "stale";

  return (
    <div
      data-parity="tracker"
      className={styles.enter}
      style={{
        backgroundColor: "var(--c-bg)",
        /* Stated rather than left at 100%, which resolves against a parent
           with no height and lets the shell's ground show under a short
           state. */
        minHeight: "calc(100dvh - var(--mobile-tabbar-height) - env(safe-area-inset-bottom))",
        /* No gutter on the root. Every block below carries the design's own
           `--v3-pad`, and the back bar's rule runs full bleed because the
           design draws it across the phone rather than across the text
           column. */
        padding: 0,
      }}
    >
      <BackHeader href="/ledger" label="Ledger" />

      <div style={{ padding: `18px ${PAD} 0` }}>
        <h1
          style={{
            margin: 0,
            font: `700 24px/1.14 ${FONT_DISPLAY}`,
            letterSpacing: "-0.02em",
            color: "var(--c-ink)",
          }}
        >
          Evidence tracker
        </h1>
        <p
          style={{
            margin: "8px 0 0",
            font: `400 12.5px/1.55 ${FONT_SANS}`,
            color: "var(--c-body)",
            textWrap: "pretty",
          }}
        >
          Evidence leanings from nightly review, not graded verdicts; graded calls live in Calls.
        </p>
      </div>

      <div style={{ padding: `18px ${PAD} 24px` }}>
        {stage === "loading" ? <TrackerSkeleton /> : null}
        {stage === "error" ? <TrackerError /> : null}
        {stage === "empty" ? <TrackerEmpty /> : null}
        {stage === "stale" ? <StaleNotice lastReviewedAt={data.lastReviewedAt} /> : null}

        {showBody ? (
          <>
            <CountGrid
              tracked={theses.length}
              supportive={supportive}
              against={against}
              awaiting={data.awaitingCount}
              overdue={data.overdueCount}
            />

            <SectionRule label="by sector" marginTop="22px" />
            {rows.length === 0 ? (
              <Quiet>No sector has a thesis on it yet.</Quiet>
            ) : (
              <SectorTable rows={rows} />
            )}

            {moved.length > 0 ? (
              <>
                <SectionRule label="where evidence has moved" marginTop="24px" />
                <CardList theses={moved} />
              </>
            ) : null}

            <SectionRule
              label={moved.length > 0 ? "everything else, newest first" : "theses, newest first"}
              marginTop="24px"
            />
            {recent.length === 0 ? (
              <Quiet>Nothing carries a date yet, so nothing can be ordered.</Quiet>
            ) : (
              <CardList theses={recent} />
            )}
          </>
        ) : null}
      </div>

      {/* The tab bar's height, reserved a second time. The shell's own
          `pb-[calc(...)]` on `#main-content` is dropped by Chrome the moment
          this content overflows it. One owner, one declaration. */}
      <TabBarClearance />
    </div>
  );
}

/* ── blocks ─────────────────────────────────────────────────────────── */

function CardList({ theses }: { theses: TrackerThesis[] }) {
  return (
    <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "11px" }}>
      {theses.map((t) => (
        <ThesisCard key={t.id} thesis={t} />
      ))}
    </div>
  );
}

function CountGrid({
  tracked,
  supportive,
  against,
  awaiting,
  overdue,
}: {
  tracked: number;
  supportive: number;
  against: number;
  awaiting: number;
  overdue: number;
}) {
  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "1px",
          /* The 1px gap IS the rule between the cells, painted by the ground
             showing through. Nothing here draws a border of its own. */
          backgroundColor: "var(--c-border)",
          border: "1px solid var(--c-border)",
          borderRadius: "12px",
          overflow: "hidden",
        }}
      >
        <Cell
          span
          label="THESES TRACKED"
          value={`${tracked} ${tracked === 1 ? "thesis" : "theses"}`}
          fill="var(--c-surface)"
        />
        <Cell label="EVIDENCE SUPPORTS" value={String(supportive)} ink="var(--c-greenink)" />
        <Cell label="EVIDENCE AGAINST" value={String(against)} ink="var(--c-redink)" />
      </div>
      <p
        style={{
          margin: "11px 0 0",
          font: `400 11px/1.55 ${FONT_SANS}`,
          color: "var(--c-muted)",
          textWrap: "pretty",
        }}
      >
        Counts of where the evidence currently leans, not a settled outcome and not a rate. A
        lean can reverse on any night&rsquo;s review.
        {awaiting > 0
          ? ` ${awaiting} ${awaiting === 1 ? "thesis is" : "theses are"} awaiting a first review${
              overdue > 0 ? `, ${overdue} of them past the check-after date` : ""
            }.`
          : ""}
      </p>
    </div>
  );
}

function Cell({
  label,
  value,
  ink = "var(--c-ink)",
  fill = "var(--c-bg)",
  span = false,
}: {
  label: string;
  value: string;
  ink?: string;
  fill?: string;
  span?: boolean;
}) {
  return (
    <div
      style={{
        gridColumn: span ? "1 / -1" : undefined,
        backgroundColor: fill,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          font: `400 10px/1 ${FONT_MONO}`,
          letterSpacing: "0.07em",
          color: "var(--c-muted)",
        }}
      >
        {label}
      </div>
      <div style={{ marginTop: "6px", font: `700 20px/1 ${FONT_DISPLAY}`, color: ink }}>
        {value}
      </div>
    </div>
  );
}

function SectorTable({ rows }: { rows: ReturnType<typeof sectorRows> }) {
  const COLS = "1.5fr 0.7fr 1.1fr";
  return (
    <div
      style={{
        marginTop: "10px",
        border: "1px solid var(--c-border)",
        borderRadius: "12px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: COLS,
          backgroundColor: "var(--c-surface)",
          borderBottom: "1px solid var(--c-border)",
        }}
      >
        <div style={headCell}>SECTOR</div>
        <div style={{ ...headCell, textAlign: "center", padding: "9px 6px" }}>COUNT</div>
        <div style={{ ...headCell, textAlign: "right", padding: "9px 12px 9px 6px" }}>LEANING</div>
      </div>
      {rows.map((r, i) => {
        const t = sectorLeanTokens(r.lean);
        return (
          <div
            key={r.sector}
            style={{
              display: "grid",
              gridTemplateColumns: COLS,
              borderTop: i === 0 ? undefined : "1px solid var(--c-hair)",
            }}
          >
            <div
              style={{
                padding: "11px 12px",
                font: `500 12.5px/1.3 ${FONT_SANS}`,
                color: "var(--c-ink)",
                minWidth: 0,
                overflowWrap: "anywhere",
              }}
            >
              {r.sector}
            </div>
            <div
              style={{
                padding: "11px 6px",
                textAlign: "center",
                font: `400 12px/1.3 ${FONT_MONO}`,
                color: "var(--c-body)",
              }}
            >
              {r.count}
            </div>
            <div
              style={{
                padding: "11px 12px 11px 6px",
                textAlign: "right",
                font: `600 11.5px/1.3 ${FONT_SANS}`,
                color: t.text,
              }}
            >
              {t.word}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const headCell = {
  padding: "9px 12px",
  font: `600 10px/1 ${FONT_SANS}`,
  letterSpacing: "0.04em",
  color: "var(--c-secondary)",
} as const;

/**
 * One thesis. The whole card is the link, so the tap target is the card and
 * never a word inside it.
 */
function ThesisCard({ thesis }: { thesis: TrackerThesis }) {
  const lean = leanTokens(thesis.live.verdict, thesis.reviews.length > 0);
  const eyebrow = instrumentLine(thesis);
  /* The last eight reviews. A thesis graded nightly for a quarter would
     otherwise draw ninety dots into a 350px row and read as a rule. */
  const dots = thesis.reviews.slice(-8);
  const tail = railTail(thesis);

  return (
    <Link
      href={`/radar/track-record/${thesis.id}`}
      className={styles.bare}
      style={{
        display: "block",
        border: "1px solid var(--c-border)",
        borderRadius: "12px",
        backgroundColor: "var(--c-card)",
        overflow: "hidden",
        textDecoration: "none",
      }}
    >
      {/* The state marker is a 2px band across the TOP of the card. The design
          bans a coloured left border and so does design-lint rule 6. */}
      <div aria-hidden="true" style={{ height: "2px", backgroundColor: lean.dot }} />
      <div style={{ padding: "14px 15px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
          }}
        >
          <span
            style={{
              minWidth: 0,
              font: `500 10px/1.3 ${FONT_MONO}`,
              letterSpacing: "0.07em",
              color: "var(--c-muted)",
              overflowWrap: "anywhere",
            }}
          >
            {eyebrow ?? "NO INSTRUMENT NAMED"}
          </span>
          <span
            style={{
              flex: "none",
              font: `600 10.5px/1.3 ${FONT_SANS}`,
              color: lean.text,
            }}
          >
            {lean.word}
          </span>
        </div>

        <p
          style={{
            margin: "10px 0 0",
            font: `500 var(--v3-claim)/1.4 ${FONT_DISPLAY}`,
            color: "var(--c-ink)",
            textWrap: "pretty",
          }}
        >
          {neutralizeThesisTitle(thesis.title)}
        </p>

        {dots.length > 0 ? (
          <div
            aria-hidden="true"
            style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "4px" }}
          >
            <span style={railDate}>{shortDate(dots[0].gradedAt)}</span>
            {dots.map((r, i) => (
              <Fragment key={r.id}>
                {i > 0 ? <span style={railLine} /> : null}
                <span
                  style={{
                    flex: "none",
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    backgroundColor: leanTokens(reviewVerdictLabel(r.verdict)).dot,
                  }}
                />
              </Fragment>
            ))}
            {/* The trailing rule is drawn only when something closes the rail.
                A settled thesis with one review ends at its dot rather than
                trailing a line into nothing. */}
            {tail.ring || tail.date ? <span style={railLine} /> : null}
            {/* The hollow ring is the review that has not run yet, and it is
                withheld once nothing further will be graded. It is never
                filled, because filling it would draw a reading nothing has
                taken. See `railTail`. */}
            {tail.ring ? (
              <span
                style={{
                  flex: "none",
                  width: "9px",
                  height: "9px",
                  borderRadius: "50%",
                  border: "1.5px solid var(--c-muted)",
                  boxSizing: "content-box",
                }}
              />
            ) : null}
            {tail.date ? <span style={railDate}>{tail.date}</span> : null}
          </div>
        ) : null}

        <p
          style={{
            margin: "10px 0 0",
            font: `400 10px/1.4 ${FONT_MONO}`,
            letterSpacing: "0.07em",
            color: "var(--c-muted)",
          }}
        >
          {horizonLine(thesis)}
        </p>
      </div>
    </Link>
  );
}

const railDate = {
  flex: "none",
  font: `400 10px/1 ${FONT_MONO}`,
  color: "var(--c-muted)",
} as const;

const railLine = {
  flex: 1,
  height: "1px",
  backgroundColor: "var(--c-border)",
} as const;

/**
 * A stored `thesis_verdicts.verdict` is lower case ("confirmed"). The live
 * verdict vocabulary is capitalised, and `leanTokens` reads the live one, so
 * the stored value is lifted into it here rather than at four draw sites.
 * Anything that is neither settled value is a review that reached no verdict,
 * which is the neutral lean.
 */
export function reviewVerdictLabel(stored: string): string {
  if (stored === "confirmed") return "Confirmed";
  if (stored === "invalidated") return "Invalidated";
  return "Awaiting verdict";
}

/* ── states ─────────────────────────────────────────────────────────── */

function Quiet({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: "10px 0 0",
        font: `400 12.5px/1.55 ${FONT_SANS}`,
        color: "var(--c-muted)",
        textWrap: "pretty",
      }}
    >
      {children}
    </p>
  );
}

function TrackerSkeleton() {
  return (
    <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: "11px" }}>
      <div className={styles.sk} style={{ height: "116px", borderRadius: "12px" }} />
      <div className={styles.sk} style={{ height: "148px", borderRadius: "12px" }} />
      <div className={styles.sk} style={{ height: "148px", borderRadius: "12px" }} />
    </div>
  );
}

/**
 * A FAILED READ IS NOT AN EMPTY ONE. This state exists so that a query that
 * threw can never borrow the empty-pipeline sentence below it, which is the
 * defect `page.tsx` grew its `loadError` flag to stop on the desktop.
 */
function TrackerError() {
  return (
    <div style={panel}>
      <p style={{ margin: 0, font: `500 15px/1.35 ${FONT_DISPLAY}`, color: "var(--c-ink)" }}>
        Could not load the evidence tracker.
      </p>
      <p
        style={{
          margin: "8px 0 0",
          font: `400 12.5px/1.55 ${FONT_SANS}`,
          color: "var(--c-secondary)",
          textWrap: "pretty",
        }}
      >
        This is a loading failure, not an empty pipeline. Nothing has been lost.
      </p>
    </div>
  );
}

function TrackerEmpty() {
  return (
    <div style={panel}>
      <p style={{ margin: 0, font: `500 15px/1.35 ${FONT_DISPLAY}`, color: "var(--c-ink)" }}>
        No theses yet.
      </p>
      <p
        style={{
          margin: "8px 0 0",
          font: `400 12.5px/1.55 ${FONT_SANS}`,
          color: "var(--c-secondary)",
          textWrap: "pretty",
        }}
      >
        The tracker fills as soon as the thesis pipeline emits its first row.
      </p>
    </div>
  );
}

/**
 * Stale says the REVIEW RUN is behind, and it sits above the readings rather
 * than replacing them. The counts underneath are still the last true ones, so
 * hiding them would lose real information to report a late cron.
 */
function StaleNotice({ lastReviewedAt }: { lastReviewedAt: string | null }) {
  return (
    <div style={{ ...panel, marginBottom: "18px" }}>
      <p style={{ margin: 0, font: `500 13px/1.4 ${FONT_SANS}`, color: "var(--c-ink)" }}>
        These readings are behind.
      </p>
      <p
        style={{
          margin: "6px 0 0",
          font: `400 12px/1.55 ${FONT_SANS}`,
          color: "var(--c-secondary)",
          textWrap: "pretty",
        }}
      >
        The last nightly review wrote on {shortDate(lastReviewedAt)}. Everything below is that
        run, not tonight&rsquo;s.
      </p>
    </div>
  );
}

const panel = {
  border: "1px solid var(--c-border)",
  borderRadius: "12px",
  backgroundColor: "var(--c-well)",
  padding: "16px 15px",
} as const;

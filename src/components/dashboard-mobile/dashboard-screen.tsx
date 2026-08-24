"use client";

import { useState } from "react";
import Link from "next/link";
import { Chevron } from "@/components/ledger";
import { SentimentPill } from "@/components/ui/sentiment-pill";
import { useTheme } from "@/components/providers/theme-provider";
import { YOUR_RECORD_COPY } from "@/lib/your-record";
import { DESK_RECORD_COPY } from "@/lib/desk-record";
import ledger from "@/components/ledger/ledger.module.css";
import styles from "./dashboard.module.css";
import { RecordBuckets } from "./record-buckets";
import {
  DASH_FIXTURE,
  DASH_FIXTURE_EMPTY,
  DASH_FIXTURES_ALLOWED,
  type DashboardData,
  type DashMarketCell,
  type DashStage,
  type DashStory,
} from "./fixture";

/**
 * Today. The mobile Dashboard: the briefing top to bottom, in the order a
 * reader wants it, rather than the desktop widget grid.
 *
 * Every measurement is taken off the rendered prototype with getComputedStyle.
 * The prototype's sc-if blocks need a runtime that does not resolve over
 * file://, so the screen was rendered through `scripts/parity_harness.py` and
 * diffed with `screen-audit parity`; see the PR body.
 *
 * The desktop dashboard is untouched. It sits beside this, gated above `md`,
 * with its four loaders and its widgets exactly where they were.
 *
 * Everything on this screen comes from a fixture. Nothing here reads the
 * database, and the figures it draws are the design's sample content, not the
 * reader's. That is the unit's scope and it is the first thing to change when
 * a loader lands; see the PR body.
 */

const MONO = "'JetBrains Mono', monospace";
const PLAYFAIR = "'Playfair Display', serif";
const PAD = "var(--v3-pad)";

/**
 * The stagger ladder.
 *
 * README, github.md and the desktop call sites give three different
 * sequences, and none of them can be right for this screen because the mobile
 * briefing has seven sections against the desktop grid's eleven. These are the
 * delays the prototype's own dashReady block carries, read off the markup:
 * the date rule at rest, the greeting block at 80 and 100, the market band at
 * 140 and 180, waiting-for-you at 220, the brief card at 260, your record at
 * 300, the desk's at 340, top stories at 420.
 */
const D = {
  dateRule: 0,
  greeting: 80,
  context: 100,
  marketHead: 140,
  marketBand: 180,
  waiting: 220,
  brief: 260,
  yourRecord: 300,
  deskRecord: 340,
  stories: 420,
} as const;

export function DashboardScreen({
  stage = "ready",
  data,
}: {
  stage?: DashStage;
  data?: DashboardData;
}) {
  /* The fixture is a development and preview affordance, never a production
     fallback. `/dashboard` serves a real signed-in reader real data, so an
     unguarded `data ?? DASH_FIXTURE` puts invented stories, invented record
     counts and an invented market band in front of someone who will read them
     as their own. Every other screen in this programme carries this gate; this
     one shipped without it.

     Falling back to DASH_FIXTURE_EMPTY is NOT sufficient and was the first
     thing tried here. It zeroes the records and empties `stories`, but it
     spreads `...DASH_FIXTURE`, so it still carries the invented market band,
     and its `brief.sub` reads "Five calls, none decided yet", which is a
     specific claim about a real reader's morning made with no data behind it.
     An empty state that asserts a fact is not a safe fallback.

     So in production, absent data renders as LOADING, which is the truthful
     description of the situation: nothing has arrived. The skeleton asserts
     nothing. `d` still needs a shape to destructure, and DASH_FIXTURE_EMPTY
     supplies one that is never painted, because every branch below is gated on
     `effectiveStage`. */
  const starved = !data && !DASH_FIXTURES_ALLOWED;
  const effectiveStage: DashStage = starved ? "loading" : stage;
  const d = data ?? (stage === "empty" || starved ? DASH_FIXTURE_EMPTY : DASH_FIXTURE);
  const [editing, setEditing] = useState(false);
  /* "all" is the resting lens, which is the state the design draws. */
  const [storyLens, setStoryLens] = useState<"you" | "all">("all");
  const shown = storyLens === "you" ? d.stories.filter((s) => s.forYou) : d.stories;

  return (
    <div data-parity="dash" style={{ backgroundColor: "var(--c-bg)", minHeight: "100%" }}>
      <ScreenHead />
      {effectiveStage === "loading" ? <DashSkeleton /> : null}
      {effectiveStage === "error" ? <DashError /> : null}
      {effectiveStage === "ready" || effectiveStage === "stale" || effectiveStage === "empty" ? (
        <div className={styles.dots} style={{ padding: `0 ${PAD} 26px` }}>
          <div className={styles.rise} style={{ display: "flex", alignItems: "center", gap: "11px" }}>
            <span style={{ font: `400 italic 13px/1 ${PLAYFAIR}`, color: "var(--c-secondary)" }}>
              {d.date}
            </span>
            <span aria-hidden="true" style={{ flex: 1, height: "1px", backgroundColor: "var(--c-border)" }} />
            <span style={{ font: `400 10.5px/1 ${MONO}`, letterSpacing: "0.07em", color: "var(--c-muted)" }}>
              {d.clock}
            </span>
          </div>

          {effectiveStage === "stale" ? <StaleNotice text={d.staleNotice} /> : null}

          <p
            className={styles.rise}
            style={{
              animationDelay: `${D.greeting}ms`,
              margin: "16px 0 0",
              font: `400 italic 15px/1.3 ${PLAYFAIR}`,
              color: "var(--c-goldink)",
            }}
          >
            {d.eyebrow}
          </p>
          <h1
            className={styles.rise}
            style={{
              animationDelay: `${D.greeting}ms`,
              margin: "8px 0 0",
              font: `500 30px/1 ${PLAYFAIR}`,
              letterSpacing: "-0.025em",
              color: "var(--c-ink)",
            }}
          >
            {d.greeting}
          </h1>
          {/* No fallback sentence. `context` is derived from the reader's own
              watchlist, sectors and the latest briefing's tone; when none of
              those produces a line there is nothing true to say about the
              tape, so the greeting says nothing about it. */}
          {d.context ? (
            <p
              className={styles.rise}
              style={{
                animationDelay: `${D.context}ms`,
                margin: "10px 0 0",
                font: `400 italic 15px/1.5 ${PLAYFAIR}`,
                color: "var(--c-secondary)",
                textWrap: "pretty",
              }}
            >
              {d.context}
            </p>
          ) : null}

          <MarketBand cells={d.market} editing={editing} onToggle={() => setEditing((v) => !v)} />

          {d.waiting ? (
            <>
              <SectionRule label="waiting for you" delayMs={D.waiting} />
              <WaitingCard eyebrow={d.waiting.eyebrow} line={d.waiting.line} />
            </>
          ) : null}

          <Link
            href="/ledger"
            className={styles.rise}
            style={{
              animationDelay: `${D.brief}ms`,
              marginTop: d.waiting ? "10px" : "26px",
              minHeight: "56px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "14px",
              padding: "13px 16px",
              border: "1px solid var(--c-border)",
              borderRadius: "12px",
              backgroundColor: "var(--c-surface)",
              textDecoration: "none",
            }}
          >
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", font: "600 13px/1.3 Inter, sans-serif", color: "var(--c-ink)" }}>
                {d.brief.title}
              </span>
              <span
                style={{
                  display: "block",
                  marginTop: "4px",
                  font: "400 11.5px/1.4 Inter, sans-serif",
                  color: "var(--c-muted)",
                }}
              >
                {d.brief.sub}
              </span>
            </span>
            <Chevron direction="right" size={15} />
          </Link>

          <SectionRule label="your record" delayMs={D.yourRecord} />
          <Explainer text={d.yourRecord.intro} />
          {d.yourRecord.awaiting === 0 &&
          Object.values(d.yourRecord.byResolution).every((n) => n === 0) ? (
            /* The prototype draws populated counts in every state, so day one
               is undepicted. The copy for it is already written, tested and
               compliance-asserted in `your-record.ts`, and it is used verbatim
               rather than re-authored here. */
            <Absence title={YOUR_RECORD_COPY.noClaimsTitle} body={YOUR_RECORD_COPY.noClaimsBody} />
          ) : (
            <>
              <RecordBuckets
                variant="personal"
                byResolution={d.yourRecord.byResolution}
                awaiting={d.yourRecord.awaiting}
              />
              <p
                style={{
                  margin: "12px 0 0",
                  font: `400 italic 11px/1.5 ${PLAYFAIR}`,
                  color: "var(--c-muted)",
                  textWrap: "pretty",
                }}
              >
                Awaiting means the window has not closed yet, not that the call was missed.
              </p>
            </>
          )}
          {/* TODO: point at the Prepared record once step 6 lands. Held on
              this branch, so the control is drawn in its own resting state
              and does nothing rather than routing at a 404. The desk's
              nearest equivalent today is /radar/calls, which the design
              dismantles; sending a phone reader there is a decision, not a
              default. */}
          <TailLink label="All calls →" onClick={() => {}} />

          <SectionRule label="the desk's record" delayMs={D.deskRecord} />
          <Explainer text={d.deskRecord.intro} />
          {d.deskRecord.total === 0 ? (
            <Absence title={DESK_RECORD_COPY.emptyTitle} body={DESK_RECORD_COPY.emptyBody} />
          ) : (
            <RecordBuckets
              variant="desk"
              byResolution={d.deskRecord.byResolution}
              total={d.deskRecord.total}
            />
          )}
          {/* TODO: point at the Desk record once step 7 lands. Held on this
              branch, same treatment. /radar/desk-record is the desk's
              equivalent and is deliberately not linked, for the same reason. */}
          <TailLink label="The whole record →" onClick={() => {}} />

          <SectionRule label="top stories" delayMs={D.stories} />
          <div style={{ marginTop: "10px", display: "flex", gap: "12px" }}>
            <StoryLens label="For You" on={storyLens === "you"} onClick={() => setStoryLens("you")} />
            <StoryLens label="All" on={storyLens === "all"} onClick={() => setStoryLens("all")} />
          </div>
          {shown.length ? (
            <div style={{ marginTop: "10px" }}>
              {shown.map((s, i) => (
                <StoryRow key={s.id} story={s} last={i === shown.length - 1} />
              ))}
            </div>
          ) : (
            <Absence
              title={storyLens === "you" ? "Nothing matched your sectors." : "No stories yet."}
              body={
                storyLens === "you"
                  ? "Every story is still here. Switch to All to read the ones the lens set aside."
                  : "The overnight read has not published. Nothing is being filtered out of this list."
              }
            />
          )}
          <TailLink label="The whole feed →" href="/live-feed" />

          <p
            style={{
              margin: "24px 0 0",
              font: "400 11px/1.6 Inter, sans-serif",
              color: "var(--c-muted)",
              textWrap: "pretty",
            }}
          >
            {d.disclaimer}
          </p>
          {/* No spacer for the tab bar. The shell already reserves its height
              plus the safe-area inset on `main`; adding a second env() here
              would count the inset twice. The 26px below is the design's own
              bottom gap. */}
        </div>
      ) : null}
    </div>
  );
}

/* ── head ───────────────────────────────────────────────────────────── */

function ScreenHead() {
  /* `mounted` is read, not just `theme`. The provider seeds "light" and only
     learns the real preference in its own effect, so a dark reader would get
     the moon glyph and the label "Switch to the dark theme" for a frame while
     already dark. `topbar.tsx` guards the same way. */
  const { theme, toggleTheme, mounted } = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: `2px ${PAD} 12px`,
      }}
    >
      <span style={{ display: "inline-flex", font: `700 19px/1 ${PLAYFAIR}`, letterSpacing: "-0.02em" }}>
        <span style={{ color: "var(--c-ink)" }}>Signal</span>
        {/* The design clips a three-stop gold gradient to this word. Solid
            --c-goldink here: no token expresses those stops, gold as type at
            --c-gold is an ink/base swap, and the gradient's own midpoint
            measures under 3:1 on cream at this size. */}
        <span style={{ color: "var(--c-goldink)" }}>era</span>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={
            !mounted
              ? "Switch the theme"
              : theme === "dark"
                ? "Switch to the light theme"
                : "Switch to the dark theme"
          }
          className={ledger.bare}
          style={{
            minWidth: "44px",
            minHeight: "44px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {!mounted ? (
            <span aria-hidden="true" style={{ width: "18px", height: "18px" }} />
          ) : theme === "dark" ? (
            <SunGlyph />
          ) : (
            <MoonGlyph />
          )}
        </button>
        <Link
          href="/settings/profile"
          aria-label="Your profile and settings"
          style={{
            minWidth: "44px",
            minHeight: "44px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textDecoration: "none",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: "31px",
              height: "31px",
              borderRadius: "50%",
              backgroundColor: "var(--c-well)",
              border: "1px solid var(--c-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              font: "600 11.5px/1 Inter, sans-serif",
              color: "var(--c-secondary)",
            }}
          >
            MR
          </span>
        </Link>
      </span>
    </div>
  );
}

function SunGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--c-gold)"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--c-secondary)"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 14.5A8.2 8.2 0 0 1 9.5 4 8.3 8.3 0 1 0 20 14.5z" />
    </svg>
  );
}

/* ── blocks ─────────────────────────────────────────────────────────── */

function SectionRule({ label, delayMs }: { label: string; delayMs: number }) {
  return (
    <div
      className={styles.rise}
      style={{
        animationDelay: `${delayMs}ms`,
        marginTop: "26px",
        display: "flex",
        alignItems: "center",
        gap: "11px",
      }}
    >
      <span style={{ font: `400 italic 12.5px/1 ${PLAYFAIR}`, color: "var(--c-secondary)" }}>
        {label}
      </span>
      <span aria-hidden="true" style={{ flex: 1, height: "1px", backgroundColor: "var(--c-border)" }} />
    </div>
  );
}

function Explainer({ text }: { text: string }) {
  return (
    <p
      style={{
        margin: "10px 0 0",
        font: "400 11.5px/1.5 Inter, sans-serif",
        color: "var(--c-muted)",
        textWrap: "pretty",
      }}
    >
      {text}
    </p>
  );
}

function MarketBand({
  cells,
  editing,
  onToggle,
}: {
  cells: DashMarketCell[];
  editing: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <div
        className={styles.rise}
        style={{
          animationDelay: `${D.marketHead}ms`,
          marginTop: "18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ font: `400 10px/1 ${MONO}`, letterSpacing: "0.07em", color: "var(--c-muted)" }}>
          MARKET
        </span>
        <button
          type="button"
          onClick={onToggle}
          className={ledger.bare}
          style={{
            minHeight: "44px",
            display: "flex",
            alignItems: "center",
            padding: "0 4px",
            font: "500 11.5px/1 Inter, sans-serif",
            color: "var(--c-secondary)",
          }}
        >
          {editing ? "Done" : "Edit"}
        </button>
      </div>
      <div
        className={styles.rise}
        style={{
          animationDelay: `${D.marketBand}ms`,
          marginTop: "2px",
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
          gap: "14px 0",
        }}
      >
        {cells.map((c, i) => (
          <MarketCell key={c.symbol} cell={c} editing={editing} divided={i % 2 === 1} />
        ))}
      </div>
      {editing ? (
        <p
          style={{
            margin: "10px 0 0",
            font: "400 11px/1.5 Inter, sans-serif",
            color: "var(--c-muted)",
            textWrap: "pretty",
          }}
        >
          Two to four cards. Drag to reorder, tap a card to swap it for Nasdaq, Dow Jones, Bitcoin,
          Gold, Oil or DXY.
        </p>
      ) : null}
    </>
  );
}

function MarketCell({
  cell,
  editing,
  divided,
}: {
  cell: DashMarketCell;
  editing: boolean;
  /** The right-hand column carries the gold hairline. */
  divided: boolean;
}) {
  const cls = `${styles.figcell}${divided ? ` ${styles.figcellDivided}` : ""}`;
  const body = (
    <>
      <p
        style={{
          margin: "0 0 6px",
          font: `400 10px/1 ${MONO}`,
          letterSpacing: "0.01em",
          color: "var(--c-muted)",
        }}
      >
        {cell.label}
      </p>
      {/* The delta stacks under the value rather than sharing its baseline.
          The desktop cell shares one, which is unconstrained in a wide band
          and overflows a 175px mobile column at eight characters. Stacking all
          four gives one anatomy; breaking the line conditionally gave two. */}
      <p
        style={{
          margin: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: "5px",
        }}
      >
        <span style={{ font: `600 22px/1 ${MONO}`, color: "var(--c-ink)" }}>{cell.value}</span>
        {cell.counts ? (
          <span style={{ font: `400 12px/1 ${MONO}` }}>
            <span style={{ color: "var(--c-greenink)" }}>{cell.counts.up}</span>{" "}
            <span style={{ color: "var(--c-redink)" }}>{cell.counts.down}</span>
          </span>
        ) : cell.delta ? (
          <span
            style={{
              font: `600 12px/1 ${MONO}`,
              color: cell.tone === "up" ? "var(--c-greenink)" : "var(--c-redink)",
            }}
          >
            {cell.delta}
            {cell.note ? (
              <span style={{ font: `400 12px/1 ${MONO}`, color: "var(--c-muted)" }}> · {cell.note}</span>
            ) : null}
          </span>
        ) : (
          /* No quote is an absence, stated. `stat-card.tsx` says the same
             thing in the same words on the desk. */
          <span style={{ font: `400 12px/1 ${MONO}`, color: "var(--c-muted)" }}>
            · {cell.note ?? "no quote"}
          </span>
        )}
      </p>
    </>
  );

  /* Pressable only while the band is being arranged. A cursor:pointer element
     with no handler is a defect the runtime audit flags by name, so the
     resting cell is a plain box.
     TODO: wire the swap and the drag. The desk already carries both, in
     `market-card-editor.tsx` (MARKET_CARD_OPTIONS, SortableMarketCard) over
     dnd-kit; this unit draws the arrange state without a store to write to,
     so the cell is a real control that does nothing yet. The helper copy
     below is the design's and describes the wired behaviour, not this one. */
  if (!editing) {
    return (
      <div className={cls} style={{ padding: "12px 14px" }}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`${cls} ${ledger.bare}`}
      style={{
        padding: "12px 14px",
        borderRadius: "9px",
        outline: "1px solid var(--c-gold)",
        outlineOffset: "-1px",
        textAlign: "left",
        display: "block",
        width: "100%",
      }}
    >
      {body}
    </button>
  );
}

function WaitingCard({ eyebrow, line }: { eyebrow: string; line: string }) {
  return (
    <button
      type="button"
      /* TODO: open Review once step 4 lands. Review is held on this branch
         and so is the commit sheet it sits downstream of, which lands in
         PR #643, so this control opens nothing rather than routing at a
         screen that does not exist. */
      onClick={() => {}}
      className={`${styles.rise} ${ledger.bare}`}
      style={{
        animationDelay: `${D.waiting}ms`,
        marginTop: "12px",
        width: "100%",
        minHeight: "60px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "14px",
        padding: "14px 16px",
        backgroundColor: "var(--c-inverse)",
        borderRadius: "12px",
        textAlign: "left",
      }}
    >
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            font: `400 10px/1 ${MONO}`,
            letterSpacing: "0.07em",
            color: "var(--c-oninv-gold)",
          }}
        >
          {eyebrow}
        </span>
        <span
          style={{
            display: "block",
            marginTop: "7px",
            font: `500 15px/1.35 ${PLAYFAIR}`,
            color: "var(--c-oninv-strong)",
          }}
        >
          {line}
        </span>
      </span>
      <svg
        style={{ flex: "none" }}
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--c-oninv-gold)"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M4 12h15M13 6l6 6-6 6" />
      </svg>
    </button>
  );
}

function TailLink({ label, href, onClick }: { label: string; href?: string; onClick?: () => void }) {
  const style = {
    marginTop: "10px",
    minHeight: "44px",
    display: "flex",
    alignItems: "center",
    font: "600 12px/1 Inter, sans-serif",
    color: "var(--c-goldink)",
    textDecoration: "none",
  } as const;
  if (href) {
    return (
      <Link href={href} style={style}>
        {label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={ledger.bare} style={style}>
      {label}
    </button>
  );
}

function StoryLens({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={ledger.bare}
      style={{
        minHeight: "44px",
        display: "flex",
        alignItems: "center",
        padding: "0 13px",
        borderRadius: "6px",
        font: `${on ? 600 : 500} 12px/1 Inter, sans-serif`,
        border: `1px solid ${on ? "var(--c-ink)" : "var(--c-border)"}`,
        color: on ? "var(--c-ink)" : "var(--c-secondary)",
        backgroundColor: on ? "var(--c-surface)" : "transparent",
      }}
    >
      {label}
    </button>
  );
}

function StoryRow({ story, last }: { story: DashStory; last: boolean }) {
  return (
    <button
      type="button"
      /* TODO: open the Story reader once step 10 lands. Not built here. */
      onClick={() => {}}
      className={ledger.bare}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        padding: "12px 0",
        borderTop: "1px solid var(--c-hair)",
        borderBottom: last ? "1px solid var(--c-hair)" : undefined,
        textAlign: "left",
      }}
    >
      {/* The unread rule. An element, not a border: a coloured left border is
          forbidden and the runtime audit flags one. Radius 4, not the design's
          99, which is off the scale and renders identically on a 3px box. */}
      <span
        aria-hidden="true"
        style={{
          flex: "none",
          width: "3px",
          alignSelf: "stretch",
          borderRadius: "4px",
          backgroundColor: story.unread ? "var(--c-gold)" : "transparent",
        }}
      />
      <span
        style={{
          flex: "none",
          width: "22px",
          textAlign: "right",
          font: `800 22px/1 ${PLAYFAIR}`,
          color: "var(--c-number)",
        }}
      >
        {story.ordinal}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "3px",
            lineHeight: 1.35,
          }}
        >
          <SentimentPill tone={story.tone} label={story.toneLabel} size="md" />
          <span
            style={{
              flex: "none",
              font: "600 10px/1.4 Inter, sans-serif",
              padding: "2px 6px",
              borderRadius: "4px",
              backgroundColor: "var(--c-surface)",
              color: "var(--c-secondary)",
            }}
          >
            {story.sector}
          </span>
          <span style={{ font: "400 10px/1 Inter, sans-serif", color: "var(--c-muted)" }}>
            {story.source}
          </span>
          <span
            style={{
              marginLeft: "auto",
              font: "400 10px/1 Inter, sans-serif",
              color: "var(--c-muted)",
            }}
          >
            {story.age}
          </span>
        </span>
        <span
          style={{
            display: "block",
            font: `700 14px/1.34 ${PLAYFAIR}`,
            color: "var(--c-ink)",
            textWrap: "pretty",
          }}
        >
          {story.headline}
        </span>
      </span>
    </button>
  );
}

/* ── lifecycle ──────────────────────────────────────────────────────── */

/** A section that has nothing in it says so in its own words. */
function Absence({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ marginTop: "12px" }}>
      <p style={{ margin: 0, font: `500 15px/1.35 ${PLAYFAIR}`, color: "var(--c-ink)" }}>{title}</p>
      <p
        style={{
          margin: "6px 0 0",
          font: "400 11.5px/1.5 Inter, sans-serif",
          color: "var(--c-muted)",
          maxWidth: "34ch",
          textWrap: "pretty",
        }}
      >
        {body}
      </p>
    </div>
  );
}

function StaleNotice({ text }: { text: string }) {
  return (
    <div
      style={{
        marginTop: "14px",
        border: "1px solid var(--c-amber-edge)",
        backgroundColor: "var(--c-amber-well)",
        borderRadius: "12px",
        padding: "13px 14px",
      }}
    >
      <div style={{ font: "600 12px/1 Inter, sans-serif", color: "var(--c-ink)" }}>
        You are reading yesterday&rsquo;s briefing.
      </div>
      <div style={{ marginTop: "4px", font: "400 11.5px/1.5 Inter, sans-serif", color: "var(--c-body)" }}>
        {text}
      </div>
    </div>
  );
}

/**
 * One page-level pass, not fourteen per-widget pulses.
 *
 * The desk resolves each widget on its own clock, so the dashboard settles in
 * pieces. The design replaces all of it with a single skeleton in the shape of
 * the real screen, closing on a line that states what is being waited on.
 */
function DashSkeleton() {
  return (
    <div style={{ padding: `0 ${PAD} 26px` }} aria-busy="true" aria-label="Reading overnight coverage">
      <div style={{ display: "flex", alignItems: "center", gap: "11px" }}>
        <span className={ledger.sk} style={{ width: "118px", height: "13px" }} />
        <span style={{ flex: 1, height: "1px", backgroundColor: "var(--c-border)" }} />
      </div>
      <div className={ledger.sk} style={{ marginTop: "18px", width: "132px", height: "13px" }} />
      <div className={ledger.sk} style={{ marginTop: "12px", width: "74%", height: "28px" }} />
      <div className={ledger.sk} style={{ marginTop: "12px", width: "60%", height: "13px" }} />
      <div
        style={{
          marginTop: "26px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "22px 0",
        }}
      >
        {[
          [56, 88],
          [40, 70],
          [66, 78],
          [80, 54],
        ].map(([label, value]) => (
          <div key={`${label}-${value}`}>
            <div className={ledger.sk} style={{ width: `${label}px`, height: "10px" }} />
            <div className={ledger.sk} style={{ marginTop: "9px", width: `${value}px`, height: "22px" }} />
          </div>
        ))}
      </div>
      <div className={ledger.sk} style={{ marginTop: "30px", width: "100%", height: "60px", borderRadius: "12px" }} />
      <div className={ledger.sk} style={{ marginTop: "10px", width: "100%", height: "56px", borderRadius: "12px" }} />
      <div style={{ marginTop: "26px", display: "flex", alignItems: "center", gap: "11px" }}>
        <span className={ledger.sk} style={{ width: "86px", height: "12px" }} />
        <span style={{ flex: 1, height: "1px", backgroundColor: "var(--c-border)" }} />
      </div>
      <div className={ledger.sk} style={{ marginTop: "14px", width: "100%", height: "52px" }} />
      <p
        style={{
          margin: "20px 0 0",
          font: `400 11px/1.5 ${MONO}`,
          letterSpacing: "0.07em",
          color: "var(--c-muted)",
          textAlign: "center",
        }}
      >
        READING OVERNIGHT COVERAGE
      </p>
    </div>
  );
}

/**
 * A failed read is not an empty briefing, and the copy says so in both
 * directions. The design has no dashStage:'error' at all; the desk has three
 * separate per-section absences instead, none of which can say the page
 * failed. On a product whose claim is that nothing is curated away, a failed
 * read that reads as an empty one is a trust failure, so the screen states it.
 */
function DashError() {
  return (
    <div style={{ padding: `18px ${PAD} 26px` }} role="alert">
      <p style={{ margin: 0, font: `500 17px/1.4 ${PLAYFAIR}`, color: "var(--c-ink)" }}>
        We could not load your briefing.
      </p>
      <p
        style={{
          margin: "10px 0 0",
          font: "400 13px/1.6 Inter, sans-serif",
          color: "var(--c-secondary)",
          maxWidth: "34ch",
          textWrap: "pretty",
        }}
      >
        This is a failed read, not an empty morning. Nothing is being hidden, and your open calls
        are unaffected.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className={ledger.bare}
        style={{
          marginTop: "14px",
          minHeight: "44px",
          display: "inline-flex",
          alignItems: "center",
          padding: "0 17px",
          border: "1px solid var(--c-ink)",
          borderRadius: "9px",
          font: "600 13px/1 Inter, sans-serif",
          color: "var(--c-ink)",
        }}
      >
        Try again
      </button>
    </div>
  );
}

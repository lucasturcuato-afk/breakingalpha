"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import styles from "@/components/mobile/mobile.module.css";
import {
  EASE,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_SANS,
  SectionRule,
  Wordmark,
  delay,
} from "@/components/mobile/primitives";

/* ══════════════════════════════════════════════════════════════════════
   Landing, mobile. Prototype flag `isLanding`.
   ══════════════════════════════════════════════════════════════════════
   Built at 390px from Signalera Mobile v3.dc.html lines 1085 to 1274,
   read with getComputedStyle rather than from the README's transcription
   of it. Sits beside the desktop landing under a `md:hidden` gate; the
   desktop tree is unchanged apart from the three compliance rulings.

   NOT PORTED, deliberately, per github.md: the IntroGate signal wall
   (four scrolling columns of ambient cards) and the MarketReadSection
   live feed. Both are ambient desktop-scale devices, and dropping the
   second is also what keeps the removed aggregate figure off the mobile
   landing.

   The waitlist sheet is NOT rebuilt here. `WaitlistModal` already
   carries a focus trap, Escape handling, a body scroll lock, focus
   restore, and a sub-560px bottom-sheet treatment in landing.module.css.
   The mobile landing opens that component. See the PR body for the
   deltas between it and the drawn sheet.
   ══════════════════════════════════════════════════════════════════════ */

const TYPED = "We track which calls the evidence supports.";

/* Loop demo. The three scenes and the five rail labels are the desktop
 * LoopSection's own, verbatim, so the two surfaces cannot drift apart. */
type LoopResult = "supported" | "challenged" | "developing" | "awaiting";

const LOOP: { who: string; claim: string; result: LoopResult; attr: string }[] = [
  {
    who: "YOU",
    claim: "AI infrastructure keeps drawing capital toward the names you follow.",
    result: "supported",
    attr: "Three of four followed names drew fresh capital this week. The read is clean.",
  },
  {
    who: "YOU",
    claim: "Commercial real estate stress eases as refinancing picks up.",
    result: "challenged",
    attr: "Vacancy printed new highs and refinancing slowed. The evidence runs the other way. Kept on the record.",
  },
  {
    who: "SIGNALERA",
    claim: "Chip supply tightens toward the suppliers you track.",
    result: "developing",
    attr: "Two confirming developments so far. Below the bar to call it. Awaiting the next data point.",
  },
];

const LOOP_LABELS = ["CALLED", "REVIEW DATE", "EVIDENCE", "VERDICT", "SHARPER BRIEF"];

const LOOP_STAGE = [
  "waiting for evidence",
  "review date set",
  "weighing the evidence",
  "verdict on the record",
  "fed into tomorrow's brief",
];

/* The loop card is a PINNED espresso surface, so the outcome semantics
 * read from the pinned --c-inv-* tokens rather than from the ink tokens.
 * The ink tokens are light-theme values and measure 2.86 to 3.76:1 on
 * espresso; a themed token would also invert with the page while the
 * card underneath it did not. */
const LOOP_CHIP: Record<LoopResult, { label: string; color: string; edge: string }> = {
  awaiting: { label: "AWAITING", color: "var(--c-inv-amber)", edge: "var(--c-inv-amber-edge)" },
  developing: { label: "DEVELOPING", color: "var(--c-inv-amber)", edge: "var(--c-inv-amber-edge)" },
  supported: { label: "SUPPORTED", color: "var(--c-inv-green)", edge: "var(--c-inv-green-edge)" },
  challenged: { label: "CHALLENGED", color: "var(--c-inv-red)", edge: "var(--c-inv-red-edge)" },
};

const BEATS: { date: string; head: string; body: string; dot: string; last?: boolean }[] = [
  {
    date: "01 // TUE JUN 3 · 07:02 ET",
    head: "You read. One line earns a tap.",
    body: "Every claim in the brief is trackable. Tap one and Signalera restates it as a falsifiable thesis with a review date and the evidence that would settle it. Or write your own: calls you type into Radar are logged and graded exactly the same way as ours.",
    dot: "var(--c-gold)",
  },
  {
    date: "02 // WED JUN 4 · 06:55 ET",
    head: "Tomorrow’s brief already knows.",
    body: "You did not configure anything. Tracking is the configuration. The ripple reaches every surface overnight.",
    dot: "var(--c-gold)",
  },
  {
    date: "03 // THU JUN 19 · 08:40 ET",
    head: "The evidence arrives. It cuts against the thesis.",
    body: "Signalera marks the thesis challenged, in plain sight. The misses stay on the record, because a record with no misses is marketing.",
    dot: "var(--c-red)",
  },
  {
    date: "04 // FRI JUN 20 · 06:55 ET",
    head: "The record updates. Permanently.",
    body: "Every resolved call lands in a ledger you can audit. The count moves, both ways.",
    dot: "var(--c-gold)",
  },
  {
    date: "05 // TUE JUL 1 · WEEK FOUR",
    head: "The brief is sharper because a call it tracked did not survive.",
    body: "Week four beats week one because it has accumulated how you think, not what you clicked. That is the thing a free summary cannot do.",
    dot: "var(--c-green)",
    last: true,
  },
];

const SURFACES: { name: string; blurb: string }[] = [
  { name: "MORNING BRIEF", blurb: "The day’s read before the open, built around the names you follow." },
  { name: "EVENING WRAP", blurb: "What moved at the close, and what resolved on the record." },
  { name: "LIVE FEED", blurb: "Market-moving news, filtered and scored as it breaks." },
  { name: "RADAR · FOLLOWING", blurb: "The themes you track, with each week’s developments." },
  { name: "WATCHLIST & CALLS", blurb: "Your names and your graded calls, kept in one place." },
  { name: "DEAL FLOW", blurb: "M&A, raises, and IPOs across the names and sectors you track." },
  { name: "COMPANY INTEL", blurb: "Every company in your feed, with the themes and mention volume driving each one." },
  { name: "TRENDS", blurb: "What is accelerating across sectors before it is obvious." },
  { name: "INTELLIGENCE", blurb: "Ask the system what the record shows." },
];

const LEGEND = [
  "it opens with what changed since you last looked. continuity, not a feed.",
  "calls resolve as supported or challenged. the misses stay on the record.",
  "every line exists because of a name you follow or a thesis you track.",
];

/* ── hooks ─────────────────────────────────────────────────────────── */

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/* ── screen ────────────────────────────────────────────────────────── */

export function MobileLanding({
  onSignin,
  onWaitlist,
}: {
  onSignin: () => void;
  onWaitlist: () => void;
}) {
  const reduced = useReducedMotion();
  const seeHowRef = useRef<HTMLDivElement>(null);

  const seeHow = useCallback(() => {
    seeHowRef.current?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "start",
    });
  }, [reduced]);

  return (
    <div className="md:hidden">
      <div
        data-parity="landing"
        className={styles.screen}
        style={{
          minHeight: "100dvh",
          backgroundColor: "var(--c-bg)",
          color: "var(--c-ink)",
        }}
      >
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "4px var(--v3-pad) 10px",
            backgroundColor: "var(--c-bg)",
          }}
        >
          <span className={styles.rise}>
            <Wordmark size={19} />
          </span>
          <button
            type="button"
            onClick={onSignin}
            className={`${styles.reset} ${styles.rise}`}
            style={{
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              padding: "0 4px",
              fontFamily: FONT_SANS,
              fontSize: 13,
              fontWeight: 500,
              lineHeight: 1,
              color: "var(--c-secondary)",
            }}
          >
            Sign in
          </button>
        </header>

        <div style={{ padding: "0 var(--v3-pad) 20px" }}>
          <Hero
            reduced={reduced}
            onWaitlist={onWaitlist}
            onSeeHow={seeHow}
          />

          <div ref={seeHowRef}>
            <SectionRule label="THE LOOP" />
          </div>
          <LoopCard reduced={reduced} />

          <SectionRule label="THE LIFE OF ONE THESIS" />
          <div
            style={{
              marginTop: 8,
              fontFamily: FONT_MONO,
              fontSize: 10,
              lineHeight: 1,
              color: "var(--c-muted)",
            }}
          >
            four weeks · five moments · one ripple
          </div>
          <Timeline />

          <SectionRule label="THE PROOF // TWENTY-THREE DAYS APART" />
          <Proof />

          <SectionRule label="NINE SURFACES" />
          <Surfaces />

          <UniversityCard />
          <WaitlistBlock onWaitlist={onWaitlist} />
          <Footer />
        </div>
      </div>
    </div>
  );
}

/* ── hero ──────────────────────────────────────────────────────────── */

function Hero({
  reduced,
  onWaitlist,
  onSeeHow,
}: {
  reduced: boolean;
  onWaitlist: () => void;
  onSeeHow: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [cursorOn, setCursorOn] = useState(true);

  // 42ms per character after a 700ms delay, cursor dropped 2400ms after the
  // line completes. Reduced motion writes the final string on the first
  // frame and never shows the cursor at all.
  useEffect(() => {
    if (reduced) {
      setTyped(TYPED);
      setCursorOn(false);
      return;
    }
    setTyped("");
    setCursorOn(true);
    let iv: ReturnType<typeof setInterval> | undefined;
    let drop: ReturnType<typeof setTimeout> | undefined;
    let n = 0;
    const start = setTimeout(() => {
      iv = setInterval(() => {
        n += 1;
        setTyped(TYPED.slice(0, n));
        if (n >= TYPED.length) {
          clearInterval(iv);
          drop = setTimeout(() => setCursorOn(false), 2400);
        }
      }, 42);
    }, 700);
    return () => {
      clearTimeout(start);
      clearInterval(iv);
      clearTimeout(drop);
    };
  }, [reduced]);

  return (
    <>
      <div
        className={styles.rise}
        style={{
          ...delay(60),
          paddingTop: 18,
          fontFamily: FONT_MONO,
          fontSize: 11,
          fontWeight: 400,
          lineHeight: 1,
          letterSpacing: "0.16em",
          color: "var(--c-goldink)",
        }}
      >
        AI-NATIVE MARKET INTELLIGENCE
      </div>

      <h1 style={{ margin: "18px 0 0", fontWeight: 500, color: "var(--c-ink)" }}>
        <span
          className={styles.rise}
          style={{
            ...delay(120),
            display: "block",
            marginBottom: 14,
            fontFamily: FONT_DISPLAY,
            fontStyle: "italic",
            fontSize: 17,
            fontWeight: 400,
            lineHeight: 1.4,
            letterSpacing: "-0.005em",
          }}
        >
          Anyone can summarize the market.
        </span>
        <span
          className={styles.rise}
          style={{
            ...delay(200),
            display: "block",
            minHeight: "1.1em",
            fontFamily: FONT_DISPLAY,
            fontSize: 38,
            fontWeight: 500,
            lineHeight: 1.06,
            letterSpacing: "-0.02em",
          }}
        >
          <span>{typed}</span>
          {cursorOn && <span aria-hidden="true" className={styles.cursor} />}
        </span>
      </h1>

      <p
        className={styles.rise}
        style={{
          ...delay(320),
          margin: "20px 0 8px",
          fontFamily: FONT_SANS,
          fontSize: 15,
          fontWeight: 400,
          lineHeight: 1.6,
          color: "var(--c-secondary)",
          textWrap: "pretty",
        }}
      >
        A generic market summary is a commodity. An honest, graded record is not.
        Signalera grades every call against the evidence, including the calls the
        evidence ran against, and gets sharper the longer you use it.
      </p>

      <p
        className={styles.rise}
        style={{
          ...delay(360),
          margin: "0 0 22px",
          fontFamily: FONT_MONO,
          fontSize: 11,
          fontWeight: 400,
          lineHeight: 1.5,
          letterSpacing: "0.06em",
          color: "var(--c-muted)",
        }}
      >
        Informational only. Never advice.
      </p>

      <div
        className={styles.rise}
        style={{ ...delay(400), display: "flex", flexDirection: "column", gap: 9 }}
      >
        <button
          type="button"
          onClick={onWaitlist}
          className={styles.reset}
          style={{
            minHeight: 52,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 4,
            backgroundColor: "var(--c-gold)",
            fontFamily: FONT_SANS,
            fontSize: 15,
            fontWeight: 500,
            lineHeight: 1,
            color: "var(--c-ongold)",
          }}
        >
          Join the waitlist
        </button>
        <button
          type="button"
          onClick={onSeeHow}
          className={styles.reset}
          style={{
            minHeight: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            border: "1px solid var(--c-border)",
            borderRadius: 4,
            fontFamily: FONT_MONO,
            fontSize: 11,
            fontWeight: 400,
            lineHeight: 1,
            letterSpacing: "0.08em",
            color: "var(--c-ink)",
          }}
        >
          SEE HOW IT WORKS {"↓"}
        </button>
      </div>

      <div
        className={styles.rise}
        style={{ ...delay(460), marginTop: 14, display: "flex", justifyContent: "center" }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "8px 12px",
            border: "1px dashed var(--c-border)",
            borderRadius: 4,
            fontFamily: FONT_MONO,
            fontSize: 10,
            fontWeight: 400,
            lineHeight: 1.4,
            letterSpacing: "0.05em",
            color: "var(--c-muted)",
          }}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          free trial · invite-only during early access
        </span>
      </div>
    </>
  );
}

/* ── loop demo ─────────────────────────────────────────────────────── */

function LoopCard({ reduced }: { reduced: boolean }) {
  const [scene, setScene] = useState(0);
  const [lit, setLit] = useState(0);

  useEffect(() => {
    if (reduced) {
      setLit(4);
      return;
    }
    setLit(0);
    const t: ReturnType<typeof setTimeout>[] = [
      setTimeout(() => setLit(1), 800),
      setTimeout(() => setLit(2), 1700),
      setTimeout(() => setLit(3), 3300),
      setTimeout(() => setLit(4), 4100),
      setTimeout(() => setScene((p) => (p + 1) % LOOP.length), 6300),
    ];
    return () => t.forEach(clearTimeout);
  }, [reduced, scene]);

  const s = LOOP[scene];
  const chipKey: LoopResult = lit >= 3 ? s.result : lit >= 2 ? "developing" : "awaiting";
  const chip = LOOP_CHIP[chipKey];

  return (
    <>
      <div
        style={{
          marginTop: 12,
          fontFamily: FONT_DISPLAY,
          fontSize: 24,
          fontWeight: 500,
          lineHeight: 1.15,
          letterSpacing: "-0.02em",
          color: "var(--c-ink)",
          textWrap: "pretty",
        }}
      >
        Make a call. Watch it resolve.
      </div>

      <div
        className={styles.rise}
        style={{
          ...delay(60),
          marginTop: 18,
          padding: "18px 16px 16px",
          border: "1px solid var(--c-border)",
          borderRadius: 12,
          backgroundColor: "var(--c-inverse)",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              fontFamily: FONT_MONO,
              fontSize: 10,
              fontWeight: 400,
              lineHeight: 1,
              letterSpacing: "0.16em",
              color: "var(--c-oninv-dim)",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: "var(--c-inv-gold)",
              }}
            >
              <span
                className={styles.pulseDot}
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  backgroundColor: "var(--c-gold)",
                }}
              />
              LIVE
            </span>
            A CALL, IN REVIEW
          </span>
        </div>

        {/* five-node rail */}
        <div style={{ position: "relative", marginBottom: 20 }}>
          <div
            style={{
              position: "absolute",
              left: "10%",
              right: "10%",
              top: 9,
              height: 2,
              backgroundColor: "var(--c-inverse-border)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: "10%",
              top: 9,
              height: 2,
              width: `${lit * 20}%`,
              backgroundColor: "var(--c-gold)",
              transition: reduced ? "none" : `width 700ms ${EASE}`,
            }}
          />
          <div
            style={{ display: "flex", justifyContent: "space-between", position: "relative" }}
          >
            {LOOP_LABELS.map((label, i) => {
              const on = i <= lit;
              const active = i === lit;
              return (
                <div
                  key={label}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 7,
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      backgroundColor: "var(--c-inverse)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: `2px solid ${on ? "var(--c-gold)" : "var(--c-inverse-border)"}`,
                      transform: active ? "scale(1.14)" : undefined,
                      boxShadow: active ? "0 0 0 5px rgba(212,168,75,0.14)" : undefined,
                      transition: reduced ? "none" : `all 380ms ${EASE}`,
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        backgroundColor: on ? "var(--c-gold)" : "var(--c-oninv-dim)",
                        transition: reduced ? "none" : `background-color 380ms ${EASE}`,
                      }}
                    />
                  </span>
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 10,
                      fontWeight: 400,
                      lineHeight: 1,
                      letterSpacing: "0.06em",
                      textAlign: "center",
                      color: on ? "var(--c-oninv-strong)" : "var(--c-oninv-dim)",
                      transition: reduced ? "none" : `color 380ms ${EASE}`,
                    }}
                  >
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ minHeight: 104 }}>
          <span
            style={{
              display: "block",
              marginBottom: 8,
              fontFamily: FONT_MONO,
              fontSize: 10,
              fontWeight: 400,
              lineHeight: 1,
              letterSpacing: "0.1em",
              color: "var(--c-inv-gold)",
            }}
          >
            {s.who}
          </span>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 19,
              fontWeight: 400,
              lineHeight: 1.25,
              color: "var(--c-oninv-strong)",
            }}
          >
            {s.claim}
          </div>
        </div>

        <div
          style={{
            marginTop: 14,
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            minHeight: 24,
          }}
        >
          {/* A state word and its colour must change on the same frame. The
              four outcome words are non-interchangeable, so easing between
              two semantic hues renders one state's word in another state's
              colour. transition:none is deliberate. */}
          <span
            style={{
              padding: "4px 11px",
              borderRadius: 4,
              fontFamily: FONT_MONO,
              fontSize: 10,
              fontWeight: 500,
              lineHeight: 1,
              letterSpacing: "0.12em",
              transition: "none",
              color: chip.color,
              border: `1px solid ${chip.edge}`,
            }}
          >
            {chip.label}
          </span>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10.5,
              fontWeight: 400,
              lineHeight: 1,
              color: "var(--c-oninv-dim)",
            }}
          >
            {LOOP_STAGE[lit]}
          </span>
        </div>

        <p
          style={{
            margin: "12px 0 0",
            minHeight: 40,
            fontFamily: FONT_MONO,
            fontSize: 11.5,
            fontWeight: 400,
            lineHeight: 1.6,
            color: "var(--c-oninv-body)",
          }}
        >
          {lit >= 3 ? s.attr : ""}
        </p>

        <div
          style={{
            marginTop: 12,
            display: "flex",
            alignItems: "center",
            gap: 9,
            opacity: lit >= 4 ? 1 : 0,
            transition: reduced ? "none" : `opacity 380ms ${EASE}`,
          }}
        >
          <span
            style={{
              flex: "none",
              width: 17,
              height: 17,
              borderRadius: "50%",
              backgroundColor: "var(--c-gold)",
              color: "var(--c-ongold)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: FONT_SANS,
              fontSize: 11,
              fontWeight: 500,
              lineHeight: 1,
            }}
          >
            {"✓"}
          </span>
          <span
            style={{
              fontFamily: FONT_SANS,
              fontSize: 12.5,
              fontWeight: 400,
              lineHeight: 1.5,
              color: "var(--c-oninv-body)",
            }}
          >
            Tomorrow{"’"}s brief accumulates how you think, not what you clicked.
          </span>
        </div>
      </div>

      <p
        style={{
          margin: "14px 0 0",
          fontFamily: FONT_MONO,
          fontSize: 10.5,
          fontWeight: 400,
          lineHeight: 1.5,
          textAlign: "center",
          color: "var(--c-muted)",
        }}
      >
        When a move cannot be credited to the reasoning, we say so.
      </p>
    </>
  );
}

/* ── timeline ──────────────────────────────────────────────────────── */

function Timeline() {
  return (
    <div className={styles.rise} style={{ ...delay(60), marginTop: 6 }}>
      {BEATS.map((b) => (
        <div key={b.date} style={{ display: "flex", gap: 14, paddingTop: 18 }}>
          <div
            style={{
              flex: "none",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              paddingTop: 4,
            }}
          >
            <span
              style={{
                flex: "none",
                width: 11,
                height: 11,
                borderRadius: "50%",
                backgroundColor: b.dot,
              }}
            />
            {!b.last && (
              <span
                style={{
                  width: 2,
                  flex: 1,
                  marginTop: 6,
                  backgroundColor: "var(--c-hair)",
                }}
              />
            )}
          </div>
          <div style={{ minWidth: 0, flex: 1, paddingBottom: b.last ? 4 : 20 }}>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                fontWeight: 400,
                lineHeight: 1,
                letterSpacing: "0.1em",
                color: "var(--c-goldink)",
              }}
            >
              {b.date}
            </div>
            <div
              style={{
                marginTop: 8,
                fontFamily: FONT_DISPLAY,
                fontSize: 17,
                fontWeight: 500,
                lineHeight: 1.3,
                letterSpacing: "-0.01em",
                color: "var(--c-ink)",
                textWrap: "pretty",
              }}
            >
              {b.head}
            </div>
            <p
              style={{
                margin: "8px 0 0",
                fontFamily: FONT_SANS,
                fontSize: 12.5,
                fontWeight: 400,
                lineHeight: 1.6,
                color: "var(--c-secondary)",
                textWrap: "pretty",
              }}
            >
              {b.body}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── proof ─────────────────────────────────────────────────────────── */

function Proof() {
  const [week, setWeek] = useState<1 | 4>(4);
  const w4 = week === 4;

  const tab = (on: boolean) => ({
    minHeight: 44,
    display: "flex",
    alignItems: "center",
    padding: "0 13px",
    borderRadius: 4,
    fontFamily: FONT_MONO,
    fontSize: 10,
    fontWeight: 400,
    lineHeight: 1,
    letterSpacing: "0.1em",
    border: `1px solid ${on ? "var(--c-inverse)" : "var(--c-border)"}`,
    backgroundColor: on ? "var(--c-inverse)" : "transparent",
    color: on ? "var(--c-oninv)" : "var(--c-secondary)",
  });

  const row = {
    padding: "12px 16px",
    borderBottom: "1px solid var(--c-hair)",
    fontFamily: FONT_SANS,
    fontSize: 13,
    fontWeight: 400,
    lineHeight: 1.6,
    color: "var(--c-secondary)",
  } as const;

  const foot = {
    padding: "11px 16px",
    fontFamily: FONT_MONO,
    fontSize: 10,
    fontWeight: 400,
    lineHeight: 1.5,
    color: "var(--c-muted)",
  } as const;

  return (
    <>
      <div
        style={{
          marginTop: 12,
          fontFamily: FONT_DISPLAY,
          fontSize: 24,
          fontWeight: 500,
          lineHeight: 1.15,
          letterSpacing: "-0.02em",
          color: "var(--c-ink)",
          textWrap: "pretty",
        }}
      >
        The same brief, week one and week four.
      </div>
      <div
        style={{
          marginTop: 10,
          fontFamily: FONT_MONO,
          fontSize: 10,
          fontWeight: 400,
          lineHeight: 1,
          color: "var(--c-muted)",
        }}
      >
        {w4 ? "day 24 · it knows you now" : "day 1 · accurate and anonymous"}
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 6 }}>
        <button
          type="button"
          onClick={() => setWeek(1)}
          className={styles.reset}
          aria-pressed={!w4}
          style={tab(!w4)}
        >
          WEEK ONE · JUN 8
        </button>
        <button
          type="button"
          onClick={() => setWeek(4)}
          className={styles.reset}
          aria-pressed={w4}
          style={tab(w4)}
        >
          WEEK FOUR · JUL 2
        </button>
      </div>

      <div
        className={styles.rise}
        style={{
          ...delay(60),
          marginTop: 14,
          border: "1px solid var(--c-border)",
          borderRadius: 12,
          backgroundColor: "var(--c-card)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--c-border)",
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 11.5,
              fontWeight: 500,
              lineHeight: 1,
              letterSpacing: "0.08em",
              color: "var(--c-ink)",
            }}
          >
            MORNING BRIEF
          </span>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              fontWeight: 400,
              lineHeight: 1,
              color: "var(--c-muted)",
            }}
          >
            {w4 ? "THU JUL 2 · 06:55 ET · day 24" : "MON JUN 8 · 06:55 ET · day 1"}
          </span>
        </div>

        {!w4 && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={row}>
              Markets advancing into the open. Futures firm, breadth 3:1, vix at 13.8.
            </div>
            <div style={row}>
              Fed minutes land at 14:00 ET. Rates desks positioned for no surprise.
            </div>
            <div style={row}>8 stories worth your attention this morning.</div>
            <div style={foot}>
              personalization: none yet · open theses: 0 · accurate, but it could be
              anyone{"’"}s brief
            </div>
          </div>
        )}

        {w4 && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                padding: "13px 16px",
                borderBottom: "1px solid var(--c-border)",
                backgroundColor: "var(--c-well)",
              }}
            >
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  fontWeight: 400,
                  lineHeight: 1,
                  letterSpacing: "0.12em",
                  color: "var(--c-goldink)",
                }}
              >
                SINCE YOU LAST LOOKED · 2 CHANGES
              </div>
              <p
                style={{
                  margin: "7px 0 0",
                  fontFamily: FONT_SANS,
                  fontSize: 13,
                  fontWeight: 400,
                  lineHeight: 1.6,
                  color: "var(--c-body)",
                }}
              >
                The freight thesis you track moved to{" "}
                <span style={{ color: "var(--c-redink)", fontWeight: 500 }}>challenged</span>.
                Transpacific spot +18% over three weeks.
              </p>
              <p
                style={{
                  margin: "5px 0 0",
                  fontFamily: FONT_SANS,
                  fontSize: 13,
                  fontWeight: 400,
                  lineHeight: 1.6,
                  color: "var(--c-body)",
                }}
              >
                Semicap evidence moved from 2 of 5 to{" "}
                <span style={{ color: "var(--c-greenink)", fontWeight: 500 }}>4 of 5</span>{" "}
                supported checks.
              </p>
            </div>
            <ProofName
              ticker="NVDA"
              body="Supplier commentary overnight cuts against the shortage thesis you are tracking. Review flagged for today."
            />
            <ProofName
              ticker="JPM"
              body="Second confirming NII datapoint this month for the rate-sensitivity thesis you follow. Marked supported at the review."
            />
            <div style={foot}>
              built on 23 days of your reasoning · 7 open theses · 5 resolved
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {LEGEND.map((line, i) => (
          <div key={line} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span
              style={{
                flex: "none",
                width: 20,
                height: 20,
                borderRadius: "50%",
                border: "1px solid var(--c-gold)",
                color: "var(--c-goldink)",
                fontFamily: FONT_MONO,
                fontSize: 10,
                fontWeight: 400,
                lineHeight: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {i + 1}
            </span>
            <p
              style={{
                margin: 0,
                fontFamily: FONT_SANS,
                fontSize: 11.5,
                fontWeight: 400,
                lineHeight: 1.6,
                color: "var(--c-secondary)",
                textWrap: "pretty",
              }}
            >
              {line}
            </p>
          </div>
        ))}
        <p
          style={{
            margin: "4px 0 0",
            paddingTop: 12,
            borderTop: "1px solid var(--c-border)",
            fontFamily: FONT_MONO,
            fontSize: 10,
            fontWeight: 400,
            lineHeight: 1.6,
            color: "var(--c-muted)",
          }}
        >
          for working analysts, IB and PE recruits, and finance students. broad by design.
        </p>
      </div>
    </>
  );
}

function ProofName({ ticker, body }: { ticker: string; body: string }) {
  return (
    <div
      style={{
        padding: "13px 16px",
        borderBottom: "1px solid var(--c-hair)",
        display: "flex",
        gap: 11,
        alignItems: "flex-start",
      }}
    >
      <span
        style={{
          flex: "none",
          width: 42,
          fontFamily: FONT_MONO,
          fontSize: 11,
          fontWeight: 500,
          lineHeight: 1,
          letterSpacing: "0.04em",
          color: "var(--c-ink)",
        }}
      >
        {ticker}
      </span>
      <p
        style={{
          margin: 0,
          minWidth: 0,
          flex: 1,
          fontFamily: FONT_SANS,
          fontSize: 12.5,
          fontWeight: 400,
          lineHeight: 1.55,
          color: "var(--c-secondary)",
        }}
      >
        {body}
      </p>
    </div>
  );
}

/* ── nine surfaces ─────────────────────────────────────────────────── */

/* The design draws each row against a 1px vertical rule at its left
 * inset, and draws it as a left border. That is one of the four
 * treatments the standing brief forbids, and both gates flag it. The
 * rule survives as a sibling element instead: same 1px, same token, same
 * position, no border on any leading edge. This is the anatomy the
 * design's own timeline already uses for its spine. */
function Surfaces() {
  return (
    <>
      <p
        style={{
          margin: "12px 0 0",
          fontFamily: FONT_SANS,
          fontSize: 12.5,
          fontWeight: 400,
          lineHeight: 1.6,
          color: "var(--c-secondary)",
          textWrap: "pretty",
        }}
      >
        Nine surfaces, one record. Every one of them reads from the calls you have
        taken.
      </p>
      <div
        className={styles.rise}
        style={{
          ...delay(60),
          marginTop: 16,
          display: "flex",
          flexDirection: "column",
          gap: 15,
        }}
      >
        {SURFACES.map((s) => (
          <div key={s.name} style={{ display: "flex", gap: 16 }}>
            <span
              aria-hidden="true"
              style={{ flex: "none", width: 1, backgroundColor: "var(--c-border)" }}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  fontWeight: 400,
                  lineHeight: 1,
                  letterSpacing: "0.12em",
                  color: "var(--c-goldink)",
                }}
              >
                {s.name}
              </div>
              <p
                style={{
                  margin: "5px 0 0",
                  fontFamily: FONT_SANS,
                  fontSize: 12,
                  fontWeight: 400,
                  lineHeight: 1.55,
                  color: "var(--c-secondary)",
                  textWrap: "pretty",
                }}
              >
                {s.blurb}
              </p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ── university partners ───────────────────────────────────────────── */

function UniversityCard() {
  return (
    <div
      className={styles.rise}
      style={{
        ...delay(60),
        marginTop: 34,
        padding: "18px 17px",
        border: "1px solid var(--c-gold-edge)",
        borderRadius: 12,
        backgroundColor: "var(--c-card)",
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          fontWeight: 400,
          lineHeight: 1,
          letterSpacing: "0.14em",
          color: "var(--c-goldink)",
        }}
      >
        UNIVERSITY PARTNERS
      </div>
      <div
        style={{
          marginTop: 8,
          fontFamily: FONT_DISPLAY,
          fontSize: 18,
          fontWeight: 500,
          lineHeight: 1.25,
          letterSpacing: "-0.01em",
          color: "var(--c-ink)",
        }}
      >
        Run a finance org or club?
      </div>
      <p
        style={{
          margin: "4px 0 0",
          fontFamily: FONT_SANS,
          fontSize: 12.5,
          fontWeight: 400,
          lineHeight: 1.55,
          color: "var(--c-secondary)",
        }}
      >
        Bring Signalera to your members as an early partner.
      </p>
      <a
        href="mailto:admin@signalera.ai?subject=Signalera%20university%20partnership"
        className={styles.reset}
        style={{
          marginTop: 14,
          minHeight: 46,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid var(--c-gold)",
          borderRadius: 4,
          fontFamily: FONT_MONO,
          fontSize: 11,
          fontWeight: 400,
          lineHeight: 1,
          letterSpacing: "0.08em",
          color: "var(--c-goldink)",
        }}
      >
        CONTACT US
      </a>
    </div>
  );
}

/* ── closing waitlist block ────────────────────────────────────────── */

function WaitlistBlock({ onWaitlist }: { onWaitlist: () => void }) {
  const [email, setEmail] = useState("");

  return (
    <form
      className={styles.rise}
      onSubmit={(e) => {
        e.preventDefault();
        onWaitlist();
      }}
      style={{
        ...delay(60),
        marginTop: 34,
        paddingTop: 26,
        borderTop: "1px solid var(--c-border)",
      }}
    >
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 24,
          fontWeight: 500,
          lineHeight: 1.2,
          letterSpacing: "-0.02em",
          color: "var(--c-ink)",
          textWrap: "pretty",
        }}
      >
        You already make the calls. Start keeping the record.
      </div>
      <div
        style={{
          marginTop: 8,
          fontFamily: FONT_MONO,
          fontSize: 10.5,
          fontWeight: 400,
          lineHeight: 1.6,
          color: "var(--c-muted)",
        }}
      >
        prefer to talk first?{" "}
        <a
          href="mailto:admin@signalera.ai"
          style={{ color: "var(--c-goldink)", textDecoration: "underline" }}
        >
          contact us
        </a>
      </div>
      <label>
        <span className="sr-only">Email address</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          className={styles.field}
          style={{
            marginTop: 14,
            width: "100%",
            minHeight: 50,
            padding: "0 15px",
            border: "1px solid var(--c-border)",
            borderRadius: 4,
            backgroundColor: "var(--c-card)",
            fontFamily: FONT_MONO,
            fontSize: 13,
            fontWeight: 400,
            lineHeight: 1,
            color: "var(--c-ink)",
          }}
        />
      </label>
      <button
        type="submit"
        className={styles.reset}
        style={{
          marginTop: 9,
          width: "100%",
          minHeight: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 4,
          backgroundColor: "var(--c-gold)",
          fontFamily: FONT_SANS,
          fontSize: 14,
          fontWeight: 500,
          lineHeight: 1,
          color: "var(--c-ongold)",
        }}
      >
        Join the waitlist
      </button>
    </form>
  );
}

/* ── footer ────────────────────────────────────────────────────────── */

function Footer() {
  const link = {
    minHeight: 44,
    display: "inline-flex",
    alignItems: "center",
    fontFamily: FONT_MONO,
    fontSize: 10,
    fontWeight: 400,
    lineHeight: 1,
    color: "var(--c-secondary)",
  } as const;

  return (
    <footer
      style={{
        marginTop: 30,
        paddingTop: 18,
        paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))",
        borderTop: "1px solid var(--c-border)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <Wordmark size={16} weight={500} />
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Link href="/legal/terms" style={link}>
          Terms of Service
        </Link>
        <Link href="/legal/privacy" style={link}>
          Privacy Policy
        </Link>
        <a
          href="mailto:admin@signalera.ai"
          style={{ ...link, color: "var(--c-goldink)" }}
        >
          Contact
        </a>
      </div>
      <p
        style={{
          margin: 0,
          fontFamily: FONT_MONO,
          fontSize: 10,
          fontWeight: 400,
          lineHeight: 1.6,
          color: "var(--c-muted)",
        }}
      >
        Informational only. Not investment advice. Verify before acting.
      </p>
    </footer>
  );
}

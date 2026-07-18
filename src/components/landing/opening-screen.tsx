"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { WaitlistModal } from "./waitlist-modal";

// ---------------------------------------------------------------------------
// Signalera signed-out landing. Themed + token-driven rebuild of the reference
// scrollytelling page. Styled light by default with `dark:` overrides so it
// tracks the class-based theme provider. Every color is a design token from
// src/styles/tokens.css (no raw hex, no rgba literals). Animations are gated
// behind prefers-reduced-motion.
// ---------------------------------------------------------------------------

type Status = "supported" | "challenged" | "awaiting" | "developing" | "reviewing";

type WallSignal = { tag: string; score: string; text: string };

const WALL: WallSignal[] = [
  { tag: "TECHNOLOGY · M&A", score: "8.4", text: "Activist stake disclosed in mid-cap security vendor" },
  { tag: "MACRO & RATES", score: "9.1", text: "Front-end repricing after soft services print" },
  { tag: "SHIPPING", score: "8.8", text: "Transpacific GRIs stick; spot +18% in three weeks" },
  { tag: "CONSUMER", score: "6.9", text: "Luxury mainland comps print negative again" },
  { tag: "CREDIT", score: "7.0", text: "HY issuance window reopens after a quiet June" },
  { tag: "UTILITIES", score: "8.6", text: "Grid capex supercycle guides raised again" },
  { tag: "HEALTHCARE", score: "7.2", text: "Obesity franchise supply constraints easing" },
  { tag: "SEMIS", score: "9.2", text: "HBM capacity adds pull semicap orders forward" },
  { tag: "FINANCIALS", score: "7.6", text: "Regional bank NII guides drift higher" },
  { tag: "GEOPOLITICS", score: "8.9", text: "Export-control update hits tooling names" },
  { tag: "REAL ESTATE", score: "6.4", text: "CMBS spreads tighten on office refi wave" },
  { tag: "ENERGY", score: "6.8", text: "Refinery cracks widen into driving season" },
  { tag: "M&A", score: "9.0", text: "Mega-merger spread widens on second request" },
  { tag: "RATES", score: "7.4", text: "10y auction tails; dealers absorb the print" },
  { tag: "PRIVATE EQUITY", score: "7.9", text: "Take-private chatter around building products distributor" },
  { tag: "INDUSTRIALS", score: "8.1", text: "Transformer lead times extend past 30 months" },
  { tag: "TECHNOLOGY", score: "8.2", text: "Hyperscaler capex guides move higher in aggregate" },
  { tag: "SHIPPING", score: "7.1", text: "Carriers file August GRIs across the lane" },
  { tag: "MACRO", score: "8.3", text: "Breadth 3:1 into the open, vix 13.8" },
  { tag: "SEMIS", score: "7.8", text: "Toolmaker orders +31% q/q at the two largest" },
];

const WALL_COLUMNS: WallSignal[][] = [
  [WALL[0], WALL[4], WALL[8], WALL[12], WALL[16]],
  [WALL[1], WALL[5], WALL[9], WALL[13], WALL[17]],
  [WALL[2], WALL[6], WALL[10], WALL[14], WALL[18]],
  [WALL[3], WALL[7], WALL[11], WALL[15], WALL[19]],
];
const WALL_ANIM = ["wallScrollA", "wallScrollB", "wallScrollC", "wallScrollD"];
const WALL_DUR = ["34s", "27s", "40s", "31s"];

type DemoScene = {
  who: string;
  claim: string;
  result: Status;
  attrLead: string;
  attrRest: string;
};

const DEMO: DemoScene[] = [
  {
    who: "YOU",
    claim: "AI infrastructure keeps drawing capital toward the names you follow.",
    result: "supported",
    attrLead: "Three of four followed names drew fresh capital this week.",
    attrRest: "The read is clean.",
  },
  {
    who: "YOU",
    claim: "Commercial real estate stress eases as refinancing picks up.",
    result: "challenged",
    attrLead: "Vacancy printed new highs and refinancing slowed.",
    attrRest: "The evidence runs the other way. Kept on the record.",
  },
  {
    who: "SIGNALERA",
    claim: "Chip supply tightens toward the suppliers you track.",
    result: "developing",
    attrLead: "Two confirming developments so far.",
    attrRest: "Below the bar to call it. Awaiting the next data point.",
  },
];

type FeedTemplate = { text: string; status: Status; evidence: string };

const FEED_POOL: FeedTemplate[] = [
  { text: "Regional bank NIM compression bottoms by Q2 as deposit costs peak", status: "supported", evidence: "4 of 5 reporting banks guided NIM stable or higher" },
  { text: "Freight rates stay soft through peak shipping season", status: "challenged", evidence: "transpacific spot rates +18% over three weeks" },
  { text: "Datacenter capex guides move higher across hyperscalers", status: "supported", evidence: "4 of 4 guides raised; aggregate capex +22% y/y" },
  { text: "Homebuilder gross margins hold as rate buydowns taper", status: "awaiting", evidence: "reviews on july starts and incentive data" },
  { text: "Grid equipment backlogs extend past 2027", status: "supported", evidence: "three transformer makers cite 30+ month lead times" },
  { text: "Luxury demand in China stabilizes by the holiday quarter", status: "challenged", evidence: "two profit warnings; mainland comps still negative" },
  { text: "Semicap orders reaccelerate on HBM capacity adds", status: "supported", evidence: "orders +31% q/q at the two largest toolmakers" },
  { text: "Refinery crack spreads widen into driving season", status: "awaiting", evidence: "reviews on weekly EIA inventory draws" },
];

const SURFACES: { name: string; blurb: string }[] = [
  { name: "MORNING BRIEF", blurb: "The day's read before the open, built around the names you follow." },
  { name: "EVENING WRAP", blurb: "What moved at the close, and what resolved on the record." },
  { name: "LIVE FEED", blurb: "Market-moving news, filtered and scored as it breaks." },
  { name: "RADAR · FOLLOWING", blurb: "The themes you track, with each week's developments." },
  { name: "WATCHLIST & CALLS", blurb: "Your names and your graded calls, kept in one place." },
  { name: "DEAL FLOW", blurb: "M&A, raises, and IPOs across the names and sectors you track." },
  { name: "COMPANY INTEL", blurb: "Every company in your feed, with the themes and mention volume driving each one." },
  { name: "TRENDS", blurb: "What is accelerating across sectors before it is obvious." },
  { name: "INTELLIGENCE", blurb: "Ask the system what the record shows." },
];

const TIMELINE: {
  step: string;
  date: string;
  head: string;
  body: string;
}[] = [
  {
    step: "01",
    date: "TUE JUN 3 · 07:02 ET",
    head: "You read. One line earns a tap.",
    body: "Every claim in the brief is trackable. Tap one and Signalera restates it as a falsifiable thesis with a review date and the evidence that would settle it. Or write your own. Calls you type into Radar are logged and graded exactly the same way as ours.",
  },
  {
    step: "02",
    date: "WED JUN 4 · 06:55 ET",
    head: "Tomorrow's brief already knows.",
    body: "You did not configure anything. Tracking is the configuration. The ripple reaches every surface overnight.",
  },
  {
    step: "03",
    date: "THU JUN 19 · 08:40 ET",
    head: "The evidence arrives. It cuts against the thesis.",
    body: "Signalera marks the thesis challenged, in plain sight. The misses stay on the record, because a record with no misses is marketing.",
  },
  {
    step: "04",
    date: "FRI JUN 20 · 06:55 ET",
    head: "The record updates. Permanently.",
    body: "Every resolved call lands in a ledger you can audit. The scoreboard moves, both ways.",
  },
  {
    step: "05",
    date: "TUE JUL 1 · 06:55 ET · WEEK FOUR",
    head: "The brief is sharper because a call it tracked did not hold.",
    body: "Week four beats week one because it has accumulated how you think, not what you clicked. That is the thing a free summary cannot do.",
  },
];

// Status token map. Colors resolve to CSS-var design tokens (no literals).
function statusClasses(status: Status): string {
  switch (status) {
    case "supported":
      return "text-signal-up border-signal-up/30 bg-signal-up/10";
    case "challenged":
      return "text-signal-dn border-signal-dn/30 bg-signal-dn/10";
    default:
      return "text-signal-warn border-signal-warn/30 bg-signal-warn/10";
  }
}
function statusLabel(status: Status): string {
  switch (status) {
    case "supported":
      return "SUPPORTED";
    case "challenged":
      return "CHALLENGED";
    case "developing":
      return "DEVELOPING";
    case "reviewing":
      return "REVIEWING…";
    default:
      return "AWAITING";
  }
}

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

// Small labelled eyebrow used across sections.
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-gold">
      {children}
    </div>
  );
}

export function OpeningScreen() {
  const reduced = useReducedMotion();
  const [entered, setEntered] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  // Intro gate locks scroll until the visitor enters. Effect-only so SSR/CSR
  // markup stays identical (no hydration mismatch).
  useEffect(() => {
    if (entered) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.scrollTo(0, 0);
    return () => {
      document.body.style.overflow = prev;
    };
  }, [entered]);

  const enter = useCallback(() => {
    setEntered(true);
    // release the lock on the next frame, then let content settle at top
    requestAnimationFrame(() => {
      document.body.style.overflow = "";
      window.scrollTo({ top: 0 });
    });
  }, []);

  const scrollTo = useCallback(
    (id: string) => () => {
      const el = document.getElementById(id);
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY - 40;
      window.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
    },
    [reduced],
  );

  const openModal = useCallback(() => setModalOpen(true), []);

  return (
    <div className="relative min-h-[100dvh] bg-parchment text-text-primary">
      <LandingStyles />

      {/* Scroll progress bar */}
      <ScrollProgress />

      {/* Intro gate */}
      {!entered && (
        <IntroGate onEnter={enter} reduced={reduced} onWaitlist={openModal} />
      )}

      {/* Top nav */}
      <header className="sticky top-0 z-40 border-b border-border-subtle bg-parchment/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
          <button
            type="button"
            onClick={scrollTo("hero")}
            className="font-display text-[19px] font-bold tracking-tight cursor-pointer"
          >
            <span className="text-espresso">Signal</span>
            <span className="text-gold">era</span>
          </button>
          <nav className="flex items-center gap-2 sm:gap-4">
            <Link
              href="/auth"
              className="font-sans text-[13px] font-medium text-text-secondary hover:text-text-primary transition-colors"
            >
              Sign in
            </Link>
            <button
              type="button"
              onClick={openModal}
              className="h-9 rounded-lg bg-gold px-4 font-sans text-[13px] font-semibold text-cream hover:bg-gold-light active:bg-gold-dark transition-all cursor-pointer"
            >
              Join the waitlist
            </button>
          </nav>
        </div>
      </header>

      <main>
        <Hero
          reduced={reduced}
          onWaitlist={openModal}
          onSeeHow={scrollTo("loop")}
        />
        <LoopSection reduced={reduced} />
        <TimelineSection reduced={reduced} />
        <ProofSection reduced={reduced} />
        <MarketReadSection reduced={reduced} />
        <SurfacesSection />
        <UniversitySection />
        <WaitlistSection onWaitlist={openModal} />
      </main>

      <SiteFooter />

      <WaitlistModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}

// --- Scoped keyframes (colors here are transforms/opacity only) --------------
function LandingStyles() {
  return (
    <style>{`
      @keyframes wallScrollA { from { transform: translateY(0); } to { transform: translateY(-50%); } }
      @keyframes wallScrollB { from { transform: translateY(0); } to { transform: translateY(-50%); } }
      @keyframes wallScrollC { from { transform: translateY(0); } to { transform: translateY(-50%); } }
      @keyframes wallScrollD { from { transform: translateY(0); } to { transform: translateY(-50%); } }
      @keyframes landingPulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.35; transform:scale(1.8); } }
      @keyframes landingBlink { 0%,49% { opacity:1; } 50%,100% { opacity:0; } }
      @keyframes landingReveal { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:none; } }
      @media (prefers-reduced-motion: reduce) {
        .landing-anim { animation: none !important; }
      }
    `}</style>
  );
}

function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      if (ref.current && max > 0) {
        ref.current.style.width = ((h.scrollTop / max) * 100).toFixed(2) + "%";
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  return (
    <div className="fixed inset-x-0 top-0 z-50 h-0.5 bg-transparent">
      <div ref={ref} className="h-full w-0 bg-gold" />
    </div>
  );
}

// --- Signal wall background --------------------------------------------------
function SignalWall({ reduced }: { reduced: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex gap-3 overflow-hidden px-2 opacity-40 dark:opacity-30"
      style={{
        maskImage:
          "linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)",
      }}
    >
      {WALL_COLUMNS.map((col, ci) => (
        <div key={ci} className="flex min-w-0 flex-1 flex-col gap-3">
          <div
            className={reduced ? "flex flex-col gap-3" : "landing-anim flex flex-col gap-3"}
            style={
              reduced
                ? undefined
                : {
                    animation: `${WALL_ANIM[ci]} ${WALL_DUR[ci]} linear infinite`,
                  }
            }
          >
            {[...col, ...col].map((s, i) => (
              <div
                key={i}
                className="flex-shrink-0 rounded-lg border border-gold-border bg-gold-muted px-3 py-2.5"
              >
                <div className="mb-1 font-mono text-[8px] font-bold uppercase tracking-[0.14em] text-gold">
                  {s.tag}
                </div>
                <div className="font-sans text-[10px] leading-snug text-text-muted">
                  {s.text}
                </div>
                <div className="mt-1.5 font-mono text-[9px] text-gold-dark">
                  SIGNAL {s.score}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Intro gate --------------------------------------------------------------
function IntroGate({
  onEnter,
  reduced,
  onWaitlist,
}: {
  onEnter: () => void;
  reduced: boolean;
  onWaitlist: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-hidden bg-parchment">
      <SignalWall reduced={reduced} />
      {/* Vignette using tokened surface, not a literal */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-parchment/40 via-transparent to-parchment/80" />
      <div className="relative z-10 flex w-full flex-col items-center px-6 text-center">
        <div className="mb-6 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-gold landing-anim" style={reduced ? undefined : { animation: "landingPulse 2.2s ease-in-out infinite" }} />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.3em] text-gold">
            Signalera · Raw Signal Flow
          </span>
        </div>
        <h1 className="font-display text-[clamp(40px,9vw,84px)] font-bold leading-none tracking-tight text-espresso">
          Signalera.
        </h1>
        <p className="mt-8 max-w-xl font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
          By 06:55 ET the market has already produced a day of noise
        </p>
        <p className="mt-4 max-w-md font-sans text-[15px] leading-relaxed text-text-muted">
          Most of it will not matter to you. The question is which calls hold up.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onEnter}
            className="h-12 rounded-xl bg-gold px-8 font-sans text-[13px] font-bold uppercase tracking-wider text-cream hover:bg-gold-light active:bg-gold-dark transition-all cursor-pointer"
          >
            Enter ↓
          </button>
          <button
            type="button"
            onClick={() => {
              onEnter();
              onWaitlist();
            }}
            className="h-12 rounded-xl border border-gold-border bg-transparent px-6 font-sans text-[13px] font-medium text-text-secondary hover:border-gold hover:text-text-primary transition-all cursor-pointer"
          >
            Join the waitlist
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Hero --------------------------------------------------------------------
function Hero({
  reduced,
  onWaitlist,
  onSeeHow,
}: {
  reduced: boolean;
  onWaitlist: () => void;
  onSeeHow: () => void;
}) {
  const target = "We track which calls hold up.";
  const [typed, setTyped] = useState("");
  const [cursorOn, setCursorOn] = useState(true);

  useEffect(() => {
    if (reduced) {
      setTyped(target);
      setCursorOn(false);
      return;
    }
    let n = 0;
    const start = setTimeout(() => {
      const iv = setInterval(() => {
        n += 1;
        setTyped(target.slice(0, n));
        if (n >= target.length) {
          clearInterval(iv);
          setTimeout(() => setCursorOn(false), 2200);
        }
      }, 42);
    }, 500);
    return () => clearTimeout(start);
     
  }, [reduced]);

  return (
    <section
      id="hero"
      className="relative flex min-h-[88vh] items-center overflow-hidden border-b border-border-subtle"
    >
      <SignalWall reduced={reduced} />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-parchment/50 via-parchment/30 to-parchment/85" />
      <div className="relative z-10 mx-auto w-full max-w-3xl px-6 py-24 text-center">
        <Eyebrow>AI-Native Market Intelligence</Eyebrow>
        <div className="mt-6 font-mono text-[13px] text-gold-dark">
          {typed}
          <span
            className={cursorOn ? "landing-anim" : "opacity-0"}
            style={cursorOn && !reduced ? { animation: "landingBlink 1s step-end infinite" } : undefined}
          >
            _
          </span>
        </div>
        <h1 className="mt-5 font-display text-[clamp(34px,6vw,60px)] font-bold leading-[1.05] tracking-tight text-espresso">
          Anyone can summarize the market.
        </h1>
        <p className="mx-auto mt-6 max-w-xl font-sans text-[15px] leading-relaxed text-text-muted">
          A generic market summary is a commodity. An honest, graded record is
          not. Signalera grades every call against the evidence, including the
          calls that did not hold, and gets sharper the longer you use it.
        </p>
        <p className="mt-3 font-sans text-[12px] uppercase tracking-wider text-text-faint">
          Informational only. Never advice.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onWaitlist}
            className="h-12 rounded-xl bg-gold px-8 font-sans text-[14px] font-bold text-cream hover:bg-gold-light active:bg-gold-dark transition-all cursor-pointer"
          >
            Join the waitlist
          </button>
          <button
            type="button"
            onClick={onSeeHow}
            className="h-12 rounded-xl border border-border-base bg-transparent px-6 font-sans text-[14px] font-medium text-text-secondary hover:border-gold-border hover:text-text-primary transition-all cursor-pointer"
          >
            See how it works ↓
          </button>
        </div>
        <p className="mt-6 font-sans text-[12px] text-text-faint">
          free trial · invite-only during early access
        </p>
      </div>
    </section>
  );
}

// --- The Loop (interactive resolve demo) -------------------------------------
function LoopSection({ reduced }: { reduced: boolean }) {
  const [scene, setScene] = useState(0);
  const [lit, setLit] = useState(reduced ? 4 : 0);
  const [revealed, setRevealed] = useState(reduced);
  const [paused, setPaused] = useState(false);
  const s = DEMO[scene];

  useEffect(() => {
    if (reduced || paused) {
      setLit(4);
      setRevealed(true);
      return;
    }
    setLit(0);
    setRevealed(false);
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setLit(1), 800));
    timers.push(setTimeout(() => setLit(2), 1700));
    timers.push(setTimeout(() => {
      setLit(3);
      setRevealed(true);
    }, 3300));
    timers.push(setTimeout(() => setLit(4), 4100));
    timers.push(setTimeout(() => setScene((p) => (p + 1) % DEMO.length), 6300));
    return () => timers.forEach(clearTimeout);
  }, [scene, reduced, paused]);

  const stageText = ["waiting for evidence", "review date set", "weighing the evidence", "verdict on the record", "fed into tomorrow's brief"][lit];
  const nodeLabels = ["CALLED", "REVIEW DATE", "EVIDENCE", "VERDICT", "SHARPER BRIEF"];

  return (
    <section id="loop" className="border-b border-border-subtle bg-surface px-6 py-24">
      <div className="mx-auto max-w-3xl text-center">
        <Eyebrow>The Loop</Eyebrow>
        <h2 className="mt-4 font-display text-[clamp(28px,5vw,44px)] font-bold tracking-tight text-espresso">
          Make a call. Watch it resolve.
        </h2>
      </div>

      <div className="mx-auto mt-12 max-w-2xl rounded-2xl border border-border-base bg-cream-hi p-6 sm:p-8 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-text-faint">
            A call, in review
          </span>
          <div className="flex items-center gap-3">
            <span
              className={`rounded-full border px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wider ${statusClasses(revealed ? s.result : "awaiting")}`}
            >
              {statusLabel(revealed ? s.result : "awaiting")}
            </span>
            {!reduced && (
              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                className="font-mono text-[9px] font-bold uppercase tracking-wider text-text-faint hover:text-gold cursor-pointer transition-colors"
              >
                {paused ? "Play" : "Pause"}
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-baseline gap-3">
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-gold">
            {s.who}
          </span>
        </div>
        <p className="mt-2 font-display text-[19px] leading-snug text-espresso">
          {s.claim}
        </p>

        {/* 5-node rail */}
        <div className="mt-7">
          <div className="relative mb-4 h-0.5 w-full rounded bg-border-base">
            <div
              className="h-full rounded bg-gold transition-[width] duration-500 ease-out"
              style={{ width: `${lit * 25}%` }}
            />
          </div>
          <div className="flex justify-between">
            {nodeLabels.map((label, k) => {
              const on = k <= lit;
              return (
                <div key={label} className="flex flex-1 flex-col items-center gap-2 text-center">
                  <span
                    className={`h-2.5 w-2.5 rounded-full border transition-colors duration-300 ${on ? "border-gold bg-gold" : "border-border-hi bg-transparent"}`}
                  />
                  <span
                    className={`font-mono text-[8px] font-semibold uppercase tracking-wider transition-colors ${on ? "text-text-secondary" : "text-text-faint"}`}
                  >
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-border-subtle bg-surface px-4 py-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-faint">
            {stageText}
          </div>
          <p
            className={`mt-2 font-sans text-[13.5px] leading-relaxed text-text-muted transition-opacity duration-500 ${revealed ? "opacity-100" : "opacity-0"}`}
          >
            <span className="text-text-primary">{s.attrLead}</span> {s.attrRest}
          </p>
        </div>
      </div>

      <div className="mx-auto mt-8 max-w-2xl space-y-2 text-center">
        <p className="font-sans text-[14px] text-text-secondary">
          <span className="text-gold">✓</span> Tomorrow&apos;s brief accumulates
          how you think, not what you clicked.
        </p>
        <p className="font-sans text-[13px] text-text-muted">
          When a move cannot be credited to the reasoning, we say so.
        </p>
      </div>
    </section>
  );
}

// --- Timeline ----------------------------------------------------------------
function TimelineSection({ reduced }: { reduced: boolean }) {
  return (
    <section className="border-b border-border-subtle px-6 py-24">
      <div className="mx-auto max-w-3xl text-center">
        <Eyebrow>The Life of One Thesis on Signalera</Eyebrow>
        <h2 className="mt-4 font-display text-[clamp(26px,4.5vw,40px)] font-bold tracking-tight text-espresso">
          Four weeks · five moments · one ripple
        </h2>
      </div>

      <div className="mx-auto mt-14 max-w-2xl">
        <div className="relative border-l border-border-base pl-8">
          {TIMELINE.map((t, i) => (
            <Reveal
              key={t.step}
              reduced={reduced}
              className="relative mb-12 last:mb-0"
            >
              <span className="absolute -left-[41px] top-1 flex h-4 w-4 items-center justify-center rounded-full border border-gold-border bg-parchment">
                <span className="h-2 w-2 rounded-full bg-gold" />
              </span>
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-gold">
                {`${t.step} // ${t.date}`}
              </div>
              <h3 className="mt-2 font-display text-[22px] font-semibold leading-snug text-espresso">
                {t.head}
              </h3>
              <p className="mt-2 font-sans text-[14px] leading-relaxed text-text-muted">
                {t.body}
              </p>
              {i === 3 && <RecordTicker reduced={reduced} />}
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function RecordTicker({ reduced }: { reduced: boolean }) {
  const rows = [
    { label: "theses tracked", from: "1,283", to: "1,284" },
    { label: "evidence supported", from: "71.6%", to: "71.4%" },
    { label: "open theses", from: "8", to: "7" },
  ];
  const [flip, setFlip] = useState(reduced);
  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(() => setFlip(true), 600);
    return () => clearTimeout(t);
  }, [reduced]);
  return (
    <div className="mt-4 rounded-lg border border-border-subtle bg-surface p-4">
      <div className="mb-3 rounded border border-signal-dn/30 bg-signal-dn/10 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-signal-dn">
        Freight rates stay soft through peak shipping season · Challenged
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between font-mono text-[12px]">
            <span className="text-text-muted">{r.label}</span>
            <span className="text-text-primary">
              <span className="text-text-faint">{r.from}</span> →{" "}
              <span className="text-gold">{flip ? r.to : r.from}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Proof (week one vs week four) -------------------------------------------
function ProofSection({ reduced }: { reduced: boolean }) {
  const [week, setWeek] = useState<1 | 4>(4);
  return (
    <section id="proof" className="border-b border-border-subtle bg-surface px-6 py-24">
      <div className="mx-auto max-w-3xl text-center">
        <Eyebrow>The Proof // Twenty-Three Days Apart</Eyebrow>
        <h2 className="mt-4 font-display text-[clamp(26px,4.5vw,40px)] font-bold tracking-tight text-espresso">
          The same brief, week one and week four.
        </h2>
        <div className="mt-6 inline-flex rounded-lg border border-border-base bg-cream-hi p-0.5">
          {([1, 4] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWeek(w)}
              className={`rounded-md px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${week === w ? "bg-gold text-cream" : "text-text-muted hover:text-text-primary"}`}
            >
              {w === 1 ? "Week One · Jun 8" : "Week Four · Jul 2"}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`mx-auto mt-10 max-w-2xl rounded-2xl border border-border-base bg-cream-hi p-6 sm:p-8 shadow-sm transition-opacity ${reduced ? "" : "duration-300"}`}
      >
        <div className="flex items-center justify-between border-b border-border-subtle pb-3">
          <span className="font-display text-[15px] font-bold text-espresso">
            Morning Brief
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-faint">
            {week === 1 ? "Mon Jun 8 · 06:55 ET · day 1" : "Thu Jul 2 · 06:55 ET · day 24"}
          </span>
        </div>

        {week === 1 ? (
          <div className="mt-4 space-y-3 font-sans text-[13.5px] leading-relaxed text-text-muted">
            <p>Markets advancing into the open. Futures firm, breadth 3:1, vix at 13.8.</p>
            <p>Fed minutes land at 14:00 ET. Rates desks positioned for no surprise.</p>
            <p>Hyperscaler capex chatter continues ahead of the earnings cycle.</p>
            <p className="font-mono text-[11px] uppercase tracking-wider text-text-faint">
              8 stories worth your attention this morning.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-gold">
                Since you last looked · 2 changes
              </div>
              <ul className="mt-2 space-y-1.5 font-sans text-[13.5px] leading-relaxed text-text-muted">
                <li>The freight thesis you track moved to challenged. Transpacific spot +18% over three weeks.</li>
                <li>Semicap evidence moved from 2 of 5 to 4 of 5 supported checks.</li>
              </ul>
            </div>
            <div className="space-y-2">
              <BriefRow ticker="NVDA" status="reviewing" note="Supplier commentary overnight cuts against the shortage thesis you are tracking. Review flagged for today." pill="REVIEW" />
              <BriefRow ticker="JPM" status="supported" note="Second confirming NII datapoint this month for the rate-sensitivity thesis you follow. Marked supported at the review." pill="SUPPORTED" />
              <BriefRow ticker="UNP" status="awaiting" note="Intermodal volumes print Thursday. The volume thesis you track resolves on the print." pill="AWAITING" />
            </div>
            <p className="font-mono text-[11px] uppercase tracking-wider text-text-faint">
              built on 23 days of your reasoning · 7 open theses · 5 resolved
            </p>
          </div>
        )}
      </div>

      <div className="mx-auto mt-8 max-w-2xl space-y-1.5 text-center font-sans text-[13px] text-text-muted">
        <p>It opens with what changed since you last looked. Continuity, not a feed.</p>
        <p>Calls resolve as supported or challenged. The misses stay on the record.</p>
        <p>Every line exists because of a name you follow or a thesis you track.</p>
        <p className="text-text-faint">For working analysts, IB and PE recruits, and finance students. Broad by design.</p>
      </div>
    </section>
  );
}

function BriefRow({
  ticker,
  status,
  note,
  pill,
}: {
  ticker: string;
  status: Status;
  note: string;
  pill: string;
}) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[12px] font-bold text-espresso">{ticker}</span>
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider ${statusClasses(status)}`}>
          {pill}
        </span>
      </div>
      <p className="mt-1.5 font-sans text-[13px] leading-relaxed text-text-muted">{note}</p>
    </div>
  );
}

// --- Market read + live signal ----------------------------------------------
function MarketReadSection({ reduced }: { reduced: boolean }) {
  const [edition, setEdition] = useState<"morning" | "evening">("morning");
  const [feed, setFeed] = useState<{ id: number; text: string; status: Status; evidence: string }[]>([]);
  const idRef = useRef(0);
  const poolRef = useRef(0);

  useEffect(() => {
    // Seed deterministic set, then rotate (client-only to keep SSR stable).
    const seed = [FEED_POOL[4], FEED_POOL[1], FEED_POOL[0]].map((p) => {
      idRef.current += 1;
      return { id: idRef.current, text: p.text, status: p.status, evidence: p.evidence };
    });
    setFeed(seed);
    poolRef.current = 3;
    if (reduced) return;
    const iv = setInterval(() => {
      const p = FEED_POOL[poolRef.current % FEED_POOL.length];
      poolRef.current += 1;
      idRef.current += 1;
      const item = { id: idRef.current, text: p.text, status: "reviewing" as Status, evidence: "" };
      setFeed((prev) => [item, ...prev].slice(0, 5));
      setTimeout(() => {
        setFeed((prev) => prev.map((f) => (f.id === item.id ? { ...f, status: p.status, evidence: p.evidence } : f)));
      }, 1400);
    }, 3200);
    return () => clearInterval(iv);
  }, [reduced]);

  const isMorning = edition === "morning";

  return (
    <section className="border-b border-border-subtle px-6 py-24">
      <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-2">
        {/* Human read */}
        <div className="rounded-2xl border border-border-base bg-cream-hi p-6 sm:p-8 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-text-faint">
              The human read
            </span>
            <div className="inline-flex rounded-lg border border-border-base bg-surface p-0.5">
              {(["morning", "evening"] as const).map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEdition(e)}
                  className={`rounded-md px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${edition === e ? "bg-gold text-cream" : "text-text-muted hover:text-text-primary"}`}
                >
                  {e === "morning" ? "Morning Brief" : "Evening Wrap"}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 font-mono text-[10px] uppercase tracking-wider text-gold">
            {isMorning ? "Market Pulse · Thu Jul 3 · Markets Open" : "Market Wrap · Thu Jul 3 · Markets Closed"}
          </div>
          <p className="mt-3 font-display text-[20px] leading-snug text-espresso">
            {isMorning ? "Today the market is buoyant." : "The market closed firm."}
          </p>
          <p className="mt-3 font-sans text-[13.5px] leading-relaxed text-text-muted">
            {isMorning
              ? "Breadth is 3:1 into the open with vix at 13.8, and the front end is repricing after the soft services print."
              : "The S&P finished +1.18% with breadth holding 3:1 into the bell. Semis carried the tape for a third straight session."}
          </p>
          <p className="mt-3 font-sans text-[13.5px] leading-relaxed text-text-muted">
            {isMorning
              ? "Semis carry the tape. The datacenter capex theme keeps collecting confirming evidence, with two guides raised overnight."
              : "The freight read weakened again as spot rates extended their move. The semicap thesis stays developing into tomorrow's orders print."}
          </p>
          <p className="mt-5 border-t border-border-subtle pt-3 font-sans text-[11px] text-text-faint">
            synthesized from 214 sources · informational only, never advice
          </p>
        </div>

        {/* Live signal */}
        <div className="rounded-2xl border border-gold-border bg-cream-hi p-6 sm:p-8 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-gold landing-anim" style={reduced ? undefined : { animation: "landingPulse 2.2s ease-in-out infinite" }} />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-gold">
              Signalera AI · Live Signal
            </span>
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-text-faint">
            thesis review stream
          </div>
          <div className="mt-4 space-y-2">
            {feed.map((f) => (
              <div key={f.id} className="rounded-lg border border-border-subtle bg-surface p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-sans text-[12.5px] leading-snug text-text-primary">
                    {f.text}
                  </p>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider ${statusClasses(f.status)}`}>
                    {statusLabel(f.status)}
                  </span>
                </div>
                {f.evidence && (
                  <p className="mt-1.5 font-sans text-[11.5px] text-text-muted">
                    → {f.evidence}
                  </p>
                )}
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2 border-t border-border-subtle pt-4">
            {[
              { num: "1,284", label: "Theses tracked" },
              { num: "71.4%", label: "Evidence supported" },
              { num: "23", label: "Reviewed today" },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="font-mono text-[17px] font-bold text-gold">{s.num}</div>
                <div className="mt-1 font-mono text-[8px] uppercase tracking-wider text-text-faint">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 font-sans text-[10px] leading-relaxed text-text-faint">
            forecast accuracy on falsifiable claims, not investment performance,
            and not advice
          </p>
        </div>
      </div>
    </section>
  );
}

// --- Nine surfaces -----------------------------------------------------------
function SurfacesSection() {
  return (
    <section className="border-b border-border-subtle bg-surface px-6 py-24">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="font-display text-[clamp(28px,5vw,46px)] font-bold leading-tight tracking-tight text-espresso">
          Nine surfaces, <span className="text-gold">one system</span>
        </h2>
        <p className="mt-4 font-sans text-[15px] leading-relaxed text-text-muted">
          Not nine tools. One connected system that already knows what you
          follow.
        </p>
      </div>
      <div className="mx-auto mt-12 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SURFACES.map((s) => (
          <div
            key={s.name}
            className="rounded-xl border border-border-base bg-cream-hi p-5 transition-colors hover:border-gold-border"
          >
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-gold">
              {s.name}
            </div>
            <p className="mt-2 font-sans text-[13.5px] leading-relaxed text-text-muted">
              {s.blurb}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

// --- University partners -----------------------------------------------------
function UniversitySection() {
  return (
    <section className="border-b border-border-subtle px-6 py-20">
      <div className="mx-auto max-w-3xl rounded-2xl border border-gold-border bg-gold-muted p-8 text-center sm:p-12">
        <Eyebrow>University Partners</Eyebrow>
        <h2 className="mt-4 font-display text-[clamp(24px,4vw,34px)] font-bold tracking-tight text-espresso">
          Run a finance org or club?
        </h2>
        <p className="mt-3 font-sans text-[15px] leading-relaxed text-text-muted">
          Bring Signalera to your members as an early partner.
        </p>
        <a
          href="mailto:admin@signalera.ai"
          className="mt-6 inline-flex h-11 items-center rounded-xl border border-gold-border bg-transparent px-6 font-sans text-[13px] font-semibold text-gold-dark hover:bg-gold hover:text-cream transition-all"
        >
          Contact us
        </a>
      </div>
    </section>
  );
}

// --- Final waitlist CTA ------------------------------------------------------
function WaitlistSection({ onWaitlist }: { onWaitlist: () => void }) {
  return (
    <section id="waitlist" className="px-6 py-28">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-display text-[clamp(30px,5.5vw,52px)] font-bold leading-[1.05] tracking-tight text-espresso">
          You already make the calls.
          <br />
          Start keeping the record.
        </h2>
        <p className="mx-auto mt-6 max-w-lg font-sans text-[14px] leading-relaxed text-text-muted">
          For working analysts, IB and PE recruits, and finance students ·
          onboarding in small cohorts · prefer to talk first?{" "}
          <a href="mailto:admin@signalera.ai" className="text-gold hover:text-gold-dark hover:underline">
            contact us
          </a>
        </p>
        <div className="mt-9">
          <button
            type="button"
            onClick={onWaitlist}
            className="rounded-xl bg-gold px-10 py-4 font-sans text-[15px] font-bold text-cream hover:bg-gold-light active:bg-gold-dark transition-all cursor-pointer"
          >
            Join the waitlist
          </button>
        </div>
      </div>
    </section>
  );
}

// --- Footer ------------------------------------------------------------------
function SiteFooter() {
  return (
    <footer className="border-t border-border-subtle bg-surface px-6 py-12">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 text-center sm:flex-row sm:justify-between sm:text-left">
        <div>
          <span className="font-display text-[18px] font-bold tracking-tight">
            <span className="text-espresso">Signal</span>
            <span className="text-gold">era</span>
          </span>
          <p className="mt-1 font-sans text-[11px] text-text-faint">
            Informational only. Not investment advice. Verify before acting.
          </p>
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-4 font-sans text-[12px] text-text-muted">
          <Link href="/legal/terms" className="hover:text-text-primary transition-colors">
            Terms of Service
          </Link>
          <Link href="/legal/privacy" className="hover:text-text-primary transition-colors">
            Privacy Policy
          </Link>
          <a href="mailto:admin@signalera.ai" className="hover:text-text-primary transition-colors">
            Support
          </a>
          <a href="mailto:admin@signalera.ai" className="text-gold hover:text-gold-dark transition-colors">
            admin@signalera.ai
          </a>
        </nav>
      </div>
    </footer>
  );
}

// --- Scroll reveal helper ----------------------------------------------------
function Reveal({
  children,
  reduced,
  className,
}: {
  children: React.ReactNode;
  reduced: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(reduced);
  useEffect(() => {
    if (reduced) {
      setShown(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        });
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(14px)",
        transition: reduced ? undefined : "opacity 0.7s cubic-bezier(0.16,1,0.3,1), transform 0.7s cubic-bezier(0.16,1,0.3,1)",
      }}
    >
      {children}
    </div>
  );
}

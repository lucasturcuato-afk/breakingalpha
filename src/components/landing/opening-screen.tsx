"use client";

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import Link from "next/link";
import { MobileLanding } from "./mobile-landing";
import { useTheme } from "@/components/providers/theme-provider";
import mobile from "@/components/mobile/mobile.module.css";
import styles from "./landing.module.css";

// ---------------------------------------------------------------------------
// Signalera signed-out landing. Near-verbatim port of the design canvas into a
// scoped CSS module (landing.module.css). The module is a SANCTIONED scoped
// exception to the repo token rule: it carries the canvas colors directly.
// Layout, spacing, and structure mirror the canvas section-by-section. Fonts
// are the only remap (module vars point at the app font vars). Animations are
// enhancement-only and gated behind prefers-reduced-motion; content is visible
// by default and never gated on an observer that might not fire.
// ---------------------------------------------------------------------------

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// WaitlistModal is the landing's ONLY value-level importer of
// `@supabase/ssr`, and importing it statically dragged the whole
// `@supabase/supabase-js` client (auth-js + postgrest-js + realtime-js +
// storage-js + the Node Buffer polyfill, 220KB raw / 58KB gzipped) into the
// critical path of a page that makes no Supabase request until someone clicks
// "Sign in" or "Join the waitlist". Measured at 390px on 9 Mbps / 170ms RTT /
// 4x CPU, that chunk was 24% of the landing's 246KB of pre-load JS.
//
// Splitting it moves those bytes behind the click. The chunk is still warmed
// eagerly, so the modal is not slower to open in practice:
//   - `preloadWaitlistModal` runs on idle after the load event, so it costs
//     nothing on the critical path but is normally resident before any click.
//   - The triggers also warm it on pointer/focus intent, which covers a
//     visitor who clicks before idle time arrives.
// `modalRequested` latches on first open and never clears, so the modal stays
// mounted through its exit transition exactly as it did when it was static.
const WaitlistModal = lazy(() =>
  import("./waitlist-modal").then((m) => ({ default: m.WaitlistModal })),
);

function preloadWaitlistModal(): void {
  void import("./waitlist-modal");
}

type Status = "supported" | "challenged" | "awaiting" | "developing" | "reviewing";

// ---- Signal wall (intro gate background) ----------------------------------
type WallCard = { tag: string; score: string; text: string };

// Each column scrolls on the compositor at its own speed and direction so the
// wall reads as ambient depth, not a synchronized marquee. Durations sit in the
// 40-90s band (slow, ambient); adjacent columns differ in both speed and
// direction so nothing moves in lockstep.
const WALL_COLUMNS: { pt: number; dur: string; down: boolean; cards: WallCard[] }[] = [
  {
    pt: 0,
    dur: "58s",
    down: false,
    cards: [
      { tag: "TECHNOLOGY · M&A", score: "8.4", text: "Activist stake disclosed in mid-cap security vendor" },
      { tag: "MACRO & RATES", score: "9.1", text: "Front-end repricing after soft services print" },
      { tag: "SHIPPING", score: "8.8", text: "Transpacific GRIs stick; spot +18% in three weeks" },
      { tag: "CONSUMER", score: "6.9", text: "Luxury mainland comps print negative again" },
      { tag: "CREDIT", score: "7.0", text: "HY issuance window reopens after a quiet June" },
      { tag: "UTILITIES", score: "8.6", text: "Grid capex supercycle guides raised again" },
      { tag: "HEALTHCARE", score: "7.2", text: "Obesity franchise supply constraints easing" },
    ],
  },
  {
    pt: 70,
    dur: "74s",
    down: true,
    cards: [
      { tag: "SEMIS", score: "9.2", text: "HBM capacity adds pull semicap orders forward" },
      { tag: "FINANCIALS", score: "7.6", text: "Regional bank NII guides drift higher" },
      { tag: "GEOPOLITICS", score: "8.9", text: "Export-control update hits tooling names" },
      { tag: "REAL ESTATE", score: "6.4", text: "CMBS spreads tighten on office refi wave" },
      { tag: "ENERGY", score: "6.8", text: "Refinery cracks widen into driving season" },
      { tag: "M&A", score: "9.0", text: "Mega-merger spread widens on second request" },
      { tag: "RATES", score: "7.4", text: "10y auction tails; dealers absorb the print" },
    ],
  },
  {
    pt: 30,
    dur: "46s",
    down: false,
    cards: [
      { tag: "PRIVATE EQUITY", score: "7.9", text: "Take-private chatter around building products distributor" },
      { tag: "INDUSTRIALS", score: "8.1", text: "Transformer lead times extend past 30 months" },
      { tag: "TECHNOLOGY", score: "8.2", text: "Hyperscaler capex guides move higher in aggregate" },
      { tag: "FINANCIALS", score: "6.6", text: "Deposit betas stabilize across regionals" },
      { tag: "SHIPPING", score: "7.1", text: "Carriers file August GRIs across the lane" },
      { tag: "MACRO", score: "8.3", text: "Breadth 3:1 into the open, vix 13.8" },
      { tag: "CONSUMER", score: "6.2", text: "Holiday quarter bookings mixed at the high end" },
    ],
  },
  {
    pt: 100,
    dur: "86s",
    down: true,
    cards: [
      { tag: "M&A", score: "8.7", text: "Second request extends mega-merger timeline" },
      { tag: "SEMIS", score: "7.8", text: "Toolmaker orders +31% q/q at the two largest" },
      { tag: "ENERGY", score: "7.3", text: "EIA draw prints larger than consensus" },
      { tag: "PRIVATE EQUITY", score: "8.0", text: "Sponsor exits reopen via strip sales" },
      { tag: "RATES", score: "6.7", text: "Auction tails 1.2bp; desks fade the move" },
      { tag: "INDUSTRIALS", score: "7.5", text: "Backlog stretch cited by a third transformer maker" },
      { tag: "GEOPOLITICS", score: "8.5", text: "Tariff review lands mid-quarter; supply chains reroute" },
    ],
  },
];

// ---- Loop demo scenes ------------------------------------------------------
type DemoScene = { who: string; claim: string; result: Status; attrLead: string; attrRest: string };

const DEMO: DemoScene[] = [
  { who: "YOU", claim: "AI infrastructure keeps drawing capital toward the names you follow.", result: "supported", attrLead: "Three of four followed names drew fresh capital this week.", attrRest: "The read is clean." },
  { who: "YOU", claim: "Commercial real estate stress eases as refinancing picks up.", result: "challenged", attrLead: "Vacancy printed new highs and refinancing slowed.", attrRest: "The evidence runs the other way. Kept on the record." },
  { who: "SIGNALERA", claim: "Chip supply tightens toward the suppliers you track.", result: "developing", attrLead: "Two confirming developments so far.", attrRest: "Below the bar to call it. Awaiting the next data point." },
];

const DEMO_LABELS = ["CALLED", "REVIEW DATE", "EVIDENCE", "VERDICT", "SHARPER BRIEF"];

type ChipKey = "awaiting" | "developing" | "supported" | "challenged";

const DEMO_CHIP: Record<ChipKey, { label: string; color: string; bg: string; bd: string }> = {
  awaiting: { label: "AWAITING", color: "var(--pdc-awt)", bg: "var(--pdc-awt-bg)", bd: "var(--pdc-awt-bd)" },
  developing: { label: "DEVELOPING", color: "var(--pdc-awt)", bg: "var(--pdc-awt-bg)", bd: "var(--pdc-awt-bd)" },
  supported: { label: "SUPPORTED", color: "var(--pdc-sup)", bg: "var(--pdc-sup-bg)", bd: "var(--pdc-sup-bd)" },
  challenged: { label: "CHALLENGED", color: "var(--pdc-chal)", bg: "var(--pdc-chal-bg)", bd: "var(--pdc-chal-bd)" },
};

// ---- Live feed pool --------------------------------------------------------
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

const FEED_PILL: Record<Status, { label: string; color: string; bg: string; bd: string }> = {
  supported: { label: "SUPPORTED", color: "var(--pdc-sup)", bg: "var(--pdc-sup-bg)", bd: "var(--pdc-sup-bd)" },
  challenged: { label: "CHALLENGED", color: "var(--pdc-chal)", bg: "var(--pdc-chal-bg)", bd: "var(--pdc-chal-bd)" },
  awaiting: { label: "AWAITING", color: "var(--pdc-awt)", bg: "var(--pdc-awt-bg)", bd: "var(--pdc-awt-bd)" },
  reviewing: { label: "REVIEWING…", color: "var(--pdc-awt)", bg: "transparent", bd: "var(--pdc-awt-bd)" },
  developing: { label: "DEVELOPING", color: "var(--pdc-awt)", bg: "var(--pdc-awt-bg)", bd: "var(--pdc-awt-bd)" },
};

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

// Risk-on regime (canvas default marketRegime).
const MARKET_LINE = "markets advancing · vix 13.8 · 10y 4.21% · s&p +1.18% · breadth 3:1";

// ---- hooks -----------------------------------------------------------------
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

// Progressive-enhancement reveal. Content is visible by default (styles.reveal);
// the fade-up only replays once the element enters view. If the observer never
// fires, the content simply stays visible.
function Reveal({
  reduced,
  className,
  children,
}: {
  reduced: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setAnimate(true);
            io.disconnect();
          }
        });
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);
  return (
    <div ref={ref} className={cx(className, styles.reveal, !reduced && animate && styles.revealAnim)}>
      {children}
    </div>
  );
}

export function OpeningScreen() {
  const reduced = useReducedMotion();
  const { theme, toggleTheme, mounted } = useTheme();
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalRequested, setModalRequested] = useState(false);
  const [modalMode, setModalMode] = useState<"signin" | "signup">("signup");
  const [modalEmail, setModalEmail] = useState("");
  const forcedDarkRef = useRef(false);
  const landingRef = useRef<HTMLDivElement>(null);

  // Landing defaults to dark. ThemeProvider seeds light and reads localStorage
  // on mount; once mounted, if the visitor has no saved preference we flip to
  // dark exactly once so state, the .dark class, and storage agree.
  useEffect(() => {
    if (!mounted || forcedDarkRef.current) return;
    const saved =
      typeof window !== "undefined" ? window.localStorage.getItem("signalera_theme") : null;
    if (!saved && theme === "light") {
      forcedDarkRef.current = true;
      toggleTheme();
    }
  }, [mounted, theme, toggleTheme]);

  // Intro gate locks scroll until the visitor enters. The gate is a
  // desktop-scale device and is NOT PORTED to mobile, so its lock must not
  // reach mobile either. A CLASS carries the lock rather than a style
  // assignment, because a media query can gate a class and cannot gate a
  // write to document.body.style. mobile.gateLock is `overflow: visible`
  // below 768px and `overflow: hidden` at and above it.
  useEffect(() => {
    if (entered) return;
    const cls = mobile.gateLock;
    document.body.classList.add(cls);
    window.scrollTo(0, 0);
    return () => {
      document.body.classList.remove(cls);
    };
  }, [entered]);

  // ENTER handoff. Reduced motion swaps instantly (gate unmounted, no movement).
  // Otherwise we hold the gate mounted for one transition: it plays its recede
  // (see .introGateClosing) while the landing plays .landingArrive underneath,
  // then we unmount the gate. Focus moves into the landing immediately so the
  // gate cannot be tabbed while it fades, and lands there for good after.
  const finishEnter = useCallback(() => {
    setEntered(true);
    setClosing(false);
    requestAnimationFrame(() => {
      document.body.classList.remove(mobile.gateLock);
      window.scrollTo({ top: 0 });
      landingRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const enter = useCallback(() => {
    if (reduced) {
      finishEnter();
      return;
    }
    setClosing(true);
    requestAnimationFrame(() => landingRef.current?.focus({ preventScroll: true }));
    window.setTimeout(finishEnter, 620);
  }, [reduced, finishEnter]);

  const scrollTo = useCallback(
    (id: string) => () => {
      const el = document.getElementById(id);
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY - 60;
      window.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
    },
    [reduced],
  );

  // Sign in opens the modal on the Sign In tab; Join the waitlist opens it on
  // the Create Account tab. Nothing on the landing routes to /auth; the modal
  // reuses the same auth primitives and /auth/callback still enforces the gate.
  const openSignin = useCallback(() => {
    setModalMode("signin");
    setModalEmail("");
    setModalRequested(true);
    setModalOpen(true);
  }, []);
  const openWaitlist = useCallback(() => {
    setModalMode("signup");
    setModalEmail("");
    setModalRequested(true);
    setModalOpen(true);
  }, []);
  // The bottom inline waitlist form opens this SAME modal on the Create Account
  // tab. If the visitor typed an email into that field first, we prefill it into
  // the modal; if not, the modal opens with an empty email field.
  const onJoinWaitlist = useCallback((email: string) => {
    setModalMode("signup");
    setModalEmail(email);
    setModalRequested(true);
    setModalOpen(true);
  }, []);
  const themeLabel = mounted ? `◐ THEME · ${theme.toUpperCase()}` : "◐ THEME";

  // Warm the split modal chunk once the page is idle. requestIdleCallback runs
  // after the load event, which is the point of the split: the bytes are off
  // the critical path but still there before a visitor reaches for the button.
  // Safari has no requestIdleCallback, hence the timeout fallback.
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(preloadWaitlistModal, { timeout: 3000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(preloadWaitlistModal, 1500);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className={styles.root}>
      {/* Mobile, authored at 390px. The two trees are siblings and the gate
          is a class on each, so neither can leak into the other's width. */}
      <MobileLanding onSignin={openSignin} onWaitlist={openWaitlist} />

      <div className="hidden md:block">
      <ScrollProgress />

      {!entered && <IntroGate reduced={reduced} closing={closing} onEnter={enter} />}

      <div
        ref={landingRef}
        tabIndex={-1}
        className={cx(styles.landingRoot, closing && !reduced && styles.landingArrive)}
      >
        {/* market strip */}
        <div className={styles.marketStrip}>
          <span className={styles.marketStripDot} />
          <span className={styles.marketLine}>{MARKET_LINE}</span>
          <span className={styles.marketSpacer} />
          <span className={styles.regimeChip}>
            <span className={styles.regimeChipDot} style={{ background: "#5FA97A" }} />
            RISK-ON
          </span>
        </div>

        {/* nav */}
        <nav className={styles.nav}>
          <button type="button" onClick={scrollTo("hero")} className={styles.navWordmark}>
            Signal<span className={styles.brassSpan}>era.</span>
          </button>
          <div className={styles.navRight}>
            <button type="button" onClick={toggleTheme} aria-label="Toggle color theme" className={styles.themeToggle}>
              {themeLabel}
            </button>
            <button
              type="button"
              onClick={openSignin}
              onPointerEnter={preloadWaitlistModal}
              onFocus={preloadWaitlistModal}
              className={styles.signInLink}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={openWaitlist}
              onPointerEnter={preloadWaitlistModal}
              onFocus={preloadWaitlistModal}
              className={styles.joinNav}
            >
              Join the waitlist
            </button>
          </div>
        </nav>

        <Hero reduced={reduced} onWaitlist={openWaitlist} onSeeHow={scrollTo("demo")} />
        <LoopSection reduced={reduced} />
        <TimelineSection reduced={reduced} />
        <ProofSection reduced={reduced} />
        <MarketReadSection reduced={reduced} />
        <SurfacesSection />
        <UniversitySection />
        <WaitlistSection onJoinWaitlist={onJoinWaitlist} />
        <SiteFooter />
      </div>
      </div>

      {modalRequested && (
        <Suspense fallback={null}>
          <WaitlistModal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            initialMode={modalMode}
            initialEmail={modalEmail}
          />
        </Suspense>
      )}
    </div>
  );
}

// --- scroll progress --------------------------------------------------------
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
  return <div ref={ref} className={styles.scrollProgress} />;
}

// --- intro gate -------------------------------------------------------------
function IntroGate({
  reduced,
  closing,
  onEnter,
}: {
  reduced: boolean;
  closing: boolean;
  onEnter: () => void;
}) {
  return (
    <div
      className={cx(styles.introGate, closing && styles.introGateClosing)}
      inert={closing || undefined}
    >
      <div className={styles.wallGrid} aria-hidden="true">
        {WALL_COLUMNS.map((col, ci) => (
          <div key={ci} className={styles.wallCol} style={{ paddingTop: col.pt }}>
            <div
              className={
                reduced
                  ? styles.wallColInner
                  : `${styles.wallColInner} ${col.down ? styles.wallAnimDown : styles.wallAnimUp}`
              }
              style={
                reduced
                  ? undefined
                  : ({ "--wall-dur": col.dur } as CSSProperties)
              }
            >
              {[...col.cards, ...col.cards].map((c, i) => (
                <div key={i} className={styles.wallCard}>
                  <div className={styles.wallCardHead}>
                    <span className={styles.wallTag}>{c.tag}</span>
                    <span className={styles.wallScore}>SIGNAL {c.score}</span>
                  </div>
                  <div className={styles.wallText}>{c.text}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.introTopBar}>
        <span>SIGNALERA · RAW SIGNAL FLOW</span>
        <span className={styles.introLive}>
          <span className={styles.introLiveDot} />
          LIVE
        </span>
      </div>

      <div className={styles.introVeil}>
        <div className={styles.introCard}>
          <div className={styles.introWordmark}>
            Signal<span className={styles.brassSpan}>era.</span>
          </div>
          <div className={styles.introKicker}>BY 06:55 ET THE MARKET HAS ALREADY PRODUCED A DAY OF NOISE</div>
          <p className={styles.introLede}>
            Most of it will not matter to you. The question is which calls the evidence supports.
          </p>
          <button type="button" onClick={onEnter} className={styles.introEnterBtn}>
            ENTER {"↓"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- hero -------------------------------------------------------------------
function Hero({
  reduced,
  onWaitlist,
  onSeeHow,
}: {
  reduced: boolean;
  onWaitlist: () => void;
  onSeeHow: () => void;
}) {
  const target = "We track which calls the evidence supports.";
  const [typed, setTyped] = useState("");
  const [cursorOn, setCursorOn] = useState(true);

  useEffect(() => {
    if (reduced) {
      setTyped(target);
      setCursorOn(false);
      return;
    }
    let n = 0;
    let iv: ReturnType<typeof setInterval>;
    const start = setTimeout(() => {
      iv = setInterval(() => {
        n += 1;
        setTyped(target.slice(0, n));
        if (n >= target.length) {
          clearInterval(iv);
          setTimeout(() => setCursorOn(false), 2400);
        }
      }, 42);
    }, 700);
    return () => {
      clearTimeout(start);
      clearInterval(iv);
    };
  }, [reduced]);

  return (
    <header id="hero" className={styles.hero}>
      <Reveal reduced={reduced}>
        <div className={styles.heroEyebrow}>AI-NATIVE MARKET INTELLIGENCE</div>
        <h1 className={styles.heroH1}>
          <span className={styles.heroSetup}>Anyone can summarize the market.</span>
          <span className={styles.heroHeadline}>
            {typed}
            {cursorOn && <span aria-hidden="true" className={styles.heroCursor} />}
          </span>
        </h1>
        <p className={styles.heroPara}>
          A generic market summary is a commodity. An honest, graded record is not. Signalera grades every call
          against the evidence, including the calls the evidence ran against, and gets sharper the longer you use it.
        </p>
        <p className={styles.heroDisclaimer}>Informational only. Never advice.</p>
        <div className={styles.heroCtas}>
          <button type="button" onClick={onWaitlist} className={styles.btnPrimary}>
            Join the waitlist
          </button>
          <button type="button" onClick={onSeeHow} className={styles.btnGhost}>
            See how it works {"↓"}
          </button>
          <span className={styles.heroBadge}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            free trial · invite-only during early access
          </span>
        </div>
      </Reveal>
    </header>
  );
}

// --- loop demo --------------------------------------------------------------
function LoopSection({ reduced }: { reduced: boolean }) {
  const [scene, setScene] = useState(0);
  const [lit, setLit] = useState(0);
  const [chip, setChip] = useState<ChipKey>("awaiting");
  const [stage, setStage] = useState("waiting for evidence");
  const [attrShown, setAttrShown] = useState(false);
  const [nextShown, setNextShown] = useState(false);
  const [paused, setPaused] = useState(false);
  const s = DEMO[scene];

  useEffect(() => {
    if (reduced) {
      setLit(4);
      setChip(s.result as ChipKey);
      setStage("verdict on the record");
      setAttrShown(true);
      setNextShown(true);
      return;
    }
    if (paused) return;
    setLit(0);
    setChip("awaiting");
    setStage("waiting for evidence");
    setAttrShown(false);
    setNextShown(false);
    const t: ReturnType<typeof setTimeout>[] = [];
    t.push(setTimeout(() => { setLit(1); setStage("review date set"); }, 800));
    t.push(setTimeout(() => { setLit(2); setChip("developing"); setStage("weighing the evidence"); }, 1700));
    t.push(setTimeout(() => { setLit(3); setChip(s.result as ChipKey); setStage("verdict on the record"); setAttrShown(true); }, 3300));
    t.push(setTimeout(() => { setLit(4); setStage("fed into tomorrow's brief"); setNextShown(true); }, 4100));
    t.push(setTimeout(() => setScene((p) => (p + 1) % DEMO.length), 6300));
    return () => t.forEach(clearTimeout);
  }, [scene, reduced, paused, s.result]);

  const chipStyle = DEMO_CHIP[chip];

  return (
    <section id="demo" className={styles.demoSection}>
      <div className={styles.demoInner}>
        <Reveal reduced={reduced}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionKicker}>THE LOOP</span>
            <span className={styles.sectionRule} />
          </div>
        </Reveal>
        <Reveal reduced={reduced}>
          <div className={styles.demoTitle}>Make a call. Watch it resolve.</div>
        </Reveal>

        <Reveal reduced={reduced}>
          <div className={styles.panel}>
            <div className={styles.demoTopRow}>
              <span className={styles.demoLiveLabel}>
                <span className={styles.demoLiveTag}>
                  <span className={styles.demoLiveDot} />
                  LIVE
                </span>
                A CALL, IN REVIEW
              </span>
              {!reduced && (
                <button type="button" onClick={() => setPaused((p) => !p)} className={styles.demoCtlBtn}>
                  {paused ? "PLAY" : "PAUSE"}
                </button>
              )}
            </div>

            <div className={styles.demoRail} aria-hidden="true">
              <span className={styles.demoRailTrack} />
              <span className={styles.demoRailFill} style={{ width: `${lit * 20}%` }} />
              <div className={styles.demoNodes}>
                {DEMO_LABELS.map((label, k) => {
                  const isLit = k <= lit;
                  const isActive = k === lit;
                  return (
                    <div key={label} className={styles.demoNode}>
                      <span
                        className={cx(styles.demoNodeDot, isLit && styles.demoNodeDotLit, isActive && styles.demoNodeDotActive)}
                      >
                        <span className={cx(styles.demoNodeInner, isLit && styles.demoNodeInnerLit)} />
                      </span>
                      <span className={cx(styles.demoNodeLabel, isLit && styles.demoNodeLabelLit)}>{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={styles.demoClaimWrap}>
              <span className={styles.demoWho}>{s.who}</span>
              <div className={styles.demoClaim}>{s.claim}</div>
            </div>
            <div className={styles.demoChipRow}>
              <span
                className={styles.demoChip}
                style={{ color: chipStyle.color, background: chipStyle.bg, border: `1px solid ${chipStyle.bd}` }}
              >
                {chipStyle.label}
              </span>
              <span className={styles.demoStage}>{stage}</span>
            </div>
            <div className={styles.demoAttr} style={{ opacity: attrShown ? 1 : 0 }}>
              {attrShown && (
                <>
                  <span className={styles.demoAttrLead}>{s.attrLead}</span> {s.attrRest}
                </>
              )}
            </div>
            <div className={cx(styles.demoNext, nextShown && styles.demoNextShown)}>
              <span className={styles.demoNextCheck}>{"✓"}</span> Tomorrow&apos;s brief accumulates how you
              think, not what you clicked.
            </div>
          </div>
        </Reveal>
        <Reveal reduced={reduced}>
          <p className={styles.demoFootnote}>When a move cannot be credited to the reasoning, we say so.</p>
        </Reveal>
      </div>
    </section>
  );
}

// --- timeline ---------------------------------------------------------------
function TimelineSection({ reduced }: { reduced: boolean }) {
  return (
    <section id="loop" className={styles.timelineSection}>
      <div className={styles.timelineInner}>
        <Reveal reduced={reduced} className={styles.timelineHead}>
          <span className={styles.sectionKicker}>THE LIFE OF ONE THESIS ON SIGNALERA</span>
          <span className={styles.timelineHeadSub}>four weeks · five moments · one ripple</span>
          <span className={styles.timelineRuleCenter} />
        </Reveal>

        <div className={styles.timelineBody}>
          {/* moment 01 */}
          <Reveal reduced={reduced} className={styles.beat}>
            <div className={styles.beatLeft}>
              <div className={styles.beatDate}>01 // TUE JUN 3 · 07:02 ET</div>
              <div className={styles.beatHead}>You read. One line earns a tap.</div>
              <p className={styles.beatPara}>
                Every claim in the brief is trackable. Tap one and Signalera restates it as a falsifiable thesis
                with a review date and the evidence that would settle it.
              </p>
              <p className={cx(styles.beatPara, styles.beatParaGap)}>
                Or write your own. Calls you type into Radar are logged and graded exactly the same way as ours.
              </p>
            </div>
            <div className={styles.beatSpine}>
              <span className={cx(styles.beatDot, styles.beatDotTopGap)} style={{ background: "var(--brass)" }} />
              <span className={styles.beatSpineLine} />
              <span className={styles.beatRail} style={{ top: 16, background: "var(--brass-bd)", transform: "scaleY(1)" }} />
            </div>
            <div className={styles.beatRight}>
              <div className={styles.card}>
                <div className={styles.briefHeadRow}>
                  <span>MORNING BRIEF · TUE JUN 3</span>
                  <span>06:55 ET</span>
                </div>
                <div className={styles.briefLine}>
                  Carriers keep announcing capacity into a soft market. Transpacific spot has drifted lower for five
                  straight weeks.
                </div>
                <div className={styles.briefLineHi}>
                  <span className={styles.briefLineHiText}>
                    Freight rates stay soft through peak shipping season.
                  </span>
                  <button type="button" className={styles.trackedBtn}>{"✓"} TRACKED</button>
                </div>
                <div className={cx(styles.briefLine, styles.briefLineLast)}>
                  Rate desks see the GRI announcements as posturing. Watch the July 1 implementation.
                </div>
              </div>
              <div className={styles.thesisCard}>
                <div>
                  <div className={styles.thesisKicker}>THESIS TH-0412 · CREATED FROM YOUR TAP</div>
                  <div className={styles.thesisTitle}>Freight rates stay soft through peak shipping season</div>
                  <div className={styles.thesisMeta}>fails if transpacific spot +10% before sep 1 · review jun 20</div>
                </div>
                <span className={styles.pillAwt}>AWAITING</span>
              </div>
              <div className={styles.orDivider}>
                <span className={styles.orDividerRule} />
                <span className={styles.orDividerText}>OR WRITE YOUR OWN</span>
                <span className={styles.orDividerRule} />
              </div>
              <div className={styles.radarCard}>
                <div className={styles.radarHead}>
                  <span className={styles.radarHeadLabel}>RADAR · CALLS</span>
                  <span className={styles.radarFollow}>
                    <span className={styles.radarFollowLabel}>FOLLOWING</span>
                    <span className={styles.radarTag}>GLP-1 drugs</span>
                    <span className={styles.radarTag}>AI agents</span>
                    <span className={styles.radarTag}>SaaS market</span>
                    <span className={styles.radarTagAdd}>+ follow</span>
                  </span>
                </div>
                <div className={styles.radarRow}>
                  <span className={styles.radarRowText}>
                    SaaS pricing consolidates around agent seats by Q4
                    <span className={styles.radarCursor} />
                  </span>
                  <button type="button" className={styles.trackedBtn}>TRACK IT</button>
                </div>
                <div className={styles.radarFoot}>
                  logged as CALL-0413 · review sep 30 · graded the same as every call on the record
                </div>
              </div>
            </div>
          </Reveal>

          {/* moment 02 */}
          <Reveal reduced={reduced} className={styles.beat}>
            <div className={styles.beatLeft}>
              <div className={styles.beatDate}>02 // WED JUN 4 · 06:55 ET</div>
              <div className={styles.beatHead}>Tomorrow&apos;s brief already knows.</div>
              <p className={styles.beatPara}>
                You did not configure anything. Tracking is the configuration. The ripple reaches every surface
                overnight.
              </p>
            </div>
            <div className={styles.beatSpine}>
              <span className={styles.beatSpineStub} />
              <span className={styles.beatDot} style={{ background: "var(--brass)" }} />
              <span className={styles.beatSpineLine} />
              <span className={styles.beatRail} style={{ top: 22, background: "var(--brass-bd)", transform: "scaleY(1)" }} />
            </div>
            <div className={styles.beatRight}>
              <div className={styles.card}>
                <div className={styles.briefHeadRow}>
                  <span>MORNING BRIEF · WED JUN 4</span>
                  <span>06:55 ET</span>
                </div>
                <div className={styles.briefFlexRow}>
                  <span className={styles.yourThesisTag}>YOUR THESIS</span>
                  <span className={styles.briefFlexText}>
                    On your freight thesis: two carriers filed July GRIs overnight, and transpacific spot prints
                    Thursday. The print is the first evidence check.
                  </span>
                </div>
              </div>
            </div>
          </Reveal>

          {/* moment 03 */}
          <Reveal reduced={reduced} className={styles.beat}>
            <div className={styles.beatLeft}>
              <div className={styles.beatDate}>03 // THU JUN 19 · 08:40 ET</div>
              <div className={styles.beatHead}>The evidence arrives. It cuts against the thesis.</div>
              <p className={styles.beatPara}>
                Signalera marks the thesis challenged, in plain sight. The misses stay on the record, because a
                record with no misses is marketing.
              </p>
            </div>
            <div className={styles.beatSpine}>
              <span className={styles.beatSpineStub} />
              <span className={styles.beatDot} style={{ background: "var(--chal)" }} />
              <span className={styles.beatSpineLine} />
              <span className={styles.beatRail} style={{ top: 22, background: "var(--chal)", transform: "scaleY(1)" }} />
            </div>
            <div className={styles.beatRight}>
              <div className={styles.card}>
                <div className={styles.briefHeadRow}>
                  <span>EVIDENCE CHECK · TH-0412</span>
                  <span>THU JUN 19</span>
                </div>
                <div className={styles.evidenceBody}>
                  <div className={styles.evidenceText}>
                    drewry WCI transpacific: +18% over three weeks. GRIs stuck. Threshold breached.
                  </div>
                  <div className={styles.evidenceRow}>
                    <span className={styles.pillAwt}>AWAITING</span>
                    <svg width="26" height="10" viewBox="0 0 26 10" fill="none">
                      <path d="M0 5h20M17 1l4 4-4 4" stroke="var(--dim)" strokeWidth="1.5" />
                    </svg>
                    <span className={styles.evChip}>CHALLENGED</span>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>

          {/* moment 04 */}
          <Reveal reduced={reduced} className={styles.beat}>
            <div className={styles.beatLeft}>
              <div className={styles.beatDate}>04 // FRI JUN 20 · 06:55 ET</div>
              <div className={styles.beatHead}>The record updates. Permanently.</div>
              <p className={styles.beatPara}>
                Every resolved call lands in a ledger you can audit. The scoreboard moves, both ways.
              </p>
            </div>
            <div className={styles.beatSpine}>
              <span className={styles.beatSpineStub} />
              <span className={styles.beatDot} style={{ background: "var(--brass)" }} />
              <span className={styles.beatSpineLine} />
              <span className={styles.beatRail} style={{ top: 22, background: "var(--brass-bd)", transform: "scaleY(1)" }} />
            </div>
            <div className={styles.beatRight}>
              <div className={styles.card}>
                <div className={styles.ledgerHeadRow}>
                  <span className={styles.ledgerTitle}>Freight rates stay soft through peak shipping season</span>
                  <span className={styles.pillChalCenter}>CHALLENGED</span>
                </div>
                {/* Ruling 2. The aggregate figure that stood between these two
                    counts is gone. Counts are permitted; a rate is not, and an
                    "evidence supported N%" line is the exact shape the brief
                    forbids anywhere, including placeholder content. */}
                <div className={styles.ledgerStats}>
                  <span>theses tracked 1,283 &rarr; <span className={styles.cntBrass}>1,284</span></span>
                  <span>open theses 8 &rarr; <span className={styles.cntBrass}>7</span></span>
                </div>
              </div>
            </div>
          </Reveal>

          {/* moment 05 */}
          <Reveal reduced={reduced} className={styles.beat}>
            <div className={cx(styles.beatLeft, styles.beatLeftLast)}>
              <div className={styles.beatDate}>05 // TUE JUL 1 · 06:55 ET · WEEK FOUR</div>
              <div className={styles.beatHead}>The brief is sharper because a call it tracked did not survive.</div>
              <p className={styles.beatPara}>
                Week four beats week one because it has accumulated how you think, not what you clicked. That is the
                thing a free summary cannot do.
              </p>
            </div>
            <div className={styles.beatSpine}>
              <span className={styles.beatSpineStub} />
              <span className={styles.beatDot} style={{ background: "var(--sup)" }} />
            </div>
            <div className={cx(styles.beatRight, styles.beatRightLast)}>
              <div className={styles.card}>
                <div className={styles.briefHeadRow}>
                  <span>MORNING BRIEF · TUE JUL 1</span>
                  <span>06:55 ET</span>
                </div>
                <div className={styles.briefLine}>
                  Freight: the trough call came early. The GRIs stuck, and capacity discipline into August is now the
                  question the challenged thesis raises.
                </div>
                <div className={cx(styles.briefLine, styles.briefLineLast)}>
                  Two of the names you follow report next week, and consensus moved on both. The semicap thesis sits
                  at 4 of 5 supported checks going in.
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

// --- proof (week one vs week four) ------------------------------------------
function ProofSection({ reduced }: { reduced: boolean }) {
  const [week, setWeek] = useState<1 | 4>(4);
  const w4 = week === 4;
  return (
    <section id="proof" className={styles.proofSection}>
      <div className={styles.proofInner}>
        <Reveal reduced={reduced} className={styles.sectionHead}>
          <span className={styles.sectionKicker}>THE PROOF // TWENTY-THREE DAYS APART</span>
          <span className={styles.sectionRule} />
        </Reveal>
        <Reveal reduced={reduced} className={styles.proofSubHead}>
          <div className={styles.proofTitle}>The same brief, week one and week four.</div>
          <span className={styles.proofCaption}>
            {w4 ? "day 24 · it knows you now" : "day 1 · accurate and anonymous"}
          </span>
        </Reveal>

        <Reveal reduced={reduced} className={styles.proofTabs}>
          <button type="button" onClick={() => setWeek(1)} className={cx(styles.tab, !w4 && styles.tabActive)}>
            WEEK ONE · JUN 8
          </button>
          <button type="button" onClick={() => setWeek(4)} className={cx(styles.tab, w4 && styles.tabActive)}>
            WEEK FOUR · JUL 2
          </button>
        </Reveal>

        <Reveal reduced={reduced} className={styles.proofGrid}>
          <div className={styles.briefDoc}>
            {!w4 ? (
              <div>
                <div className={styles.docHeadRow}>
                  <span className={styles.docHeadTitle}>MORNING BRIEF</span>
                  <span className={styles.docHeadDate}>MON JUN 8 · 06:55 ET · day 1</span>
                </div>
                <div className={styles.docLine}>Markets advancing into the open. Futures firm, breadth 3:1, vix at 13.8.</div>
                <div className={styles.docLine}>Fed minutes land at 14:00 ET. Rates desks positioned for no surprise.</div>
                <div className={styles.docLine}>Hyperscaler capex chatter continues ahead of the earnings cycle.</div>
                <div className={styles.docLine}>8 stories worth your attention this morning.</div>
                <div className={styles.docFoot}>
                  personalization: none yet · open theses: 0 · accurate, but it could be anyone&apos;s brief
                </div>
              </div>
            ) : (
              <div>
                <div className={styles.docHeadRow}>
                  <span className={styles.docHeadTitle}>MORNING BRIEF</span>
                  <span className={styles.docHeadDate}>THU JUL 2 · 06:55 ET · day 24</span>
                </div>
                <div className={styles.docChangeBlock}>
                  <span className={styles.docBadge}>1</span>
                  <div className={styles.docChangeKicker}>SINCE YOU LAST LOOKED · 2 CHANGES</div>
                  <div className={styles.docChangeText}>
                    The freight thesis you track moved to <span className={styles.tChal}>challenged</span>.
                    Transpacific spot +18% over three weeks.
                  </div>
                  <div className={styles.docChangeTextLast}>
                    Semicap evidence moved from 2 of 5 to <span className={styles.tSup}>4 of 5</span> supported checks.
                  </div>
                </div>
                <div className={styles.docRow}>
                  <span className={cx(styles.docBadge, styles.docBadgeZ)}>3</span>
                  <span className={styles.docRowTicker}>NVDA</span>
                  <span className={styles.docRowText}>
                    Supplier commentary overnight cuts against the shortage thesis you are tracking. Review flagged
                    for today.
                  </span>
                  <span className={styles.docPillAwt}>REVIEW</span>
                </div>
                <div className={styles.docRow}>
                  <span className={cx(styles.docBadge, styles.docBadgeZ)}>2</span>
                  <span className={styles.docRowTicker}>JPM</span>
                  <span className={styles.docRowText}>
                    Second confirming NII datapoint this month for the rate-sensitivity thesis you follow. Marked
                    supported at the review.
                  </span>
                  <span className={styles.docPillSup}>SUPPORTED</span>
                </div>
                <div className={styles.docRow}>
                  <span className={styles.docRowTicker}>UNP</span>
                  <span className={styles.docRowText}>
                    Intermodal volumes print Thursday. The volume thesis you track resolves on the print.
                  </span>
                  <span className={styles.docPillAwt}>AWAITING</span>
                </div>
                <div className={styles.docFoot}>built on 23 days of your reasoning · 7 open theses · 5 resolved</div>
              </div>
            )}
          </div>

          <div className={styles.proofLegend}>
            <div className={styles.legendRow}>
              <span className={styles.legendNum}>1</span>
              <p className={styles.legendText}>it opens with what changed since you last looked. continuity, not a feed.</p>
            </div>
            <div className={styles.legendRow}>
              <span className={styles.legendNum}>2</span>
              <p className={styles.legendText}>calls resolve as supported or challenged. the misses stay on the record.</p>
            </div>
            <div className={styles.legendRow}>
              <span className={styles.legendNum}>3</span>
              <p className={styles.legendText}>every line exists because of a name you follow or a thesis you track.</p>
            </div>
            <div className={styles.legendFoot}>
              for working analysts, IB and PE recruits, and finance students. broad by design.
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// --- market read + live signal ----------------------------------------------
type FeedItem = { id: number; time: string; text: string; status: Status; evidence: string };

function nowStr(): string {
  return new Date().toTimeString().slice(0, 8);
}

function MarketReadSection({ reduced }: { reduced: boolean }) {
  const [edition, setEdition] = useState<"morning" | "evening">("morning");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [tracked, setTracked] = useState(1284);
  const [reviewed, setReviewed] = useState(23);
  // Flash a tile when its number updates. Boolean per tile; onAnimationEnd drops
  // it to re-arm for the next update. Gated on not-reduced-motion below.
  const [flashTracked, setFlashTracked] = useState(false);
  const [flashReviewed, setFlashReviewed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);
  const poolRef = useRef(0);
  const trackedRef = useRef(1284);

  useEffect(() => {
    const seed = [FEED_POOL[4], FEED_POOL[1], FEED_POOL[0]].map((p) => {
      idRef.current += 1;
      return { id: idRef.current, time: nowStr(), text: p.text, status: p.status, evidence: p.evidence };
    });
    setFeed(seed);
    poolRef.current = 3;
    if (reduced) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    const push = () => {
      const p = FEED_POOL[poolRef.current % FEED_POOL.length];
      poolRef.current += 1;
      idRef.current += 1;
      const id = idRef.current;
      const item: FeedItem = { id, time: nowStr(), text: p.text, status: "reviewing", evidence: "" };
      setFeed((prev) => [item, ...prev].slice(0, 6));
      // fluid entry: offset the list up by one row, then slide back down
      requestAnimationFrame(() => {
        const l = listRef.current;
        if (!l) return;
        l.style.transition = "none";
        l.style.transform = "translateY(-112px)";
        void l.getBoundingClientRect();
        l.style.transition = "transform 0.5s cubic-bezier(0.16,1,0.3,1)";
        l.style.transform = "translateY(0)";
      });
      timers.push(
        setTimeout(() => {
          setFeed((prev) => prev.map((f) => (f.id === id ? { ...f, status: p.status, evidence: p.evidence } : f)));
          trackedRef.current += 1;
          setTracked(trackedRef.current);
          setReviewed((r) => r + 1);
          // Flash each tile whose number just moved. Both remaining tiles are
          // counts and both always move. Gated on not-reduced-motion so tiles
          // change silently under it.
          // Ruling 2: the derived-rate tile that also lived here is gone, and
          // with it the two running totals that fed it.
          if (!reduced) {
            setFlashTracked(true);
            setFlashReviewed(true);
          }
        }, 1500),
      );
    };
    const iv = setInterval(push, 3000);
    push();
    return () => {
      clearInterval(iv);
      timers.forEach(clearTimeout);
    };
  }, [reduced]);

  const isMorning = edition === "morning";

  return (
    <section className={styles.pairSection}>
      <div className={styles.pairInner}>
        {/* market-read card */}
        <Reveal reduced={reduced} className={styles.readPanel}>
          <div className={styles.readHead}>
            <div className={styles.readTabs}>
              <button type="button" onClick={() => setEdition("morning")} className={cx(styles.readTab, isMorning && styles.readTabActive)}>
                MORNING BRIEF
              </button>
              <button type="button" onClick={() => setEdition("evening")} className={cx(styles.readTab, !isMorning && styles.readTabActive)}>
                EVENING WRAP
              </button>
            </div>
            <span className={styles.readHeadNote}>the human read</span>
          </div>
          <div className={styles.readBody}>
            <div className={styles.readLabel}>
              {isMorning ? "MARKET PULSE · THU JUL 3 · MARKETS OPEN" : "MARKET WRAP · THU JUL 3 · MARKETS CLOSED"}
            </div>
            <div className={styles.readLead}>
              {isMorning ? "Today the market is" : "The market closed"}{" "}
              <span className={styles.readMood}>{isMorning ? "buoyant" : "firm"}</span>.
            </div>
            <p className={styles.readPara}>
              {isMorning
                ? "Breadth is 3:1 into the open with vix at 13.8, and the front end is repricing after the soft services print."
                : "The S&P finished +1.18% with breadth holding 3:1 into the bell. Semis carried the tape for a third straight session."}
            </p>
            <p className={styles.readParaLast}>
              {isMorning
                ? "Semis carry the tape. The datacenter capex theme keeps collecting confirming evidence, with two guides raised overnight."
                : "The freight read weakened again as spot rates extended their move. The semicap thesis stays developing into tomorrow's orders print."}
            </p>
            <div className={styles.readSpacer} />
            <div className={styles.readFoot}>synthesized from 214 sources · informational only, never advice</div>
          </div>
        </Reveal>

        {/* live signal terminal */}
        <Reveal reduced={reduced} className={styles.feedPanel}>
          <span className={styles.feedAmbient} />
          <div className={styles.feedHead}>
            <span className={styles.feedHeadLabel}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#CBA24C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
              SIGNALERA AI · LIVE SIGNAL
              <span className={styles.feedHeadDot} />
            </span>
            <span className={styles.readHeadNote}>thesis review stream</span>
          </div>
          <div className={styles.feedViewport}>
            <div ref={listRef}>
              {feed.map((f) => {
                const pill = FEED_PILL[f.status];
                return (
                  <div key={f.id} className={styles.feedItem}>
                    <div className={styles.feedItemHead}>
                      <span className={styles.feedTime}>{f.time} ET</span>
                      <span
                        className={styles.feedPill}
                        style={{ color: pill.color, background: pill.bg, border: `1px solid ${pill.bd}` }}
                      >
                        {pill.label}
                      </span>
                    </div>
                    <div className={styles.feedText}>{f.text}</div>
                    {f.evidence && <div className={styles.feedEvidence}>{"→"} {f.evidence}</div>}
                  </div>
                );
              })}
            </div>
          </div>
          <div className={styles.feedStats}>
            <div className={styles.feedStat}>
              <div className={styles.feedStatLabel}>THESES TRACKED</div>
              <div
                className={cx(styles.feedStatNum, !reduced && flashTracked && styles.statFlash)}
                onAnimationEnd={() => setFlashTracked(false)}
              >
                {tracked.toLocaleString("en-US")}
              </div>
            </div>
            <div className={styles.feedStatLast}>
              <div className={styles.feedStatLabel}>REVIEWED TODAY</div>
              <div
                className={cx(styles.feedStatNum, styles.feedStatNumAwt, !reduced && flashReviewed && styles.statFlash)}
                onAnimationEnd={() => setFlashReviewed(false)}
              >
                {reviewed}
              </div>
            </div>
          </div>
          {/* The caveat that stood here existed only to qualify the removed
              rate, and it named the rate twice to do it. Both tiles that
              remain are counts and need no qualifier of that kind. */}
          <div className={styles.feedFoot}>
            falsifiable claims, reviewed on the record. informational only, never advice
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// --- nine surfaces ----------------------------------------------------------
function SurfacesSection() {
  return (
    <section className={styles.surfacesSection}>
      <div className={styles.surfacesInner}>
        <div className={styles.surfacesLabel}>
          NINE<br />SURFACES,<br />ONE SYSTEM
        </div>
        <div>
          <p className={styles.surfacesIntro}>
            Not nine tools. One connected system that already knows what you follow.
          </p>
          <div className={styles.surfacesGrid}>
            {SURFACES.map((s) => (
              <div key={s.name} className={styles.surfaceItem}>
                <div className={styles.surfaceName}>{s.name}</div>
                <p className={styles.surfaceBlurb}>{s.blurb}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// --- university partners ----------------------------------------------------
function UniversitySection() {
  return (
    <section className={styles.universitySection}>
      <div className={styles.universityInner}>
        <div className={styles.universityCard}>
          <div>
            <div className={styles.universityKicker}>UNIVERSITY PARTNERS</div>
            <div className={styles.universityTitle}>Run a finance org or club?</div>
            <div className={styles.universitySub}>Bring Signalera to your members as an early partner.</div>
          </div>
          <a
            href="mailto:admin@signalera.ai?subject=Signalera%20university%20partnership"
            className={styles.universityBtn}
          >
            Contact us
          </a>
        </div>
      </div>
    </section>
  );
}

// --- final waitlist (inline form) -------------------------------------------
// The field stays as an affordance, but this form no longer confirms anything on
// its own. Submitting (button click or Enter) opens the SAME shared modal on the
// Create Account tab, prefilled with whatever the visitor typed here. Validation
// and the actual account/waitlist write now live in the modal, not here.
function WaitlistSection({ onJoinWaitlist }: { onJoinWaitlist: (email: string) => void }) {
  const [email, setEmail] = useState("");

  const onJoin = (e: React.FormEvent) => {
    e.preventDefault();
    onJoinWaitlist(email);
  };

  return (
    <section id="waitlist" className={styles.waitlistSection}>
      <div className={styles.waitlistInner}>
        <div>
          <div className={styles.waitlistTitle}>You already make the calls. Start keeping the record.</div>
          <div className={styles.waitlistMeta}>
            for working analysts, IB and PE recruits, and finance students · onboarding in small cohorts ·{" "}
            <a href="mailto:admin@signalera.ai" className={styles.waitlistMetaLink}>
              prefer to talk first? contact us
            </a>
          </div>
        </div>
        <div>
          <form onSubmit={onJoin} className={styles.waitlistForm}>
            <input
              type="email"
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={styles.waitlistInput}
            />
            <button type="submit" className={styles.btnPrimary}>
              Join the waitlist
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

// --- footer -----------------------------------------------------------------
function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerLeft}>
          <span className={styles.footerWordmark}>
            Signal<span className={styles.brassSpan}>era.</span>
          </span>
          <span className={styles.footerDisclaimer}>
            Informational only. Not investment advice. Verify before acting.
          </span>
        </div>
        <span className={styles.footerLinks}>
          <Link href="/legal/terms" className={styles.footerLink}>
            Terms of Service
          </Link>
          <Link href="/legal/privacy" className={styles.footerLink}>
            Privacy Policy
          </Link>
          <a href="mailto:admin@signalera.ai" className={styles.footerLink}>
            Support
          </a>
          <a href="mailto:admin@signalera.ai" className={styles.footerLinkBrass}>
            admin@signalera.ai
          </a>
        </span>
      </div>
    </footer>
  );
}

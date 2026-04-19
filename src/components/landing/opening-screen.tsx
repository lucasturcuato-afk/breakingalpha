"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type Signal = { tag: string; title: string; score: string };

const SIGNALS: Signal[] = [
  { tag: "Technology · M&A", title: "Anthropic closes $2.5B Series E at $18B post-money valuation", score: "Signal 9.2" },
  { tag: "Private Equity", title: "Apollo weighs $3.8B bid for global infrastructure assets", score: "Signal 8.7" },
  { tag: "Public Markets", title: "Fed minutes signal patience on rate cuts despite cooling CPI", score: "Signal 8.1" },
  { tag: "Venture Capital", title: "CoreWeave raises $1.1B at $19B valuation ahead of Nasdaq IPO", score: "Signal 9.5" },
  { tag: "Geopolitics · Macro", title: "NVIDIA export controls tighten as US-China chip war escalates", score: "Signal 8.8" },
  { tag: "Financial Services", title: "Goldman lifts S&P year-end target to 5,600 on earnings beat", score: "Signal 7.4" },
  { tag: "Healthcare · M&A", title: "AstraZeneca acquires Gracell Biotechnologies for $1.2B cash", score: "Signal 8.0" },
  { tag: "IPO Pipeline", title: "Stripe files confidentially for NYSE listing at $65B valuation", score: "Signal 9.1" },
  { tag: "Energy & Climate", title: "Blackstone commits $7B to data center power infrastructure fund", score: "Signal 8.3" },
  { tag: "Technology · VC", title: "Mistral AI raises €600M Series B led by General Catalyst", score: "Signal 8.9" },
  { tag: "Real Estate", title: "Brookfield acquires $4.2B office portfolio from distressed seller", score: "Signal 7.8" },
  { tag: "Macro & Rates", title: "10Y yield breaks 4.5% as PCE beats; LBO spreads widen 40bps", score: "Signal 8.6" },
  { tag: "Fintech", title: "Visa acquires payment infrastructure platform for $900M all-cash", score: "Signal 7.9" },
  { tag: "Geopolitics", title: "Semiconductor export controls expand to cover 10nm process nodes", score: "Signal 8.4" },
  { tag: "Private Equity", title: "KKR closes $20B infrastructure fund, largest in firm history", score: "Signal 8.2" },
  { tag: "Consumer & Retail", title: "Vista Equity targets $2.1B LBO of restaurant tech platform", score: "Signal 7.6" },
];

const COLUMN_INDICES = [
  [0, 4, 8, 12, 1, 5],
  [2, 6, 10, 14, 3, 7],
  [1, 5, 9, 13, 0, 4],
  [3, 7, 11, 15, 2, 6],
];

const STATS = [
  { num: "25", label: "Sectors" },
  { num: "600+", label: "Companies tracked" },
  { num: "200+", label: "Deals in pipeline" },
  { num: "6am + 8pm", label: "Daily briefs" },
];

function buildCardHTML(signal: Signal): string {
  return `<div style="background:rgba(217,119,6,0.05);border:0.5px solid rgba(217,119,6,0.13);border-radius:7px;padding:9px 10px;flex-shrink:0;">
    <div style="font-size:8px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:rgba(217,119,6,0.55);font-family:monospace;margin-bottom:4px;">${signal.tag}</div>
    <div style="font-size:10px;color:rgba(245,234,216,0.36);line-height:1.4;font-family:sans-serif;">${signal.title}</div>
    <div style="font-size:9px;font-family:monospace;color:rgba(217,119,6,0.38);margin-top:5px;">${signal.score}</div>
  </div>`;
}

export function OpeningScreen() {
  const router = useRouter();

  const feedRef = useRef<HTMLDivElement>(null);
  const wordmarkRef = useRef<HTMLDivElement>(null);
  const taglineRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const scanRef = useRef<HTMLDivElement>(null);
  const lineLRef = useRef<HTMLDivElement>(null);
  const lineRRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    // Build feed via innerHTML to avoid SSR/CSR hydration mismatch
    if (feedRef.current) {
      feedRef.current.innerHTML = "";
      COLUMN_INDICES.forEach((indices, colIdx) => {
        const colEl = document.createElement("div");
        colEl.style.cssText = "display:flex;flex-direction:column;gap:9px;flex:1;min-width:0;";

        const animations = [
          "scrollUp1 30s linear infinite",
          "scrollUp2 23s linear infinite",
          "scrollUp3 35s linear infinite",
          "scrollUp4 27s linear infinite",
        ];
        const delays = ["0s", "-9s", "-17s", "-5s"];
        colEl.style.animation = animations[colIdx];
        colEl.style.animationDelay = delays[colIdx];

        const doubled = [...indices, ...indices];
        colEl.innerHTML = doubled.map((i) => buildCardHTML(SIGNALS[i])).join("");
        feedRef.current!.appendChild(colEl);
      });
    }

    // Set initial styles
    if (feedRef.current) {
      feedRef.current.style.opacity = "0";
      feedRef.current.style.filter = "blur(16px)";
    }
    if (wordmarkRef.current) wordmarkRef.current.style.opacity = "0";
    if (taglineRef.current) {
      taglineRef.current.style.color = "rgba(255,255,255,0)";
      taglineRef.current.style.letterSpacing = "5px";
    }
    if (heroRef.current) {
      heroRef.current.style.opacity = "0";
      heroRef.current.style.transform = "translateY(22px)";
      heroRef.current.style.maxHeight = "0px";
      heroRef.current.style.overflow = "hidden";
    }
    if (statsRef.current) {
      statsRef.current.style.opacity = "0";
      statsRef.current.style.transform = "translateY(10px)";
    }
    if (scanRef.current) scanRef.current.style.opacity = "0";
    if (lineLRef.current) lineLRef.current.style.width = "0px";
    if (lineRRef.current) lineRRef.current.style.width = "0px";

    // Step 1
    timeouts.push(setTimeout(() => {
      if (!wordmarkRef.current) return;
      wordmarkRef.current.style.opacity = "1";
      wordmarkRef.current.style.transition = "opacity 0.9s ease";
    }, 200));

    // Step 2
    timeouts.push(setTimeout(() => {
      if (lineLRef.current) {
        lineLRef.current.style.width = "56px";
        lineLRef.current.style.transition = "width 0.6s ease";
      }
      if (lineRRef.current) {
        lineRRef.current.style.width = "56px";
        lineRRef.current.style.transition = "width 0.6s ease";
      }
    }, 1200));

    // Step 3
    timeouts.push(setTimeout(() => {
      if (!taglineRef.current) return;
      taglineRef.current.style.color = "rgba(255,255,255,0.7)";
      taglineRef.current.style.letterSpacing = "3.5px";
      taglineRef.current.style.transition = "color 0.8s ease, letter-spacing 0.8s ease";
    }, 1500));

    // Step 4
    timeouts.push(setTimeout(() => {
      if (!feedRef.current) return;
      feedRef.current.style.opacity = "1";
      feedRef.current.style.filter = "blur(0px)";
      feedRef.current.style.transition = "opacity 1.6s ease, filter 1.6s ease";
    }, 1900));

    // Step 5
    timeouts.push(setTimeout(() => {
      if (!heroRef.current) return;
      heroRef.current.style.opacity = "1";
      heroRef.current.style.transform = "translateY(0)";
      heroRef.current.style.maxHeight = "600px";
      heroRef.current.style.transition = "opacity 0.8s ease, transform 0.8s ease, max-height 0.8s ease";
    }, 2700));

    // Step 6
    timeouts.push(setTimeout(() => {
      if (!statsRef.current) return;
      statsRef.current.style.opacity = "1";
      statsRef.current.style.transform = "translateY(0)";
      statsRef.current.style.transition = "opacity 0.6s ease, transform 0.6s ease";
    }, 3300));

    // Step 7
    timeouts.push(setTimeout(() => {
      if (!scanRef.current) return;
      scanRef.current.style.animation = "scan 6s ease-in-out infinite";
      scanRef.current.style.opacity = "1";
    }, 3600));

    return () => timeouts.forEach(clearTimeout);
  }, []);

  return (
    <>
      <style>{`
        @keyframes scrollUp1 { from { transform: translateY(0); } to { transform: translateY(-50%); } }
        @keyframes scrollUp2 { from { transform: translateY(0); } to { transform: translateY(-50%); } }
        @keyframes scrollUp3 { from { transform: translateY(0); } to { transform: translateY(-50%); } }
        @keyframes scrollUp4 { from { transform: translateY(0); } to { transform: translateY(-50%); } }
        @keyframes pulseDot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.3; transform: scale(1.9); }
        }
        @keyframes arrowSlide {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(5px); }
        }
        @keyframes scan {
          0% { top: -2px; opacity: 0; }
          6% { opacity: 1; }
          92% { opacity: 0.4; }
          100% { top: 100%; opacity: 0; }
        }
      `}</style>

      <div style={{
        minHeight: "100dvh",
        background: "#0a0702",
        overflow: "hidden",
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>

        {/* Layer 1: Scrolling signal feed background */}
        <div style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          maskImage: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.65) 20%, rgba(0,0,0,0.65) 80%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.65) 20%, rgba(0,0,0,0.65) 80%, transparent 100%)",
          display: "flex",
          gap: "10px",
          padding: "0 6px",
          overflow: "hidden",
        }}
          ref={feedRef}
        />

        {/* Layer 2: Vignette */}
        <div style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 5,
          background: "radial-gradient(ellipse at 50% 50%, rgba(10,7,2,0.25) 0%, rgba(10,7,2,0.92) 100%)",
        }} />

        {/* Scan line */}
        <div
          ref={scanRef}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: "1px",
            pointerEvents: "none",
            zIndex: 4,
            opacity: 0,
            background: "linear-gradient(to right, transparent 0%, rgba(217,119,6,0.5) 30%, rgba(217,119,6,0.7) 50%, rgba(217,119,6,0.5) 70%, transparent 100%)",
          }}
        />

        {/* Layer 3: Centered content */}
        <div style={{
          position: "relative",
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          padding: "52px 32px",
          width: "100%",
        }}>

          {/* Section A: Wordmark block */}
          <div ref={wordmarkRef} style={{ opacity: 0 }}>
            {/* Wordmark row */}
            <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
              <div
                ref={lineLRef}
                style={{ height: "0.5px", background: "rgba(217,119,6,0.4)", width: "0px" }}
              />
              <span style={{
                fontFamily: "var(--font-display), Georgia, serif",
                fontSize: "52px",
                fontWeight: 800,
                color: "#f5ead8",
                letterSpacing: "-0.5px",
                lineHeight: 1,
                whiteSpace: "nowrap",
              }}>
                <span style={{ color: "#f5ead8" }}>Signal</span>
                <span style={{ color: "#d97706" }}>era</span>
              </span>
              <div
                ref={lineRRef}
                style={{ height: "0.5px", background: "rgba(217,119,6,0.4)", width: "0px" }}
              />
            </div>

            {/* Tagline */}
            <div
              ref={taglineRef}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "9px",
                marginTop: "13px",
                color: "rgba(255,255,255,0)",
                letterSpacing: "5px",
                fontFamily: "sans-serif",
                fontSize: "11px",
                fontWeight: 600,
                textTransform: "uppercase",
              }}
            >
              <span style={{
                display: "inline-block",
                width: "5px",
                height: "5px",
                borderRadius: "50%",
                background: "#d97706",
                flexShrink: 0,
                animation: "pulseDot 2.2s ease-in-out infinite",
              }} />
              Where Markets Make Sense
            </div>
          </div>

          {/* Section B: Hero block */}
          <div
            ref={heroRef}
            style={{
              opacity: 0,
              transform: "translateY(22px)",
              maxHeight: "0px",
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ height: "36px" }} />

              <h1 style={{
                fontFamily: "var(--font-display), Georgia, serif",
                fontSize: "clamp(24px, 4vw, 38px)",
                fontWeight: 800,
                color: "#f5ead8",
                lineHeight: 1.1,
                letterSpacing: "-0.4px",
                maxWidth: "450px",
                marginBottom: "18px",
              }}>
                Stop piecing together<br />your morning from 12 tabs.
              </h1>

              <p style={{
                fontFamily: "sans-serif",
                fontSize: "13.5px",
                color: "rgba(255,255,255,0.7)",
                lineHeight: 1.72,
                maxWidth: "355px",
                marginBottom: "36px",
              }}>
                Signalera synthesizes market-moving news, deal flow, and investment signals into one analyst-grade brief — built around what you actually track.
              </p>

              {/* Button row */}
              <div style={{ display: "flex", gap: "11px", alignItems: "center", marginBottom: "42px" }}>
                <button
                  type="button"
                  onClick={() => { window.location.href = "/auth"; }}
                  style={{
                    height: "46px",
                    padding: "0 28px",
                    borderRadius: "10px",
                    background: "#d97706",
                    color: "#0a0702",
                    fontSize: "13px",
                    fontWeight: 700,
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "sans-serif",
                  }}
                >
                  Get Started — It&apos;s Free
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/preview")}
                  style={{
                    height: "46px",
                    padding: "0 22px",
                    borderRadius: "10px",
                    background: "rgba(255,255,255,0.04)",
                    border: "0.5px solid rgba(255,255,255,0.18)",
                    color: "rgba(255,255,255,0.7)",
                    fontSize: "13px",
                    fontWeight: 500,
                    cursor: "pointer",
                    fontFamily: "sans-serif",
                    display: "flex",
                    alignItems: "center",
                    gap: "7px",
                  }}
                >
                  Explore Preview{" "}
                  <span style={{ display: "inline-block", animation: "arrowSlide 1.6s ease-in-out infinite" }}>→</span>
                </button>
              </div>

              {/* Stats row */}
              <div
                ref={statsRef}
                style={{ opacity: 0, transform: "translateY(10px)" }}
              >
                <div style={{
                  display: "flex",
                  border: "0.5px solid rgba(217,119,6,0.18)",
                  borderRadius: "10px",
                  overflow: "hidden",
                }}>
                  {STATS.map((stat, i) => (
                    <div
                      key={stat.label}
                      style={{
                        padding: "11px 19px",
                        background: "rgba(217,119,6,0.04)",
                        borderRight: i < STATS.length - 1 ? "0.5px solid rgba(217,119,6,0.12)" : "none",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "3px",
                      }}
                    >
                      <div style={{
                        fontFamily: "monospace",
                        fontSize: "17px",
                        fontWeight: 700,
                        color: "#d97706",
                        lineHeight: 1,
                      }}>
                        {stat.num}
                      </div>
                      <div style={{
                        fontFamily: "sans-serif",
                        fontSize: "9px",
                        fontWeight: 500,
                        color: "rgba(255,255,255,0.24)",
                        letterSpacing: "1.4px",
                        textTransform: "uppercase",
                      }}>
                        {stat.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

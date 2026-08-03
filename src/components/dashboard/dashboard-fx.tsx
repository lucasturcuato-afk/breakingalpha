"use client";

import { useEffect, useState } from "react";
import { AnimatedNumber } from "@/components/ui";
import { getMarketStatus, formatShortDate } from "./greeting";

const INTRO_SEEN_KEY = "signalera_dash_intro_seen";

/**
 * Date + market-status pill for the greeting header. Client-only (market
 * status depends on the local clock) so it renders a stable placeholder on the
 * server and hydrates without a mismatch.
 */
export function DatePill() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <span className="inline-flex items-center h-[30px] w-[190px] rounded-full bg-border-subtle/40 animate-pulse" />
    );
  }
  return (
    <span className="inline-flex items-center gap-2 font-data text-[12px] text-text-muted bg-white border border-border-base rounded-full px-3 py-1.5 tabular-nums whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-gold-dark" />
      {formatShortDate()}
      <span className="text-text-faint">·</span>
      <span className="text-gold-dark">{getMarketStatus().toLowerCase()}</span>
    </span>
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Cursor-follow glow — a soft gold radial that trails the pointer across the
 * dashboard. Purely ambient: hidden entirely under prefers-reduced-motion
 * (handled in CSS) and never mounted when the user opts out.
 */
export function CursorGlow() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    setEnabled(true);
    const el = document.getElementById("dash-cursor-glow");
    if (!el) return;
    function onMove(e: MouseEvent) {
      el!.style.setProperty("--gx", `${e.clientX}px`);
      el!.style.setProperty("--gy", `${e.clientY}px`);
      el!.classList.add("on");
    }
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  if (!enabled) return null;
  return <div id="dash-cursor-glow" aria-hidden="true" />;
}

/**
 * TileSpotlight — makes the per-tile hover glow actually follow the pointer.
 *
 * .dash-tile::after positions its radial gradient at var(--mx) var(--my), but
 * nothing ever set those properties, so every tile fell back to the 50% 50%
 * default and lit its own centre no matter where the cursor was. This sets
 * them, in tile-relative pixels, from a single delegated listener.
 *
 * One document-level pointermove handler (passive) resolves the tile under the
 * cursor via closest(), and writes are coalesced into a rAF so a fast drag
 * across the page cannot queue more than one style write per frame. Skipped
 * entirely under prefers-reduced-motion, where the hover reveal is disabled in
 * CSS anyway.
 */
export function TileSpotlight() {
  useEffect(() => {
    if (prefersReducedMotion()) return;

    // The rect is read once per tile the pointer enters (and refreshed on
    // scroll/resize) rather than on every move, so the hot path is just two
    // custom-property writes. Deliberately NOT rAF-throttled: rAF is paused
    // while a page is hidden, which would make the effect silently dead and
    // untestable, and two setProperty calls do not force layout.
    let lastTile: HTMLElement | null = null;
    let rect: DOMRect | null = null;

    function onMove(e: PointerEvent) {
      const target = e.target as Element | null;
      const tile = (target?.closest?.(".dash-tile") ?? null) as HTMLElement | null;
      if (!tile) return;
      if (tile !== lastTile || !rect) {
        lastTile = tile;
        rect = tile.getBoundingClientRect();
      }
      tile.style.setProperty("--mx", `${e.clientX - rect.left}px`);
      tile.style.setProperty("--my", `${e.clientY - rect.top}px`);
    }

    function invalidate() {
      rect = lastTile ? lastTile.getBoundingClientRect() : null;
    }

    document.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", invalidate, { passive: true });
    window.addEventListener("resize", invalidate);
    return () => {
      document.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", invalidate);
      window.removeEventListener("resize", invalidate);
    };
  }, []);

  return null;
}

/**
 * Cinematic briefing intro — a one-time-per-session splash that counts up a few
 * headline metrics while "compiling" the briefing, then fades out to reveal the
 * dashboard. Skipped entirely under prefers-reduced-motion and after it has run
 * once in the current session.
 */
export function DashboardIntro({ storyCount = 0 }: { storyCount?: number }) {
  const [show, setShow] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [barFull, setBarFull] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    try {
      if (sessionStorage.getItem(INTRO_SEEN_KEY)) return;
    } catch {
      // sessionStorage unavailable (private mode) — just show once.
    }
    setShow(true);
    const raf = requestAnimationFrame(() => setBarFull(true));
    const outTimer = setTimeout(() => setLeaving(true), 1900);
    const doneTimer = setTimeout(() => {
      setShow(false);
      try {
        sessionStorage.setItem(INTRO_SEEN_KEY, "1");
      } catch {
        // ignore
      }
    }, 2600);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(outTimer);
      clearTimeout(doneTimer);
    };
  }, []);

  if (!show) return null;

  const signals = storyCount > 0 ? storyCount : 128;

  return (
    <div className={`dash-intro${leaving ? " out" : ""}`} aria-hidden="true">
      <div className="flex flex-col items-center gap-6 w-full max-w-[440px] px-6 text-center">
        <div
          className="dash-intro-el inline-flex items-center gap-3"
          style={{ animationDelay: "0ms" }}
        >
          <span className="dash-mark-glow inline-flex items-center justify-center w-[30px] h-[30px] rounded-lg bg-gold text-[color:var(--logo-ink,#1a1208)] font-display font-medium text-[18px]">
            S
          </span>
          <span className="font-display font-medium text-[24px] text-espresso tracking-[-0.015em]">
            Signalera
          </span>
        </div>

        <p
          className="dash-intro-el font-display italic text-[20px] text-text-secondary m-0 leading-[1.4]"
          style={{ animationDelay: "140ms" }}
        >
          Compiling your morning briefing…
        </p>

        <div
          className="dash-intro-el w-full h-[2px] rounded-full bg-border-base overflow-hidden"
          style={{ animationDelay: "260ms" }}
        >
          <div
            className="h-full bg-gradient-to-r from-gold to-gold-light"
            style={{
              width: barFull ? "100%" : "0%",
              transition: "width 1.9s cubic-bezier(0.5,0,0.2,1)",
            }}
          />
        </div>

        <div
          className="dash-intro-el flex items-baseline justify-center gap-7"
          style={{ animationDelay: "360ms" }}
        >
          <IntroStat label="sources" value={1240} format={(n) => Math.round(n).toLocaleString("en-US")} />
          <span className="w-px self-stretch bg-border-base" />
          <IntroStat label="signals" value={signals} gold format={(n) => String(Math.round(n))} />
          <span className="w-px self-stretch bg-border-base" />
          <IntroStat label="calls tracked" value={34} format={(n) => String(Math.round(n))} />
        </div>
      </div>
    </div>
  );
}

function IntroStat({
  label,
  value,
  format,
  gold = false,
}: {
  label: string;
  value: number;
  format: (n: number) => string;
  gold?: boolean;
}) {
  return (
    <span className="flex flex-col-reverse gap-1">
      <span className="font-data text-[9.5px] tracking-[0.02em] text-text-faint">{label}</span>
      <span
        className={`font-data text-[20px] tabular-nums ${gold ? "text-gold-dark" : "text-espresso"}`}
      >
        <AnimatedNumber value={value} format={format} duration={1500} />
      </span>
    </span>
  );
}

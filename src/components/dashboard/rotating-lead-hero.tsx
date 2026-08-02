"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { LeadStoryCard, type StoryData } from "@/components/dashboard/story-card";

/**
 * RotatingLeadHero — the immersive lead hero cycling through the top ~4 Top
 * Stories (the mockup's "01 / 02 / 03 · auto · tap to hold" behavior).
 *
 * - Auto-advances on a slow interval; each story brings its OWN real data
 *   (headline, dek, why-it-matters bullets, peer bars) into the hero. The
 *   LeadStoryCard content is keyed on story id, so on every rotation it fades
 *   in and its HeroPeers re-resolves + re-runs count-up/grow.
 * - Hover or focus anywhere on the tile (including the strip) PAUSES rotation
 *   and holds the current story; leaving resumes. A number-click jumps.
 * - Reduced motion: no auto-rotate and no fade — renders the first story and
 *   lets the numbered strip switch on click only.
 */

const ROTATE_MS = 7000;

// A short, human label for the rundown strip: prefer the company name, then the
// parsed ticker, then the first meaningful word of the headline.
function shortLabel(s: StoryData): string {
  const raw =
    s.tags?.[0] ||
    s.companies?.[0] ||
    s.sourceTicker ||
    (s.title || "").split(/\s+/).find((w) => w.length > 2) ||
    s.title ||
    "";
  return raw.length > 14 ? raw.slice(0, 13) + "…" : raw;
}

export function RotatingLeadHero({
  stories,
  isWatching,
}: {
  stories: StoryData[];
  /** Optional predicate — renders the "Watching" cue above the active story. */
  isWatching?: (s: StoryData) => boolean;
}) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = stories.length;
  // Clamp for render so a shrinking story set can't point past the end; the
  // interval's modulo and explicit clicks keep the stored index valid.
  const activeIdx = n > 0 ? Math.min(active, n - 1) : 0;

  // Auto-advance — skipped entirely under reduced motion, with a single story,
  // or while held (hover/focus). The ref lets the interval read the latest
  // paused state without resetting the timer each hover.
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    if (reduce || n <= 1) return;
    const id = setInterval(() => {
      if (!pausedRef.current) setActive((i) => (i + 1) % n);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [reduce, n]);

  if (n === 0) return null;
  const story = stories[activeIdx];

  const footer =
    n > 1 ? (
      <div className="flex items-center gap-x-4 gap-y-2 flex-wrap mt-5 pt-4 border-t border-[rgba(212,168,75,0.14)]">
        {stories.map((s, i) => {
          const on = i === activeIdx;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Show story ${i + 1}: ${shortLabel(s)}`}
              aria-current={on}
              className="inline-flex items-baseline gap-[7px] cursor-pointer bg-transparent border-0 p-0 group"
            >
              <span
                className={cn(
                  "font-data text-[11px] tabular-nums transition-colors",
                  on
                    ? "text-[#14110b] bg-[#d4a84b] rounded-[3px] px-[5px] py-[1px]"
                    : "text-[#6f6650]",
                )}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className={cn(
                  "font-display italic text-[12.5px] transition-colors",
                  on ? "text-[#f6ecdb]" : "text-[#8a7d63] group-hover:text-[#e8c169]",
                )}
              >
                {shortLabel(s)}
              </span>
            </button>
          );
        })}
        <span className="font-data text-[10px] text-[#6f6650] ml-1">
          {reduce ? "tap to switch" : paused ? "held" : "auto · tap to hold"}
        </span>
      </div>
    ) : undefined;

  return (
    <div className="relative">
      {isWatching?.(story) && (
        <span className="inline-flex items-center gap-1 font-sans text-[10px] font-semibold text-gold bg-gold-muted border border-gold/20 rounded px-1.5 py-0.5 mb-1">
          Watching
        </span>
      )}
      <LeadStoryCard
        story={story}
        variant="hero"
        footer={footer}
        onHoldStart={() => setPaused(true)}
        onHoldEnd={() => setPaused(false)}
      />
    </div>
  );
}

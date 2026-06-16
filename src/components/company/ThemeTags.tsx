"use client";

import { useEffect, useRef, useState } from "react";

// Shared tag styling (tokens unchanged from the prior inline markup -- this is
// a layout refactor, not a color change). The dark: variant is carried over
// from the merged dark-mode work, not introduced here.
const TAG =
  "font-data text-[9px] text-text-muted dark:text-text-secondary bg-parchment-mid border border-border-base px-1.5 py-0.5 rounded";

const GAP = 4; // gap-1 (0.25rem)
const PLUS_RESERVE = 24; // px reserved for the "+N" chip while more tags remain

/**
 * Theme tag cluster for the /company directory THEMES column.
 *
 * Shows as many WHOLE tags as fit the column, collapses the remainder into a
 * "+N" counter, and ellipsizes a single tag only as a last resort (one tag
 * genuinely wider than the column). Fit is width-measured because CSS alone
 * cannot do "as many whole tags as fit + an accurate +N": a flex row either
 * shrinks every tag into stubs, hard-clips mid-tag, or shows a fixed count.
 * The visible row stays clipped + min-w-0 so it never bleeds into MENTIONS.
 */
export function ThemeTags({ themes }: { themes: string[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  // Sensible SSR / first-paint value; refined to the measured fit after mount.
  const [shown, setShown] = useState(() => Math.min(themes.length, 2));

  useEffect(() => {
    const wrap = wrapRef.current;
    const measure = measureRef.current;
    if (!wrap || !measure || themes.length === 0) return;

    const recompute = () => {
      const avail = wrap.clientWidth;
      if (avail <= 0) return;
      const tags = measure.querySelectorAll<HTMLElement>("[data-measure-tag]");
      let used = 0;
      let n = 0;
      for (let i = 0; i < tags.length; i++) {
        const w = tags[i].getBoundingClientRect().width + (i > 0 ? GAP : 0);
        // Reserve room for the "+N" chip whenever tags remain after this one.
        const reserve = i < tags.length - 1 ? GAP + PLUS_RESERVE : 0;
        if (used + w + reserve <= avail) {
          used += w;
          n++;
        } else {
          break;
        }
      }
      setShown(n);
    };

    const ro = new ResizeObserver(recompute);
    ro.observe(wrap);
    recompute();
    // Tag widths depend on the mono webfont; re-measure once fonts settle.
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(recompute).catch(() => {});
    }
    return () => ro.disconnect();
  }, [themes]);

  if (themes.length === 0) {
    return <span className="font-data text-[10px] text-text-faint">--</span>;
  }

  const lastResort = shown === 0; // not even one whole tag fits the column
  const visible = lastResort ? themes.slice(0, 1) : themes.slice(0, shown);
  const moreCount = themes.length - visible.length;

  return (
    <div className="relative min-w-0">
      <div
        ref={wrapRef}
        data-testid="theme-tags"
        className="flex items-center gap-1 min-w-0 overflow-hidden"
      >
        {visible.map((t) => (
          <span
            key={t}
            className={`${TAG} ${lastResort ? "min-w-0 truncate" : "shrink-0 whitespace-nowrap"}`}
          >
            {t}
          </span>
        ))}
        {moreCount > 0 && (
          <span className="font-data text-[9px] text-text-faint shrink-0">
            +{moreCount}
          </span>
        )}
      </div>
      {/* Off-flow, invisible measurement layer: every tag at natural width. */}
      <div
        ref={measureRef}
        aria-hidden
        className="pointer-events-none invisible absolute left-0 top-0 flex gap-1"
      >
        {themes.map((t) => (
          <span key={t} data-measure-tag className={`${TAG} whitespace-nowrap`}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

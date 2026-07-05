"use client";

/**
 * useMotionSettled — one cohesive page entrance.
 *
 * Pages with multiple animated sections put data-motion-settling on
 * their wrapper until this flips true. While settling, globals.css
 * zeroes inner entrance animations (motion-rise-in / motion-stagger)
 * so the page-level motion-page-enter fades EVERYTHING in together —
 * no section trailing another. After the page enter finishes, inner
 * animations return to normal so view/filter switches (keyed
 * remounts) still animate.
 *
 * 650ms clears --duration-page (480ms) plus the longest stagger tail,
 * so nothing is caught mid-animation when the gate lifts.
 */

import { useEffect, useState } from "react";

const SETTLE_MS = 650;

export function useMotionSettled(): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, []);
  return settled;
}

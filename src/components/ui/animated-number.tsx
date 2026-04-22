"use client";

import { useEffect } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
} from "framer-motion";

export interface AnimatedNumberProps {
  /**
   * Target numeric value to animate to. If a string is passed, the component
   * will strip non-numeric characters and animate the parsed number, while
   * preserving the original string for formatting via `format`.
   */
  value: number | string;
  /**
   * Custom formatter. Receives the current interpolated numeric value.
   * Defaults to `Math.round(n).toString()`. If `value` is a pre-formatted
   * string, callers can pass `() => value` to preserve the formatted output
   * once the animation completes.
   */
  format?: (n: number) => string;
  /**
   * Animation duration target in ms. Used to configure spring stiffness.
   * Defaults to 600.
   */
  duration?: number;
  className?: string;
}

function parseNumeric(value: number | string): number {
  if (typeof value === "number") return value;
  const parsed = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * AnimatedNumber counts up from 0 to the target value on first mount using
 * framer-motion's spring-driven motion value. Respects
 * `prefers-reduced-motion` — renders the final value immediately with no
 * animation when the user prefers reduced motion.
 */
export default function AnimatedNumber({
  value,
  format,
  duration = 600,
  className,
}: AnimatedNumberProps) {
  const shouldReduceMotion = useReducedMotion();
  const target = parseNumeric(value);

  const formatter =
    format ??
    ((n: number) => Math.round(n).toString());

  // Map `duration` (ms) onto a spring stiffness/damping pair that settles in
  // roughly that window. Larger duration -> softer spring.
  // This gives an ease-out feel via framer-motion's critically-damped spring.
  const stiffness = Math.max(40, 600 - duration * 0.6);
  const damping = 30;

  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, {
    stiffness,
    damping,
    mass: 1,
  });
  const display = useTransform(spring, (latest) => formatter(latest));

  useEffect(() => {
    if (shouldReduceMotion) {
      motionValue.set(target);
      return;
    }
    motionValue.set(target);
  }, [target, shouldReduceMotion, motionValue]);

  if (shouldReduceMotion) {
    return <span className={className}>{formatter(target)}</span>;
  }

  return <motion.span className={className}>{display}</motion.span>;
}

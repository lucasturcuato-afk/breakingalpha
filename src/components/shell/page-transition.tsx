"use client";

import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

interface PageTransitionProps {
  children: ReactNode;
}

/**
 * Wraps route content with a fade + slide-up transition on pathname change.
 * Respects `prefers-reduced-motion` — when reduced, children render without
 * any motion wrapper.
 *
 * NOTE: We intentionally do NOT use `<AnimatePresence mode="wait">` here.
 * Under React 19 + Next 16 client-side navigation, `mode="wait"` keeps the
 * outgoing page mounted while it animates out and delays mounting the new
 * page until exit completes. That delayed mount intermittently caused the
 * new page's `useEffect` data fetches to fail to fire (the "blank brief
 * needs 2-3 reloads" bug on /morning-brief). A simple keyed `motion.div`
 * with no exit animation guarantees the destination page mounts immediately
 * on navigation, so its effects run on the first visit, every time.
 */
export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <>{children}</>;
  }

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="h-full"
    >
      {children}
    </motion.div>
  );
}

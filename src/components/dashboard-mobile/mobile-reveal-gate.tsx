"use client";

/**
 * The mobile Dashboard's reveal gate.
 *
 * WHAT IT FIXES. The briefing tree used to be withheld until every read had
 * answered: `dashboard-screen.tsx` takes an early exit to a skeleton when
 * `data === null`, and the page passed null until `mobileReady`. A CSS
 * entrance cannot start before the element it animates exists, so the ladder
 * fired at the moment the last read landed. Measured on the previous commit, Slow 4G, 390x844,
 * production build, signed in: the first `dashRise` rung started at 5662ms,
 * after roughly four seconds of skeleton.
 *
 * WHAT IT DOES INSTEAD, which is the discipline the DESKTOP gate already
 * follows (`dashboard-ready.tsx`): the real tree is MOUNTED and HIDDEN rather
 * than withheld. It is built from whatever has answered so far, every
 * unanswered read renders as an absence exactly as it always did, and the
 * whole subtree sits at `visibility: hidden` behind the skeleton until the
 * page says the payload is real.
 *
 * AND IT IS NOT THE DESKTOP GATE'S TRADE. Two differences, both deliberate.
 *
 *   1. `visibility`, not `opacity`. Desktop hides its tree with `opacity-0`,
 *      which leaves a briefing assembled from four unanswered reads sitting in
 *      the accessibility tree and in `innerText` where a screen reader will
 *      read it out. PR #675 ruled that content must never be legible, and it
 *      meant legible, not merely visible. `visibility: hidden` removes it from
 *      the a11y tree, from `innerText` and from hit testing in one move, and
 *      still lays the subtree out so the skeleton stacked over it is the right
 *      size. There is no window in which empty-looking content can be read.
 *
 *   2. The ladder is PAUSED while the gate is shut, not spent behind it. On
 *      desktop the entrance fires at 220ms on mount and is over long before
 *      the reveal, so the reader never sees it and the reveal is a bare
 *      opacity fade. Here `animation-play-state: paused` keeps every `.rise`
 *      and `.bar` at frame zero until the gate opens, so the stagger plays AS
 *      the skeleton clears. Not one delay, duration or curve is touched; only
 *      when the clock starts.
 *
 * THE MOUNT IS THE BREAKPOINT'S DECISION, NOT A CLASS'S. `md:hidden` is
 * `display:none`, which still mounts. The gate asks `useMobileViewport`, whose
 * server snapshot is false, so the server and the hydration render both emit
 * the same skeleton this route has always emitted and there is nothing for
 * hydration to disagree about. The briefing tree appears on the render after
 * hydration, on a phone only; a desktop load never mounts it at all.
 */

import { DashboardScreen } from "./dashboard-screen";
import { useMobileViewport } from "./use-mobile-viewport";
import styles from "./dashboard.module.css";
import type { DashboardData, DashStage } from "./fixture";

export function MobileRevealGate({
  revealed,
  stage,
  data,
}: {
  /**
   * Whether the payload is real enough to read. Resolved by the page, which is
   * the only place that knows which of its reads have answered. False keeps
   * the gate shut; it never keeps the tree from mounting.
   */
  revealed: boolean;
  stage: DashStage;
  /** REQUIRED and NULLABLE, exactly as the screen takes it. Never defaulted. */
  data: DashboardData | null;
}) {
  const isMobile = useMobileViewport();

  /* Server, and the hydration render on both sides of the breakpoint. The
     skeleton alone, which is what this route rendered here before. */
  if (!isMobile) return <DashboardScreen stage="loading" data={null} />;

  return (
    <div className={styles.gate} data-mobile-ready={revealed ? "true" : "false"}>
      <div className={revealed ? styles.gateOpen : styles.gateShut} aria-busy={!revealed}>
        <DashboardScreen stage={stage} data={data} />
      </div>
      {revealed ? null : <DashboardScreen stage="loading" data={null} />}
    </div>
  );
}

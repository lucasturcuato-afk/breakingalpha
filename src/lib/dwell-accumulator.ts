/**
 * dwell-accumulator.ts - the clock behind every attention primitive.
 *
 * Time-in-view is only meaningful when BOTH conditions hold at once:
 *   1. the region is intersecting the viewport, and
 *   2. the document is actually visible (the tab is foregrounded).
 *
 * Condition 2 is the one that is usually missing, and its absence is what makes
 * naive dwell metrics worthless. An IntersectionObserver keeps reporting a
 * region as intersecting after the user switches tabs or locks the phone, so an
 * abandoned tab silently accrues hours of "reading". Every number downstream
 * then reads as engagement when it is really neglect.
 *
 * This module is pure: no DOM, no timers, no React. The caller feeds it state
 * transitions with an explicit timestamp and reads back accrued milliseconds,
 * which makes the visibility gate directly testable rather than a claim in a
 * comment. See dwell-accumulator.test.ts.
 */

export interface DwellState {
  /** Region is intersecting the viewport past the caller's threshold. */
  inView: boolean;
  /** document.visibilityState === "visible". */
  pageVisible: boolean;
  /** Milliseconds banked from completed accruing runs. */
  accruedMs: number;
  /** Timestamp the current accruing run started, or null when not accruing. */
  runStartedAt: number | null;
  /** How many distinct accruing runs have started. Re-reads, not raw scrolls. */
  runs: number;
}

export function createDwellState(): DwellState {
  return { inView: false, pageVisible: true, accruedMs: 0, runStartedAt: null, runs: 0 };
}

/** The gate. Both conditions, no exceptions. */
export function isAccruing(s: DwellState): boolean {
  return s.inView && s.pageVisible;
}

/**
 * Bank whatever the current run has earned and stop the clock. Idempotent, so a
 * visibilitychange followed by an unmount does not double count.
 */
function bank(s: DwellState, now: number): void {
  if (s.runStartedAt === null) return;
  const delta = now - s.runStartedAt;
  // A negative delta means the clock moved backwards (a system time change).
  // Bank nothing rather than corrupt the total.
  if (delta > 0) s.accruedMs += delta;
  s.runStartedAt = null;
}

/** Start the clock if the gate is open and it is not already running. */
function resume(s: DwellState, now: number): void {
  if (!isAccruing(s) || s.runStartedAt !== null) return;
  s.runStartedAt = now;
  s.runs += 1;
}

/** Apply a transition and re-evaluate the gate. Returns the same object. */
function transition(s: DwellState, now: number): DwellState {
  if (isAccruing(s)) resume(s, now);
  else bank(s, now);
  return s;
}

export function setInView(s: DwellState, inView: boolean, now: number): DwellState {
  if (s.inView === inView) return s;
  s.inView = inView;
  return transition(s, now);
}

export function setPageVisible(s: DwellState, visible: boolean, now: number): DwellState {
  if (s.pageVisible === visible) return s;
  s.pageVisible = visible;
  return transition(s, now);
}

/** Total accrued time including the run in progress. Does not mutate. */
export function readMs(s: DwellState, now: number): number {
  if (s.runStartedAt === null) return s.accruedMs;
  const delta = now - s.runStartedAt;
  return delta > 0 ? s.accruedMs + delta : s.accruedMs;
}

/** Bank the open run and return the final total. Safe to call more than once. */
export function finalize(s: DwellState, now: number): number {
  bank(s, now);
  return s.accruedMs;
}

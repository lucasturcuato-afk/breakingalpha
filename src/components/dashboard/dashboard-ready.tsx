"use client";

/**
 * DashboardReady — one loading state for the whole dashboard.
 *
 * THE PROBLEM. Every dashboard data source is a client-side `useEffect` fetch in
 * its own component; there is no server-side data on the page. So panels popped
 * in one at a time as each resolved, over a measured spread of roughly 1.5s to
 * 8.7s on a cold dev server.
 *
 * THE CONTRACT.
 *   - Sources REGISTER themselves on mount and SETTLE when their first load
 *     finishes.
 *   - SETTLED MEANS RESOLVED **OR** FAILED. A source that 503s settles like any
 *     other and renders its own error/empty state inside the revealed page. A
 *     dead endpoint must never hold the page hostage.
 *   - FIRST SETTLE ONLY. `settle` is idempotent on a Set, so the rotating hero's
 *     refetch-on-rotation (measured: /api/watchlist-quotes 30x and
 *     /api/stock-chart 14x in a single load) cannot push the page back into
 *     loading.
 *   - HARD TIMEOUT. Past DASHBOARD_REVEAL_TIMEOUT_MS the page reveals with
 *     whatever is ready, no matter what is still outstanding.
 *
 * WHY THE CHILDREN STILL RENDER WHILE LOADING. The skeleton does not replace the
 * dashboard — it is layered over it. If the real tree were unmounted, the
 * sources would never mount, never fetch and never settle, and the gate would
 * deadlock into its own timeout every single load. Rendering the real tree
 * underneath also means the reveal is a visibility change, not a remount, so
 * there is no layout shift.
 *
 * REGISTRATION IS SEALED IN THIS PROVIDER'S MOUNT EFFECT. React runs child
 * effects before parent effects, so by the time the effect below fires, every
 * source that rendered in the first commit has already registered. Nothing
 * registered afterwards is waited on, which is what stops a late-mounting
 * conditional widget from re-opening the gate.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Hard ceiling on how long the dashboard is held back.
 *
 * 10s, deliberately a safety net rather than a routine path. Measured worst case
 * on a cold dev server was 8.7s (/api/system-intelligence), but those numbers
 * include Turbopack route compilation and are not production timings. Tighten
 * this once production is measured.
 */
export const DASHBOARD_REVEAL_TIMEOUT_MS = 10_000;

/** Why the page revealed. Exposed for tests and the dev-only debug attribute. */
export type RevealReason = "all-settled" | "timeout";

/**
 * The gate's whole decision, as a pure function so it can be tested without a
 * renderer.
 *
 * `settled` deliberately carries no notion of success. A source that resolved
 * and a source that threw both land in the same set, which is what makes a
 * failed panel unable to hold the page.
 */
export function allSourcesSettled(
  registered: ReadonlySet<string>,
  settled: ReadonlySet<string>,
): boolean {
  // Nothing registered: no work to wait for. Reveal rather than sitting out the
  // full timeout on a page with no live sources.
  if (registered.size === 0) return true;
  for (const id of registered) {
    if (!settled.has(id)) return false;
  }
  return true;
}

interface DashboardReadyValue {
  register: (id: string) => void;
  settle: (id: string) => void;
  isReady: boolean;
  reason: RevealReason | null;
}

const DashboardReadyContext = createContext<DashboardReadyValue | null>(null);

export function DashboardReadyProvider({ children }: { children: ReactNode }) {
  const registered = useRef<Set<string>>(new Set());
  const settledIds = useRef<Set<string>>(new Set());
  const sealed = useRef(false);
  // Mirrors `isReady` so the callbacks below can read it without being
  // re-created, which would otherwise restart the timeout on every settle.
  const readyRef = useRef(false);
  const settleTimes = useRef<Record<string, number>>({});

  const [isReady, setIsReady] = useState(false);
  const [reason, setReason] = useState<RevealReason | null>(null);

  const reveal = useCallback((why: RevealReason) => {
    if (readyRef.current) return;
    readyRef.current = true;
    setIsReady(true);
    setReason(why);
  }, []);

  const evaluate = useCallback(() => {
    if (readyRef.current || !sealed.current) return;
    // Nothing registered at all: there is no work to wait for. Reveal rather
    // than sitting on the timeout for 10s on a page with no live sources.
    if (allSourcesSettled(registered.current, settledIds.current)) {
      reveal("all-settled");
    }
  }, [reveal]);

  const register = useCallback((id: string) => {
    // Past the seal a late arrival is simply not waited on. It still renders;
    // it just cannot re-open a gate that has already been decided.
    if (sealed.current) return;
    registered.current.add(id);
  }, []);

  const settle = useCallback(
    (id: string) => {
      // Set semantics give first-settle-only for free: every later call from a
      // refetch is a no-op.
      if (settledIds.current.has(id)) return;
      settledIds.current.add(id);
      if (process.env.NODE_ENV !== "production") {
        settleTimes.current[id] = Math.round(performance.now());
      }
      evaluate();
    },
    [evaluate],
  );

  useEffect(() => {
    // Child effects have already run, so registration is complete.
    sealed.current = true;

    // Dev-only introspection. A reveal that lands on "timeout" when every
    // source finished well inside the budget means some source registered and
    // never settled; without this you are guessing which.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as Record<string, unknown>).__dashboardGate = {
        registered: () => [...registered.current],
        settled: () => [...settledIds.current],
        outstanding: () =>
          [...registered.current].filter((id) => !settledIds.current.has(id)),
        settleTimes: () => ({ ...settleTimes.current }),
      };
    }

    evaluate();

    const timer = setTimeout(() => reveal("timeout"), DASHBOARD_REVEAL_TIMEOUT_MS);
    return () => clearTimeout(timer);
    // Intentionally once: `evaluate` and `reveal` are stable, and re-running
    // this would restart the hard timeout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <DashboardReadyContext.Provider value={{ register, settle, isReady, reason }}>
      {children}
    </DashboardReadyContext.Provider>
  );
}

/**
 * Register one data source and get back its settle callback.
 *
 * Call `settle()` when the FIRST load finishes, in a `finally` so a rejection
 * settles too. Safe to call again; later calls are ignored.
 *
 * Returns a no-op outside a provider, so widgets shared with other pages
 * (Watchlist, Following, Daily Briefs all render elsewhere) are unaffected.
 */
export function useDashboardSource(id: string): () => void {
  const ctx = useContext(DashboardReadyContext);
  const register = ctx?.register;
  const settle = ctx?.settle;

  useEffect(() => {
    register?.(id);
  }, [register, id]);

  return useCallback(() => {
    settle?.(id);
  }, [settle, id]);
}

/** Read the reveal state. Null outside a provider. */
export function useDashboardReady(): { isReady: boolean; reason: RevealReason | null } {
  const ctx = useContext(DashboardReadyContext);
  return { isReady: ctx?.isReady ?? true, reason: ctx?.reason ?? null };
}

/**
 * Holds the dashboard behind one loading state and reveals it in one go.
 *
 * The children are ALWAYS mounted, only made invisible. That is load-bearing in
 * two ways: the sources cannot fetch (and therefore cannot settle) unless they
 * are mounted, and because the real tree already occupies its final space, the
 * reveal is an opacity change rather than a remount, so nothing shifts.
 *
 * The skeleton is layered over that same box, so it is by construction the same
 * size as the page it is standing in for.
 */
export function DashboardRevealGate({ children }: { children: ReactNode }) {
  const { isReady, reason } = useDashboardReady();

  return (
    <div
      className="relative"
      // Read by the browser check; also handy in devtools to see which path
      // the reveal took.
      data-dashboard-ready={isReady ? "true" : "false"}
      data-reveal-reason={reason ?? ""}
    >
      <div
        aria-busy={!isReady}
        className={
          isReady
            ? "opacity-100 transition-opacity duration-300 ease-out"
            : "opacity-0 pointer-events-none"
        }
      >
        {children}
      </div>

      {!isReady && <DashboardSkeleton />}
    </div>
  );
}

/**
 * Overlay skeleton. Absolutely positioned over the (invisible) real tree, so it
 * inherits the page's true height instead of guessing at one. No fixed heights:
 * the bars are sized in rems and the layout comes from the content underneath.
 */
function DashboardSkeleton() {
  return (
    <div
      // Mirrors the content wrapper's container classes (max-width + responsive
      // gutters) so the skeleton bars line up with the tiles they stand in for
      // instead of running edge to edge.
      className="absolute inset-0 z-10 max-w-[1440px] mx-auto px-6 md:px-12 py-6 md:py-8 flex flex-col gap-[18px]"
      role="status"
      aria-label="Loading dashboard"
      data-testid="dashboard-skeleton"
    >
      <SkeletonBar className="h-6 w-64" />
      <SkeletonBar className="h-10 w-96" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-[18px]">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonBar key={i} className="h-20" />
        ))}
      </div>
      <SkeletonBar className="h-40" />
      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-[18px]">
        <SkeletonBar className="h-72" />
        <SkeletonBar className="h-72" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.9fr] gap-[18px]">
        <SkeletonBar className="h-48" />
        <SkeletonBar className="h-48" />
      </div>
      <span className="sr-only">Loading your dashboard…</span>
    </div>
  );
}

function SkeletonBar({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-[color:var(--color-surface-raised,rgba(0,0,0,0.06))] ${className}`}
    />
  );
}

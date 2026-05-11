/**
 * LoadingState (PR-E3) -- Suspense fallback wrapper for the company-detail
 * route. Composes LoadingSkeleton (visual) with LoadingStatusChip (a11y
 * live-region announcer). Outer wrapper carries `role="status"` +
 * `aria-live="polite"` + `aria-busy="true"`, so the polite region picks
 * up the chip's stage label rotation. Wired via
 * `src/app/company/[id]/loading.tsx` (Next.js App Router file convention).
 */

import { LoadingSkeleton } from "./LoadingSkeleton";
import { LoadingStatusChip } from "./LoadingStatusChip";

export function LoadingState() {
  return (
    <div
      data-testid="company-loading-state"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading company intel"
      className="relative"
    >
      <div className="absolute right-4 top-4 z-10">
        <LoadingStatusChip />
      </div>
      <LoadingSkeleton />
    </div>
  );
}

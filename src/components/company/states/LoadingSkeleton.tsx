/**
 * LoadingSkeleton (PR-E3) -- visual scaffold mirroring CompanyDetailLayout
 * slot order: header strip + alias ribbon + KPI 4-tile row + tabs strip,
 * followed by the 1.55fr / 1fr grid (left brief, right rail). All bars are
 * decorative (`aria-hidden`); live-region announcement is owned by
 * LoadingStatusChip in the parent.
 */

import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

export function LoadingSkeleton() {
  return (
    <div
      data-testid="company-loading-skeleton"
      aria-hidden="true"
      className="flex flex-col gap-[14px] bg-cream p-4"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-3 w-40" />
        </div>
        <Skeleton className="h-7 w-24" />
      </div>
      <Skeleton className="h-5 w-3/4" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border-base bg-white p-3 space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
      <div className="flex gap-2 border-b border-border-base pb-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-16" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.55fr_1fr] items-start">
        <div className="rounded-2xl border border-border-base bg-white p-5 space-y-4">
          <Skeleton className="h-4 w-32" />
          <SkeletonText lines={3} />
          <Skeleton className="h-4 w-28" />
          <SkeletonText lines={4} />
        </div>
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-border-base bg-white p-4 space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-24 w-full" />
          </div>
          <div className="rounded-2xl border border-border-base bg-white p-4 space-y-3">
            <Skeleton className="h-4 w-20" />
            <SkeletonText lines={3} />
          </div>
        </div>
      </div>
    </div>
  );
}

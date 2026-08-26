export { DashboardScreen } from "./dashboard-screen";
export { MobileDashboardRoute } from "./dashboard-route";
export { BriefingSplash } from "./briefing-splash";
/* The four-bucket grid. The Prepared record, the Entry screen and the Desk
   record all draw it later; it is exported so none of them builds a third. */
export { RecordBuckets } from "./record-buckets";
export type { RecordVariant } from "./record-buckets";
/* The gate ships from its own module, and the sample data is NOT re-exported
   here at all. A barrel that hands out both is how a client component ends up
   importing invented prose it can never paint; `dashboard-route.tsx` reaches
   the fixture through a dynamic import instead, and nothing else reaches it. */
export { DASH_FIXTURES_ALLOWED } from "./fixture-gate";
export { buildDashboardData } from "./from-dashboard";
export type { DashboardSources, DashQuote, DashSourceStory } from "./from-dashboard";
export { useMobileRecords, MOBILE_READ_BUDGET_MS } from "./use-mobile-records";
export type { MobileRecords } from "./use-mobile-records";
export { useArrivalBudget, useMobileMinute, MOBILE_MEDIA_QUERY } from "./use-mobile-viewport";
export type {
  DashboardData,
  DashMarketCell,
  DashRecordCounts,
  DashStage,
  DashStory,
} from "./fixture";

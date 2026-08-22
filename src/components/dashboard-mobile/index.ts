export { DashboardScreen } from "./dashboard-screen";
export { MobileDashboardRoute } from "./dashboard-route";
export { BriefingSplash } from "./briefing-splash";
/* The four-bucket grid. The Prepared record, the Entry screen and the Desk
   record all draw it later; it is exported so none of them builds a third. */
export { RecordBuckets } from "./record-buckets";
export type { RecordVariant } from "./record-buckets";
export { DASH_FIXTURE, DASH_FIXTURE_EMPTY } from "./fixture";
export type {
  DashboardData,
  DashMarketCell,
  DashRecordCounts,
  DashStage,
  DashStory,
} from "./fixture";

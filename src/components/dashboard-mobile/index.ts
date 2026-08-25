export { DashboardScreen } from "./dashboard-screen";
export { MobileDashboardRoute } from "./dashboard-route";
export { BriefingSplash } from "./briefing-splash";
/* The four-bucket grid. The Prepared record, the Entry screen and the Desk
   record all draw it later; it is exported so none of them builds a third. */
export { RecordBuckets } from "./record-buckets";
export type { RecordVariant } from "./record-buckets";
/* The gate ships from the same line as the thing it gates. The splash was
   ungated because it imported the fixture and not the constant deciding
   whether the fixture may be seen; anything reaching for DASH_FIXTURE through
   this barrel gets DASH_FIXTURES_ALLOWED in the same import statement. */
export { DASH_FIXTURE, DASH_FIXTURE_EMPTY, DASH_FIXTURES_ALLOWED } from "./fixture";
export type {
  DashboardData,
  DashMarketCell,
  DashRecordCounts,
  DashStage,
  DashStory,
} from "./fixture";

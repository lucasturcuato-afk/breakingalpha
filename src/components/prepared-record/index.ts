export { RecordScreen } from "./record-screen";
export type { RecordStage } from "./record-screen";
export { RecordEntryRow } from "./record-entry-row";
export type { RecordEntryRowProps } from "./record-entry-row";
export { RecordMonthRule } from "./record-month-rule";
export type { RecordMonthRuleProps } from "./record-month-rule";
export { BackChevron } from "./back-chevron";
/* `./fixture` is NOT re-exported here. This barrel is reachable from the
   client graph through `record-screen`, so re-exporting the sample entries
   would put forty-one invented claims back in the browser bundle. The server
   page imports `./fixture` by path instead. The gate and the content-free
   shape are safe to cross the boundary; the entries are not. */
export { RECORD_FIXTURE_ENABLED } from "./fixture-gate";
export { RECORD_UNAVAILABLE, countsByState, groupByMonth, longDate } from "./record-data";
export type { RecordData, RecordEntry, RecordMonth } from "./record-data";

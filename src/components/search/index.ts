export { SearchScreen } from "./search-screen";
export type { SearchStage } from "./search-screen";
export {
  SearchAskTheDesk,
  SearchCompanyRow,
  SearchDealRow,
  SearchEyebrow,
  SearchField,
  SearchGroup,
  SearchJumpRow,
  SearchLedgerResult,
  PAD,
} from "./search-parts";
/* `./fixture` is NOT re-exported here. This barrel is reachable from the
   client graph through `search-screen`, so re-exporting the invented result
   set would put it back in the browser bundle. The server page imports
   `./fixture` by path instead. The jump list, the matcher and the shape carry
   no invented content and are safe to cross the boundary. */
export { SEARCH_FIXTURE_ENABLED } from "./fixture-gate";
export { JUMP_GROUPS, isEmptyResult, matchFixture } from "./search-data";
export type {
  CompanyResult,
  DealResult,
  JumpGroup,
  JumpRow,
  LedgerResult,
  SearchFixture,
} from "./search-data";

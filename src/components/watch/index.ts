export { WatchScreen } from "./watch-screen";
export type { WatchStage } from "./watch-screen";
/* The section rule is the layout spine of Watch and of the two thesis screens
   beside it. Exported so those units consume it rather than forking it. */
export { SectionRule } from "./section-rule";
export type { SectionRuleProps } from "./section-rule";
export { WatchNotice, WatchSkeleton } from "./watch-notice";
export { WATCH_FIXTURE } from "./fixture";
export { WATCH_RECENCY_DAYS } from "./recency";
/* What the screen does not draw, and why, as rendered copy. Exported because
   the reasons are product copy rather than screen-local detail; the screen is
   the only consumer today. */
export { WATCH_OMISSIONS } from "./omissions";
export type { WatchOmission } from "./omissions";
export type {
  WatchData,
  WatchLens,
  WatchlistItem,
  WatchlistKind,
  WatchQuote,
  WatchQuotes,
  TierRead,
  /* Exported although the tier is not drawn. It is the contract tracked views
     would need, and `fixture.ts` records why the rows to fill it do not exist.
     The earlier note here, that `headline` had no source, is retracted. */
  TrackedView,
  FollowCluster,
  FollowRow,
} from "./fixture";

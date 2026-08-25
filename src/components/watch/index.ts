export { WatchScreen } from "./watch-screen";
export type { WatchStage } from "./watch-screen";
/* The section rule is the layout spine of Watch and of the two thesis screens
   beside it. Exported so those units consume it rather than forking it. */
export { SectionRule } from "./section-rule";
export type { SectionRuleProps } from "./section-rule";
export { WatchNotice, WatchSkeleton } from "./watch-notice";
export { WATCH_FIXTURE, WATCH_EMPTY } from "./fixture";
export { WATCH_RECENCY_DAYS } from "./recency";
export type {
  WatchData,
  WatchLens,
  WatchlistItem,
  WatchlistKind,
  TrackedView,
  FollowCluster,
  FollowRow,
} from "./fixture";

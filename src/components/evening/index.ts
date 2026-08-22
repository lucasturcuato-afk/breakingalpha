/* The mobile Evening Wrap.
 *
 * The ticker strip is NOT here. It is built once in `src/components/ledger`
 * and this screen imports it, which is what that barrel's own comment says.
 * A second ticker would be a defect. */
export { EveningWrapScreen } from "./evening-wrap-screen";
export type { WrapStage } from "./evening-wrap-screen";
export { EveningWrapMobile } from "./evening-wrap-mobile";
export { EVENING_FIXTURE, CLOSE_VISIBLE_PARAGRAPHS } from "./fixture";
export type {
  EveningWrapData,
  EveningStat,
  EveningMover,
  EveningReviewedCall,
  ScorecardCell,
} from "./fixture";

/* The mobile Evening Wrap.
 *
 * The ticker strip is NOT here. It is built once in `src/components/ledger`
 * and this screen imports it, which is what that barrel's own comment says.
 * A second ticker would be a defect. */
export { CLOSE_VISIBLE_PARAGRAPHS, EveningWrapScreen } from "./evening-wrap-screen";
export type { WrapStage } from "./evening-wrap-screen";
export { EveningWrapMobile } from "./evening-wrap-mobile";
/* The sample wrap is NOT re-exported here. Nothing outside `./fixture` ever
   consumed it, and a barrel that hands out prose beside a client component is
   how the prose ends up in `.next/static`: `evening-wrap/page.tsx` is a client
   page, so every value this barrel offers is a candidate for its chunk.
   `EveningWrapMobile` reaches the sample through a dev-only dynamic import. */
export type {
  EveningWrapData,
  EveningStat,
  EveningMover,
  EveningReviewedCall,
  ScorecardCell,
} from "./fixture";

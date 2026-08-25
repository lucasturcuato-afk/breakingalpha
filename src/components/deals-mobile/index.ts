/**
 * The client-safe surface of the mobile Deal Flow screen.
 *
 * `./fixture` is NOT re-exported here and must not be. It is `server-only`, and
 * a barrel that names it would put invented deals about real companies back
 * into the client bundle for every file that imports anything from this
 * directory. Import `dealsFixture` straight from `./fixture`, from a server
 * component, which is the only place it resolves.
 *
 * The types below come from `./types`, which carries no data, and
 * `export type` is erased at compile time.
 */
export { DealsScreen, type DealsScreenProps, type DealsStatus } from "./deals-screen";
export { DealRow } from "./deal-row";
export { FilterChipRow, type FilterChip } from "./filter-chip-row";
export { DealsFixtureProvider, useDealsFixture } from "./fixture-context";
export type { MobileDeal, DealsFixture } from "./types";
export {
  DEAL_STAGES,
  DEAL_LENSES,
  STAGE_LABEL,
  STAGE_INK,
  resolveStage,
  isDealLens,
  lensResultLine,
  type DealStage,
  type DealLens,
} from "./deal-stage";

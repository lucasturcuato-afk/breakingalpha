export { ComposeScreen } from "./compose-screen";
/* `./fixture` is NOT re-exported here. This barrel is reachable from the
   client graph through `compose-screen`, so re-exporting the invented draft,
   note and proposals would put them back in the browser bundle. The server
   page imports `./fixture` by path instead. Everything below is content-free
   and safe to cross the boundary. */
export { COMPOSE_FIXTURE_ENABLED } from "./fixture-gate";
export {
  COMPOSE_ANCHOR_ISO,
  COMPOSE_STAGES,
  COMPOSE_DEFAULT_HORIZON,
  COMPOSE_HORIZONS,
  EMPTY_SEED,
  longDate,
  settlementDate,
} from "./compose-data";
export type {
  ComposeAlternative,
  ComposeProposal,
  ComposeSeed,
  ComposeStage,
  Direction,
} from "./compose-data";

export { TrendsScreen, type TrendsPreview, type TrendsStage } from "./trends-screen";
export { TrendSignalCard } from "./trend-signal-card";
export { LEVEL_TONES, type LevelTone } from "./trend-level-tone";
/* `./fixture` is NOT re-exported here. The barrel is reachable from the client
   graph through `trends-screen`, so re-exporting the rows would put the
   invented cluster prose back in the browser bundle. The gate is content-free
   and safe to cross the boundary; the rows are not. */
export { FIXTURE_ALLOWED } from "./fixture-gate";

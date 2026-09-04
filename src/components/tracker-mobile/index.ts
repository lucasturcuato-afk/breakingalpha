/* The evidence tracker's two mobile screens, and the model both read.
 *
 * A barrel, not a second place to write anything. Both pages import from here
 * so a screen that moves file does not move every call site with it. */
export { TrackerScreen, type TrackerScreenData } from "./tracker-screen";
export { ThesisScreen, type ThesisScreenData, type ThesisStage } from "./thesis-screen";
export {
  isStale,
  type TrackerReview,
  type TrackerStage,
  type TrackerThesis,
} from "./tracker-model";

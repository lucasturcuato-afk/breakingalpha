export { AskBrowseScreen } from "./ask-browse-screen";
export type { AskStage } from "./ask-browse-screen";
export { AskAnswerScreen } from "./ask-answer-screen";
export { AskComposer } from "./ask-composer";
export {
  AskDirectoryRow,
  AskLookupRow,
  AskNotice,
  AskSectionRule,
  AskSkeleton,
} from "./ask-parts";
/* `./fixture` is NOT re-exported here. `ask-composer` is a client component
   and this barrel sits above it, so re-exporting the invented answer would put
   it one careless import away from the browser bundle. The server page imports
   `./fixture` by path instead. Everything below is invented nothing. */
export { ASK_FIXTURE_ENABLED } from "./fixture-gate";
export { ASK_DIRECTORY, EMPTY_KB_ANSWER, SUGGESTED_PROMPTS } from "./ask-data";
export type { AskBrowseData, AskAnswerData, AskLookup, AnswerBlock } from "./ask-data";

export { AskDirectoryScreen } from "./ask-directory-screen";
export {
  AskAnswerNotice,
  AskDestinationRow,
  AskLookupRow,
  AskNotice,
  AskSectionRule,
} from "./ask-parts";
export {
  ASK_DIRECTORY,
  ASSISTANT_HREF,
  ASSISTANT_LABEL,
  CHIP_PROMPTS,
  SUGGESTED_PROMPTS,
} from "./ask-data";
export type { AskDirectoryRoute, DirectoryId } from "./ask-data";
export type { AskDestinationCount } from "./ask-parts";
/* `./fixture` and `./fixture-gate` are GONE, and the note they used to carry
   here goes with them. The barrel warned that re-exporting the fixture would
   put an invented answer one careless import away from the browser bundle.
   There is no invented answer any more: the answer screen is deleted, and the
   three destination figures are real reads in `src/lib/ask-counters.ts`. There
   is nothing left on this screen for a gate to guard. */

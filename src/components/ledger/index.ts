export { Chevron } from "./chevron";
export type { ChevronDirection } from "./chevron";
/* The Evening Wrap draws the same strip. It imports this rather than building
   a second one; the design carries one ticker, not two. */
export { MobileTickerStrip } from "./mobile-ticker-strip";
export type { TickerCell } from "./mobile-ticker-strip";
export { ClaimAnatomy, OutcomeLead, OUTCOME_STATES, OUTCOME_TOKENS } from "./claim-anatomy";
export type { ClaimAnatomyProps, ClaimScale, OutcomeState } from "./claim-anatomy";
export { LedgerClaimCard } from "./ledger-claim-card";
export type { LedgerClaimCardProps, ClaimCardVariant } from "./ledger-claim-card";
export { LedgerEntryRow } from "./ledger-entry-row";
export type { LedgerEntryRowProps } from "./ledger-entry-row";
export { LedgerDateRule } from "./ledger-date-rule";
export type { LedgerDateRuleProps } from "./ledger-date-rule";
export { LedgerScreen } from "./ledger-screen";
export type { BriefStage } from "./ledger-screen";
/* LEDGER_FIXTURE is deliberately NOT re-exported here, and the type exports
   below are types only, so nothing in this barrel carries fixture prose.
   Six client components import Chevron, ClaimAnatomy, OUTCOME_TOKENS and
   friends from this file, and a value export of the fixture pulled the whole
   module into their graph: the prose measured in .next/static whether or not
   the gate could ever let it paint. Import the fixture by path, from a server
   component, the way src/app/ledger/page.tsx does. */
export type { LedgerData, LedgerClaim, LedgerEntry, LedgerDay } from "./fixture";

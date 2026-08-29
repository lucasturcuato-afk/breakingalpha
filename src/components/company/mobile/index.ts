export { CompanyIntelScreen } from "./company-intel-screen";
/* NOTHING WITH A VALUE IN IT MAY BE ADDED HERE. This barrel is reachable from
   the client graph through `company-intel-screen`, so anything it re-exports is
   DOWNLOADED by every reader of the screen whether or not it renders. That is
   how `./fixture` put an invented income statement and invented Form 4 rows
   into `.next/static` on a production build where the gate meant they could
   never paint. That module is deleted; the rule it earned is not. Types erase
   at compile time, so a type re-export is free and is the only kind here. */
export type { CompanyIntelData } from "./types";

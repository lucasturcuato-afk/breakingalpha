export { CompanyIntelScreen } from "./company-intel-screen";
export type { CompanyStage } from "./company-intel-screen";
/* `./fixture` is NOT re-exported here. This barrel is reachable from the
   client graph through `company-intel-screen`, so re-exporting the invented
   company would put it back in the browser bundle. The server page imports
   `./fixture` by path instead. Types erase, so the shape is safe. */
export type { CompanyIntelData } from "./types";

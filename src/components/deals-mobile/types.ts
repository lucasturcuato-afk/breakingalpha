import type { DealStage } from "./deal-stage";

/**
 * The shape the mobile Deal Flow card draws, and nothing else.
 *
 * This module exists so `fixture.ts` can be server-only. The screen and the row
 * both need the TYPE, and a type import is erased at compile time, but until
 * this file existed the type lived beside the invented data in `fixture.ts`, so
 * importing it dragged the whole fixture module into the client graph. That is
 * how four fabricated transactions about real public companies ended up
 * readable in `.next/static/chunks/`. Keep data out of this file.
 */
export interface MobileDeal {
  id: string;
  stage: DealStage;
  /** The figure on the stage baseline. `deal_flow.valuation` in production. */
  figure: string | null;
  /** The Playfair line. The whole card's headline. */
  claim: string;
  /** One line of prose under the claim. `deal_flow.thesis` in production. */
  rationale: string;
  /** The monospace slug. Already in the case it renders in. */
  slug: string;
}

/**
 * What the server hands the client when, and only when, the fixture is
 * permitted. `null` in production, which is the whole gate: with no object
 * there is no invented deal to draw and no lifecycle override to honour.
 */
export interface DealsFixture {
  deals: MobileDeal[];
  counts: Record<string, number>;
}

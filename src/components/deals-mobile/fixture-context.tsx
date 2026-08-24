"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { DealsFixture } from "./types";

/**
 * How the design's invented deals reach the mobile screen without being in the
 * client bundle.
 *
 * `/deal-flow` is a client component and cannot import `./fixture`, which is
 * `server-only`. The route's `layout.tsx` IS a server component, so it calls
 * `dealsFixture()` there and puts the RESULT through this provider. Only the
 * result crosses the boundary: an object in development and on a preview, and
 * `null` in production, where the strings themselves were never bundled.
 *
 * This file is the boundary and carries no data. It must stay that way.
 *
 * A context rather than a page prop because a layout cannot pass props to the
 * page it wraps. It also keeps the read where it is used: only `DealFlowMobile`
 * calls the hook, so the desktop tree is untouched by any of this.
 */
const DealsFixtureContext = createContext<DealsFixture | null>(null);

export function DealsFixtureProvider({
  value,
  children,
}: {
  value: DealsFixture | null;
  children: ReactNode;
}) {
  return <DealsFixtureContext.Provider value={value}>{children}</DealsFixtureContext.Provider>;
}

/**
 * The fixture, or `null`. `null` is production and is also the default, so a
 * component rendered outside the provider gets the safe answer rather than a
 * crash or a fixture.
 */
export function useDealsFixture(): DealsFixture | null {
  return useContext(DealsFixtureContext);
}

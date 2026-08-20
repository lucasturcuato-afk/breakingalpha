"use client";

/**
 * CompanyMissState -- the whole miss branch of /company/[id], in one place.
 *
 * src/app/company/[id]/page.tsx used to render CompanyAutoResolve and
 * EmptyState as siblings. They were describing the same lookup and disagreeing
 * about it: EmptyState asserted, at server render, that the company was not on
 * Signalera, while CompanyAutoResolve was still asking whether it was. Two
 * visible consequences:
 *
 *  1. A name that DOES resolve (four of the eight private controls we probed,
 *     including SpaceX and Anthropic) flashed "isn't on Signalera yet" for the
 *     length of a Finnhub round trip before navigating to its own page.
 *  2. On a 5xx the reader got the retry banner AND the no-coverage line at the
 *     same time, which cannot both be true.
 *
 * The wrapper exists to own the one piece of shared state, the lookup phase,
 * that makes those two agree. page.tsx is a server component and cannot pass a
 * setter, so the composition has to live on the client side of the boundary.
 * CompanyAutoResolve still owns the request; this owns nothing but the phase.
 *
 * Initial phase is "checking" because that is what is true at server render:
 * the lookup has not run. See company-miss-copy.ts for what each phase says.
 */

import { useState } from "react";

import { CompanyAutoResolve } from "./CompanyAutoResolve";
import { EmptyState } from "./EmptyState";
import type { ResolvePhase } from "./company-miss-copy";

interface Props {
  /** The slug-derived company name. Doubles as the lookup query and as the
   *  name shown to the reader, which is what page.tsx passed to both children
   *  before. */
  query: string;
}

export function CompanyMissState({ query }: Props) {
  const [phase, setPhase] = useState<ResolvePhase>("checking");

  return (
    <>
      {/* setPhase is referentially stable, so `attempt` inside
          CompanyAutoResolve keeps its identity and the fetch effect does not
          re-run. */}
      <CompanyAutoResolve query={query} onPhaseChange={setPhase} />
      <EmptyState canonical={query} phase={phase} />
    </>
  );
}

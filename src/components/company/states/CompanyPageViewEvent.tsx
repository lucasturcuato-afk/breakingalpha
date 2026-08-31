"use client";

/**
 * CompanyPageViewEvent -- renders nothing, emits one `company.page.viewed`.
 *
 * THE SEAM, AND WHY IT IS THIS ONE. `/company/[id]/page.tsx` is a server
 * component and `track-event.ts` is a client helper, so something has to cross
 * the boundary. The options were a client hook inside an existing client child,
 * a server side insert, or an invisible client component fed by props. This is
 * the third, and it is the pattern the SAME route already uses twice:
 * `CompanyAutoResolve` and `CompanyMemoModalListener` are both invisible client
 * components mounted from this server tree with server resolved facts as props.
 *
 * The other two were rejected for reasons, not taste. A server side insert
 * would put a database write on the render path of the page it is measuring,
 * which is the one thing the brief rules out. A hook inside an existing client
 * child would tie the event's lifetime to whichever child happened to host it,
 * and the miss branch has no such child that both branches share.
 *
 * RENDER IS NOT BLOCKED, BY CONSTRUCTION RATHER THAN BY CARE HERE. The work
 * happens in an effect, so it is after paint; and `trackClientEvent` states its
 * own contract at the top of `track-event.ts`: nothing in it throws, awaits or
 * blocks a render, every entry point is wrapped, and the flush is fire and
 * forget. This component adds no await, no state and no DOM. It returns null.
 *
 * The payload, the dedupe key and the flush urgency are all decided in
 * `src/lib/company-events.ts` so they are unit testable without a browser.
 * Nothing about them is restated here.
 */

import { useEffect } from "react";

import {
  COMPANY_PAGE_VIEWED,
  companyPageViewImmediate,
  companyPageViewOnceKey,
  companyPageViewPayload,
  type CompanyPageViewInput,
} from "@/lib/company-events";
import { trackClientEvent } from "@/lib/track-event";

export function CompanyPageViewEvent(props: CompanyPageViewInput) {
  const { slug, query, companyId, outcome, articleCount } = props;

  useEffect(() => {
    const input: CompanyPageViewInput = { slug, query, companyId, outcome, articleCount };
    trackClientEvent(COMPANY_PAGE_VIEWED, companyPageViewPayload(input), {
      // entity_type / entity_id are dedicated columns on user_events, so the
      // resolved row stays queryable across event names rather than only
      // inside this one payload shape. Absent on the miss branch, where there
      // is no row: an entity id invented for a company that did not resolve
      // would be the one lie this dataset cannot afford.
      entity_type: "company",
      entity_id: companyId ?? undefined,
      once: companyPageViewOnceKey(input),
      immediate: companyPageViewImmediate(input),
    });
  }, [slug, query, companyId, outcome, articleCount]);

  return null;
}

/**
 * calls-desk-destination.ts - where a phone reader who asked for /radar/calls
 * is actually sent.
 *
 * WHY THIS IS A MODULE AND NOT THREE LINES IN AN EFFECT. Five desk routes
 * already redirect to their phone twins, and that mechanism navigates with
 * `router.replace(twin)` against a bare path literal: it reads `usePathname()`,
 * which by definition carries no query, and every value in its table is a plain
 * string. None of its five source routes reads a query param, so the loss is
 * invisible there. `/radar/calls` reads FOUR, so the loss would be the whole
 * story here, and the same batch wrote that reason down in
 * `src/components/search/search-data.ts` as its reason for leaving this route
 * alone. This module is what makes the redirect safe to do anyway.
 *
 * THE FOUR PARAMS THE DESK READS, all in `src/app/radar/calls/page.tsx`
 * lines 145-155, and what each one does there:
 *
 *   ?adopt=<id>     a `morning_brief_calls` id. Scrolls that call into view and
 *                   rings it so its track control is unmistakable. This is the
 *                   Morning Brief email CTA, built by `callDestination` in
 *                   `src/lib/auth-redirect.ts`, and it is the only one of the
 *                   four that arrives from OUTSIDE the app.
 *   ?draft=<text>   prefills the authoring composer with the reader's words,
 *                   truncated at 400 chars. Produced by `makeCallLink` from six
 *                   call sites, two of which (`dashboard/story-card.tsx`,
 *                   `components/feed/feed-row.tsx`) are reachable on a phone.
 *   ?thesis=<id>    opens one tracked view inline inside `TrackedViews`.
 *   ?views=open     opens the tracked views section.
 *
 * ONE ARRIVAL, ONE SCREEN. On the desk all four can apply to the same render,
 * because the desk draws the list, the composer and the tracked views in one
 * scroll. A phone gives each of those intents its own screen, so an arrival
 * carrying more than one has to pick, and the order below is the pick. In
 * practice nothing emits two of them together: the four producers are disjoint.
 *
 * `?adopt` FIRST, matching `postAuthDestination` in `src/lib/auth-redirect.ts`,
 * and for the reason that module gives: it is what the email actually sends.
 * `?draft` second, because it is the only one of the four carrying text that
 * exists nowhere else once it is dropped. `?thesis` before `?views` because it
 * is the more specific of the two.
 *
 * THE FRAGMENT IS DROPPED, DELIBERATELY. The email CTA is
 * `/radar/calls?adopt=<id>#call-<id>`, where the anchor names one row inside a
 * list. `/claim/<id>` IS that one call and has no list to scroll, so there is
 * no element for the anchor to name. Carrying it forward would put a fragment
 * on a page with no matching id, which is not preservation.
 *
 * Pure. No React, no DOM, no fetch, no Supabase, so the per-param proof in
 * `tests/unit/calls-desk-destination.test.ts` needs no browser.
 */

/** Radar's Calls section on a phone. The default arrival with no query. */
export const CALLS_TWIN = "/watch/calls";

/**
 * Ids are uuids. Validating before interpolating keeps arbitrary text out of
 * both the path and the query we build. Copied in shape from
 * `src/lib/auth-redirect.ts`, which validates the same ids for the same reason.
 */
const ID = /^[A-Za-z0-9][A-Za-z0-9-]{5,63}$/;

/** The desk truncates at 400 (`page.tsx:147`). Same number, same reason. */
const DRAFT_MAX = 400;

export function callsDeskDestination(search: string): string {
  const params = new URLSearchParams(search || "");

  /* THE COMMIT SURFACE. `/claim/[id]` takes a `morning_brief_calls` id, which
     is exactly what `?adopt=` carries, it mounts `CommitSheetProvider`, and it
     is already where this screen's own brief rows link. So the phone honours
     the email CTA on a screen built for one call rather than approximating it
     on a list. A malformed id degrades to the section rather than building
     `/claim/<garbage>`, which is the same degrade `postAuthDestination` makes. */
  const adopt = params.get("adopt");
  if (adopt && ID.test(adopt)) return `/claim/${encodeURIComponent(adopt)}`;

  /* THE COMPOSER. `/compose` is the phone screen for authoring: it POSTs to
     `/api/radar/claims/author` and `/api/radar/claims`, the same two routes the
     desk posts to, and `src/components/ledger/ledger-screen.tsx` records the
     gate that used to stop this repointing being satisfied. */
  const draft = params.get("draft");
  if (draft && draft.trim()) {
    return `/compose?draft=${encodeURIComponent(draft.slice(0, DRAFT_MAX))}`;
  }

  /* TRACKED VIEWS. The section is not drawn on a phone and this unit could not
     ship it (see the PR). Both params are carried anyway, because the twin
     names the absence when it is asked for one and says nothing when it is
     not. A dropped param would turn that into silence in both cases. */
  const thesis = params.get("thesis");
  if (thesis && ID.test(thesis)) {
    return `${CALLS_TWIN}?thesis=${encodeURIComponent(thesis)}`;
  }
  if (params.get("views") === "open") return `${CALLS_TWIN}?views=open`;

  return CALLS_TWIN;
}

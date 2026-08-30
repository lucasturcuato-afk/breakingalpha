/**
 * The one rule a back chevron obeys, in a module a test can import.
 *
 * WHY THIS IS NOT INSIDE `screen-chrome.tsx`. That file is the natural home,
 * and it cannot be the tested one: it is a `"use client"` module that imports
 * `next/link` and `./mobile.module.css`, and a CSS module import throws under
 * `tsx --test`. So the decision lives here as a plain function and the header
 * calls it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IT DECIDES, AND THE ONE THAT LOOKED RIGHT AND EJECTED THE READER.
 *
 * The first build of this file asked `window.history.length > 1`, copying
 * `search-screen.tsx:157-161`. That asks whether A history exists. It does not
 * ask whether the history is OURS, and the difference is a reader leaving
 * Signalera entirely. Measured on a production build, tightest form:
 *
 *   about:blank -> location.replace to a foreign origin (history.length = 1)
 *   -> click a shared link to /trends-mobile   (history.length = 2)
 *   -> tap the chevron                         -> http://localhost:39311/
 *
 * Reproduced identically on /live-feed and /deal-flow. That is every reader
 * arriving from Slack, iMessage, email or a search result, which are exactly
 * the routes people share links through, and it is STRICTLY WORSE than the
 * always-/ask behaviour it replaced: a lateral jump is a wrong room, an
 * ejection is a wrong building.
 *
 * `history.length` cannot be repaired into the right question. It counts
 * entries that existed before we did, and it NEVER DECREASES when the reader
 * goes back. Measured, same build:
 *
 *   foreign origin -> /trends-mobile  length 3 after one in-app hop
 *   -> chevron -> /trends-mobile      length STILL 3, and we are now at the
 *                                     entry point with nothing of ours behind
 *
 * A length test says "go back" both times. The second one ejects.
 *
 * THE PROPERTY WE ACTUALLY NEED is "is there a page of OURS behind this one",
 * and the Navigation API answers exactly that and nothing else.
 * `navigation.entries()` is, by spec, the slice of this tab's session history
 * that is SAME-ORIGIN AND CONTIGUOUS with the current entry, so a foreign
 * referrer is not in it. `currentEntry.index` is our position in that slice, so
 * index 0 means "we are the first page of ours in this tab" whether the reader
 * arrived cold, from Slack, or walked back to it. Measured on the same runs:
 *
 *   arrived from foreign origin      index 0  entries ["/trends-mobile"]
 *   after one in-app hop             index 1  entries ["/trends-mobile","/deal-flow"]
 *   after stepping back to the entry index 0  entries unchanged
 *   cold entry, history.length === 1 index 0  entries ["/trends-mobile"]
 *   hard reload mid-session          index 1  entries survive the reload
 *
 * WHEN THE API IS ABSENT WE DO NOT GUESS. `readAppHistory` returns undefined
 * and the control falls through to its `href`. That is the pre-existing PR 740
 * behaviour: a lateral jump, never an ejection. Degrading to the wrong room
 * rather than the wrong building is the whole point.
 */

/** Our own slice of this tab's history: same-origin, contiguous, ours. */
export interface AppHistory {
  /** Position within that slice. 0 means this is the first page of ours. */
  index: number;
}

/**
 * Step back only when a page of OURS is behind this one.
 *
 * A negative index means the current entry is not in our slice at all, which
 * the spec allows, and it is not a reason to move the reader.
 */
export function shouldStepBack(appHistory: AppHistory | undefined): boolean {
  return appHistory !== undefined && appHistory.index > 0;
}

/**
 * Read our slice from the live document, or undefined when this browser has no
 * Navigation API and when there is no window at all.
 *
 * Deliberately NOT `navigation.canGoBack`, which is the same boolean: reading
 * the index keeps what the decision is made of visible at the call site and
 * lets `shouldStepBack` be tested against the measured numbers above rather
 * than against a flag that restates its own answer.
 */
export function readAppHistory(): AppHistory | undefined {
  if (typeof window === "undefined") return undefined;
  const nav = (window as unknown as { navigation?: { currentEntry?: { index?: number } | null } })
    .navigation;
  const index = nav?.currentEntry?.index;
  if (typeof index !== "number") return undefined;
  return { index };
}

/**
 * Modified and non-primary clicks belong to the browser, not to us. Cmd-click,
 * middle-click and shift-click are the reader asking for a NEW context, and a
 * new context has no history of ours in it. Letting them through is also what
 * keeps the anchor's `href` honest: the control still opens its stated
 * destination in a new tab, which is the reason this stayed a `Link` and did
 * not become a `<button>`.
 */
export function isPlainLeftClick(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.defaultPrevented
  );
}

/**
 * The one rule a back chevron obeys, in a module a test can import.
 *
 * WHY THIS IS NOT INSIDE `screen-chrome.tsx`. That file is the natural home,
 * and it cannot be the tested one: it is a `"use client"` module that imports
 * `next/link` and `./mobile.module.css`, and a CSS module import throws under
 * `tsx --test`. So the decision lives here as a plain function and the header
 * calls it. Nothing else in this file, on purpose: a helper that grows a second
 * job stops being the thing a one-line test can pin.
 *
 * WHAT IT DECIDES. A control drawn as a back chevron should step back through
 * history when there is a history to step through, and fall through to its
 * stated destination when there is not. `history.back()` is a NO-OP on the
 * first entry of a tab, which is the failure `search-screen.tsx:157-161` writes
 * its fallback for. Cold entry, deep link, a share opened in a new tab: all of
 * them land on entry one, and a chevron that calls `back()` there does nothing
 * at all on a screen that mounts no other exit.
 */
export function shouldStepBack(historyLength: number | undefined): boolean {
  return typeof historyLength === "number" && historyLength > 1;
}

/**
 * Modified and non-primary clicks belong to the browser, not to us. Cmd-click,
 * middle-click and shift-click are the reader asking for a NEW context, and a
 * new context has no history to step back through. Letting them through is
 * also what keeps the anchor's `href` honest: the control still opens its
 * stated destination in a new tab, which is the whole reason this stayed a
 * `Link` and did not become a `<button>`.
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

import type { ReactNode } from "react";
import { CallsDeskRedirect } from "@/components/mobile/calls-desk-redirect";

/**
 * The segment layout for /radar/calls. It exists to mount one thing.
 *
 * WHY A LAYOUT AND NOT AN EDIT TO `page.tsx`. That file is the desk's Calls
 * screen, it is a client component of about 1100 lines, and its own phone twin
 * states in its header that it is not edited by the mobile programme and must
 * not be. A sibling layout is the App Router's own answer to "this route and
 * only this route", it is additive, and it leaves that file untouched.
 *
 * WHY THE COVER IS SERVER-RENDERED FROM HERE. `/radar/calls` prerenders static
 * (`.next/server/app/radar/calls.html`). A cover that only exists after
 * hydration reaches neither that file nor the frame before hydration, which is
 * the frame the desk screen would paint at phone width. This layout is a server
 * component, `CallsDeskRedirect` takes no dynamic input, and the cover is
 * therefore in the prerendered HTML.
 *
 * MOUNTED BEFORE `children`, so the cover and the rule that takes
 * `#main-content` out of layout are in the stream ahead of the element they act
 * on.
 */

/* The JavaScript-off path, and it fails OPEN. The stylesheet half applies on
   width alone, so without this a reader with no JavaScript would get a covered,
   empty, token-coloured screen and no navigation off it, because the navigation
   half lives in an effect that never runs for them. This puts the desk screen
   back. It overflows sideways, which is the whole reason the redirect exists,
   and an overflowing screen a reader can use beats a blank one they cannot.

   The width is written a third time here. All three (this block, the module
   stylesheet's `@media`, and `PHONE_WIDTH` in the TSX) have to move together. */
const NOSCRIPT_CSS = `<style>
@media (max-width: 767.98px) {
  body:has([data-calls-desk-redirect]) #main-content { display: block !important; }
  [data-calls-desk-redirect] { display: none !important; }
}
</style>`;

export default function RadarCallsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <CallsDeskRedirect />
      <noscript dangerouslySetInnerHTML={{ __html: NOSCRIPT_CSS }} />
      {children}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   The three families the app actually loads.
   ══════════════════════════════════════════════════════════════════════
   `src/app/layout.tsx` loads exactly three faces through next/font/google
   and puts them on <body> as CSS variables:

     Fraunces        --font-fraunces        serif voice, headlines
     Space Grotesk   --font-space-grotesk   UI, labels, body copy
     IBM Plex Mono   --font-plex-mono       numbers, tickers, dates

   Nothing else is loaded. Naming any other family in a declaration is a
   silent fall back to the generic, which is Times or Helvetica, so the
   screen ships in a face nobody designed. Everything that needs a family
   reads one of these three constants.

   NOT BECAUSE THE NAME IS HASHED. Two now-deleted copies of this module
   (dashboard-mobile/fonts.ts, evening/fonts.ts) said next/font emits a
   hashed family name and that a literal therefore cannot reach the face.
   On this Next version it does not hash. The built CSS reads:

     --font-fraunces:"Fraunces", "Fraunces Fallback"
     --font-space-grotesk:"Space Grotesk", "Space Grotesk Fallback"
     --font-plex-mono:"IBM Plex Mono", "IBM Plex Mono Fallback"

   Unhashed, verbatim. The conclusion is unchanged, a bare `Inter` still
   names a face no @font-face rule declares, but the stated reason was
   wrong and it cost one measurement pass. Grep .next after a build if it
   ever needs re-checking.

   THE SHORTHAND TRAP. Most declarations on these screens use the CSS
   `font:` shorthand, which carries weight, size, line-height and family in
   one value. If the family part contains a var() that is not defined, the
   whole declaration is invalid at computed-value time and is DROPPED:
   size and weight reset with it, silently, to 14px/400. That is why the
   family is always spelled through these constants and never hand-typed as
   `var(--font-...)`. A typo in the constant name is a build error. A typo
   inside a var() is a layout change nobody sees in review.

   `globals.css` also aliases the previous variable names
   (--font-playfair-display / --font-inter / --font-jetbrains-mono) onto
   the same three families for back compatibility. Those aliases still
   resolve, but they name faces the app does not load, so new code points
   at the emitted variables directly.

   No "use client" here on purpose: `/settings/alerts` and
   `/settings/learned` are server components and need these too. An export
   from a "use client" module reaches a server component as a client
   reference, not as the string.
   ══════════════════════════════════════════════════════════════════════ */

export const FONT_DISPLAY = "var(--font-fraunces), serif";
export const FONT_SANS = "var(--font-space-grotesk), sans-serif";
export const FONT_MONO = "var(--font-plex-mono), monospace";

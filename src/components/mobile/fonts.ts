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

/**
 * The three families the app actually loads.
 *
 * `src/app/layout.tsx` loads exactly three faces through `next/font/google`
 * and puts them on `<body>` as CSS variables:
 *
 *     Fraunces        --font-fraunces        the editorial voice, headlines
 *     Space Grotesk   --font-space-grotesk   UI, labels, body copy
 *     IBM Plex Mono   --font-plex-mono       numbers, tickers, prices, dates
 *
 * Nothing else is loaded. `next/font` emits a hashed family name, so a literal
 * face name in a declaration never reaches the intended face: it falls through
 * to the generic, which is Times or Helvetica, and the screen ships in a face
 * nobody designed. This screen named `Playfair Display` 11 times,
 * `JetBrains Mono` 10 and `Inter` 23, and the report measured 99 of its 147
 * text-bearing nodes rendering in a fallback.
 *
 * `globals.css:111-113` aliases the three old variable names
 * (`--font-playfair-display`, `--font-inter`, `--font-jetbrains-mono`) onto
 * these three, and those aliases still resolve. They are not used here because
 * they name faces the app does not load, and a variable named after a face
 * that is not loaded is the same trap one level down.
 *
 * No `"use client"`, deliberately, so a server component can import these too.
 * An export from a `"use client"` module reaches a server component as a
 * client reference rather than as the string.
 *
 * DUPLICATION, STATED. PR #673 built `src/components/mobile/fonts.ts` for
 * exactly this and it is not on this branch. PR #675 hit the same wall and
 * made `src/components/dashboard-mobile/fonts.ts`. This is the third copy of
 * three constants. When PR #673 merges, delete this file and repoint the
 * imports. The export names match those in PR #675 so the fold is a grep.
 */

/** Headlines, ledes and the section rules' italic. */
export const SERIF = "var(--font-fraunces), serif";

/** UI, labels and body copy. */
export const SANS = "var(--font-space-grotesk), sans-serif";

/** Numbers, tickers, prices, stamps and dates. */
export const MONO = "var(--font-plex-mono), monospace";

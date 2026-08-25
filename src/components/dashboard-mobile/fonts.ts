/**
 * The three families this app actually loads.
 *
 * `layout.tsx` loads exactly Fraunces, Space Grotesk and IBM Plex Mono through
 * `next/font/google`. Nothing else is loaded, and next/font emits a HASHED
 * family name, so a literal `'Playfair Display', serif` does not reach the
 * serif face the design intends. It reaches the platform serif, which is Times.
 * The same is true of `Inter, sans-serif` and `'JetBrains Mono', monospace`:
 * they name faces that are not there and quietly resolve to Helvetica and to
 * whatever the platform calls monospace.
 *
 * The only way to name a loaded face is the CSS variable next/font emits.
 * `globals.css` also aliases the three old names onto the new ones on `body`,
 * so either variable resolves; the emitted ones are used here because they are
 * the source rather than the alias.
 *
 * No `"use client"`, deliberately, so a server component can import it too.
 *
 * DUPLICATION, STATED. PR #673 built `src/components/mobile/fonts.ts` for
 * exactly this and it is not on this branch yet. When it merges, delete this
 * file and point these imports at that one. Named the same thing on purpose so
 * the fold is a grep.
 */

/** Headlines and the editorial voice. */
export const SERIF = "var(--font-fraunces), serif";

/** UI, labels and body copy. */
export const SANS = "var(--font-space-grotesk), sans-serif";

/** Numbers, tickers, prices and dates. */
export const MONO = "var(--font-plex-mono), monospace";

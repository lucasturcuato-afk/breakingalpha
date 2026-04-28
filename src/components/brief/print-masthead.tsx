/**
 * PrintMasthead — newsletter-style masthead for the PDF.
 *
 * Spec (locked, do not redesign):
 *   - Q1: simple briefing-document style. SIGNALERA wordmark left,
 *         edition label right (Q7 format: "Morning Brief · Monday,
 *         April 27, 2026"). NO gold-to-espresso gradient. NO marketing
 *         tagline. NO mood pill / VIX / theses stat strip.
 *   - Q1/Q8: thin Heritage Gold (#c9922a) horizontal rule below the
 *         masthead row. Hairline only — no band, no gradient.
 *   - Q8: pure white background, accent dot in gold before edition
 *         label, no rounded corners, no shadows.
 *
 * Reference aesthetic: Stratechery email-as-PDF, Money Stuff, FT
 * Alphaville. NOT dashboards or marketing landing pages.
 */

const HERITAGE_GOLD = "#c9922a";

export type PrintMastheadKind = "morning" | "evening";

export interface PrintMastheadProps {
  kind: PrintMastheadKind;
  /** Pre-formatted edition date, e.g. "Monday, April 27, 2026". */
  dateStr: string;
}

export function PrintMasthead({ kind, dateStr }: PrintMastheadProps) {
  const editionLabel = kind === "evening" ? "Evening Wrap" : "Morning Brief";

  return (
    <header className="px-10 pt-8 pb-3 bg-white">
      <div className="flex items-baseline justify-between gap-6">
        <span
          className="font-serif font-bold tracking-tight text-black"
          style={{
            fontFamily: "'Times New Roman', Times, serif",
            fontSize: 30,
            letterSpacing: "0.06em",
          }}
        >
          SIGNALERA
        </span>
        <span
          className="font-sans uppercase text-neutral-700 inline-flex items-center gap-2"
          style={{
            fontFamily: "Helvetica, Arial, sans-serif",
            fontSize: 10,
            letterSpacing: "0.18em",
          }}
        >
          <span
            aria-hidden
            className="inline-block"
            style={{
              width: 5,
              height: 5,
              background: HERITAGE_GOLD,
            }}
          />
          {editionLabel} · {dateStr}
        </span>
      </div>
      <hr
        className="mt-4 border-0"
        style={{ height: 1, background: HERITAGE_GOLD }}
      />
    </header>
  );
}

export default PrintMasthead;

/**
 * PrintMasthead — newsletter-style masthead for the PDF.
 *
 * Spec (locked, do not redesign):
 *   - Q1: simple briefing-document style. Wordmark left, edition
 *         label right (Q7 format: "Morning Brief · Monday, April 27,
 *         2026"). NO gold-to-espresso gradient. NO marketing tagline.
 *         NO mood pill / VIX / theses stat strip.
 *   - C17: wordmark matches the website — "Signal" in dark espresso
 *         + "era" in Heritage Gold, Playfair Display weight 700,
 *         tracking-tight. C1's "no two-tone" override is rescinded;
 *         brand consistency wins.
 *   - Q1/Q8: thin Heritage Gold (#c9922a) horizontal rule below the
 *         masthead row. Hairline only — no band, no gradient.
 *   - Q8: pure white background, accent dot in gold before edition
 *         label, no rounded corners, no shadows.
 *
 * Reference aesthetic: Stratechery email-as-PDF, Money Stuff, FT
 * Alphaville. NOT dashboards or marketing landing pages.
 */

const HERITAGE_GOLD = "#c9922a";
const DC_ESPRESSO = "#1a1208";

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
        {/* Brand wordmark — matches the website treatment.
            "Signal" dark espresso, "era" Heritage Gold, Playfair
            Display weight 700. Playfair is loaded at the root layout
            via next/font/google as --font-playfair-display, which
            propagates to the print page (nested under the same root).
            Times New Roman is the fallback if the variable doesn't
            resolve in the Puppeteer render context — defensive. */}
        <span
          className="font-bold tracking-tight leading-none whitespace-nowrap inline-flex"
          style={{
            fontFamily:
              "var(--font-playfair-display), 'Playfair Display', 'Times New Roman', Times, serif",
            fontSize: "24pt",
            fontWeight: 700,
            letterSpacing: "-0.6px",
          }}
        >
          <span
            style={{
              color: DC_ESPRESSO,
              printColorAdjust: "exact",
              WebkitPrintColorAdjust: "exact",
            }}
          >
            Signal
          </span>
          <span
            style={{
              color: HERITAGE_GOLD,
              printColorAdjust: "exact",
              WebkitPrintColorAdjust: "exact",
            }}
          >
            era
          </span>
        </span>
        <span
          className="font-sans text-neutral-700 inline-flex items-center gap-2"
          style={{
            fontFamily: "Helvetica, Arial, sans-serif",
            fontSize: 10,
          }}
        >
          <span
            aria-hidden
            className="inline-block"
            style={{
              width: 5,
              height: 5,
              background: HERITAGE_GOLD,
              // Belt-and-suspenders against Puppeteer color stripping.
              // print.css sets print-color-adjust: exact globally; this
              // local repeat is defensive on the few gold elements.
              printColorAdjust: "exact",
              WebkitPrintColorAdjust: "exact",
            }}
          />
          {editionLabel} · {dateStr}
        </span>
      </div>
      <hr
        className="mt-4 border-0"
        style={{
          height: 1,
          background: HERITAGE_GOLD,
          printColorAdjust: "exact",
          WebkitPrintColorAdjust: "exact",
        }}
      />
    </header>
  );
}

export default PrintMasthead;

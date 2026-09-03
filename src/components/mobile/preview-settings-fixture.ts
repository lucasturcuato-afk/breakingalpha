import type { EnrichedDeal } from "@/hooks/useSavedDeals";
import type { ShareDeal, ShareSection } from "@/components/share/mobile-share-screen";

/**
 * The saved-deals sample for the preview harness, and NOTHING ELSE.
 *
 * WHY IT HAS ITS OWN MODULE. These rows are invented transactions attributed
 * to real listed companies, at stated valuations, in a real acquirer's name.
 * They sat inline in `preview-settings-batch.tsx`, which is a "use client"
 * module, so they were compiled into a public chunk under `.next/static` on
 * every production build and served to anyone who asked for the file, with no
 * session. No screen drew them: `/preview/settings-batch` is a harness. The
 * bytes shipped anyway, because a bundler ships what a client module imports,
 * not what a client module paints.
 *
 * It is imported through a dynamic `import()` guarded by a literal
 * `process.env.NODE_ENV` check, which folds at build time and leaves the call
 * unreachable, so on a production build no chunk is emitted for this file at
 * all. The harness is a development surface and loses nothing.
 *
 * "fixture" is in the file name on purpose. `scripts/design-lint.mjs` keys its
 * `fixture-in-client-bundle` rule on the module path, so a future static value
 * import of these rows from a client component is a lint error rather than a
 * silent regression.
 */
export const PREVIEW_DEALS: EnrichedDeal[] = [
  {
    id: "fx-1", company: "Hologic", acquirer: "Blackstone & TPG", deal_type: "Take-private",
    stage: "under_loi", value: "$18.3B", sector: "Medtech",
    source_url: "https://www.wsj.com", saved_at: "2026-08-04T12:00:00.000Z",
  },
  {
    id: "fx-2", company: "Electronic Arts", acquirer: "PIF consortium", deal_type: "Take-private",
    stage: "closed", value: "$55.0B", sector: "Software",
    source_url: "https://www.ft.com", saved_at: "2026-08-06T12:00:00.000Z",
  },
  {
    id: "fx-3", company: "Evoqua", acquirer: "Xylem", deal_type: "All-stock merger",
    stage: "announced", value: "$9.4B", sector: "Industrials",
    source_url: "https://www.reuters.com", saved_at: "2026-08-03T12:00:00.000Z",
  },
  {
    id: "fx-4", company: "Smartsheet", acquirer: "Vista Equity", deal_type: "Take-private",
    stage: "rumored", value: "$4.1B", sector: "Software",
    source_url: "https://www.bloomberg.com", saved_at: "2026-07-29T12:00:00.000Z",
  },
];

/**
 * The share-plate sample: one invented briefing, with two invented
 * transactions naming real listed companies at stated valuations inside it.
 *
 * It used to sit INLINE in `SharePreview`'s returned tree in
 * `preview-settings-batch.tsx`. Inline JSX props cannot be tree-shaken and
 * have no gate to fold, so this payload was compiled into a shared
 * `.next/static` chunk on every production build. Moving it here and reaching
 * it through the dev-only dynamic import is what takes it out.
 */
export const PREVIEW_BRIEF = {
  headline: "Breadth Thins as Rates Do the Quiet Work",
  marketTone: "Patient",
  summary: "Breadth thinned for a fourth session while the index kept its level, which is the tape saying it does not believe that level. Nine of eleven sectors finished green on a day the index gained almost nothing.",
  deals: [
  {
    company: "Hologic",
    value: "$18.3B",
    deal_type: "Take-private",
    one_liner:
      "Blackstone and TPG go exclusive on a diagnostics platform with a recurring consumables base.",
  },
  {
    company: "Evoqua",
    value: "$9.4B",
    deal_type: "Merger",
    one_liner:
      "Xylem acquires the industrial water division all-stock; antitrust review runs into Q1.",
  },
  ] as ShareDeal[],
  sections: [
  {
    key: "macro_and_rates",
    title: "Macro & Rates",
    body:
      "The ten-year gave back a basis point into the close after two soft payroll prints, and the front end has moved further than the long end in every session this week. The desk reads the term premium as carrying more of the level than the market is pricing.",
  },
  {
    key: "deals_and_ma",
    title: "Deals & M&A",
    body:
      "Sponsors are moving again in medtech. Hologic going exclusive at $18.3B resets the comp set for three more platforms already in market, and the financing is private credit rather than syndicated.",
  },
  ] as ShareSection[],
  sectors: [
  {
    key: "Energy & Utilities",
    title: "Energy & Utilities",
    body:
      "Data centre contracting has pulled roughly a third of the merchant nuclear fleet into fixed-price supply agreements. The PJM capacity auction late this month is the first real test of whether firm capacity is scarce enough to keep that pricing.",
  },
  ] as ShareSection[],
};

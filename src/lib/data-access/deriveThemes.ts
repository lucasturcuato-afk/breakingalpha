/**
 * deriveThemes -- synthesises {label, weight, tone, count} per theme
 * from raw companies.key_themes joined against an in-memory articles
 * array (already loaded by getCompanyDetail). Resolves C9.
 *
 * weight = count / max(count_across_themes), so the top theme always
 * reaches 1.0 (visual-fidelity choice; see recon Q-C).
 * tone: avg sentiment >= 0.6 BULLISH, <= 0.4 BEARISH, else NEUTRAL;
 * WATCH when no matched articles carry sentiment.
 *
 * Recon: .session-artifacts/phase-4-recon/pr-b3.md section 4.
 */

export type DerivedThemeTone = "BULLISH" | "BEARISH" | "NEUTRAL" | "WATCH";

export type DerivedTheme = {
  label: string;
  weight: number;
  tone: DerivedThemeTone;
  count: number;
};

const SENTIMENT_VALUE: Record<string, number> = {
  bullish: 1,
  neutral: 0.5,
  bearish: 0,
};

const TOP_N = 6;

export function deriveThemes(
  rawThemes: ReadonlyArray<string>,
  articles: ReadonlyArray<{ title: string; sentiment: string | null }>,
  limit: number = TOP_N,
): DerivedTheme[] {
  if (rawThemes.length === 0) return [];

  const matches = rawThemes.map((label) => {
    const needle = label.toLowerCase();
    const matched = articles.filter((a) => a.title.toLowerCase().includes(needle));
    return { label, matched };
  });

  const maxCount = Math.max(1, ...matches.map((m) => m.matched.length));

  return matches
    .map(({ label, matched }) => {
      const count = matched.length;
      const sentiments = matched
        .map((a) => (a.sentiment ? SENTIMENT_VALUE[a.sentiment] : null))
        .filter((v): v is number => typeof v === "number");
      const avg = sentiments.length === 0
        ? 0.5
        : sentiments.reduce((s, v) => s + v, 0) / sentiments.length;
      const tone: DerivedThemeTone = sentiments.length === 0
        ? "WATCH"
        : avg >= 0.6 ? "BULLISH" : avg <= 0.4 ? "BEARISH" : "NEUTRAL";
      return { label, weight: count / maxCount, tone, count };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Facet predicates (shared)
// ---------------------------------------------------------------------------
// WD129 selects up to 4 facet-protected articles (governance, bear,
// financial-risk, valuation-range) into the memo pool, running these predicates
// over RawArticleRow in the company-articles route. WD141 re-runs the same
// predicates over the classified CompanyArticle list inside buildMemoContent so
// the protected picks are not evicted by the downstream relevance/context
// slices. Both call sites must use the identical predicates, so they live here.
//
// FacetableArticle is the minimal structural shape the predicates need; both
// RawArticleRow and CompanyArticle satisfy it.

export interface FacetableArticle {
  title?: string | null;
  summary?: string | null;
  content?: string | null;
  sentiment?: string | null;
}

// Facets to protect. Order is deterministic so dedupe gives priority to
// earlier facets when the same article satisfies multiple.
export type Facet = "governance" | "bear" | "financial-risk" | "valuation-range";
export const FACETS: Facet[] = ["governance", "bear", "financial-risk", "valuation-range"];

// Facet predicates. Each operates on the concatenated (title + summary + content)
// text. Tuned against the SpaceX corpus per the design brief. Future-company
// expansion will need to validate that these keywords are not too SpaceX-specific
// (the "85.1" anchor and the dual-class language are not).
function articleText(a: FacetableArticle): string {
  return [a.title ?? "", a.summary ?? "", a.content ?? ""].join(" ");
}

const GOVERNANCE_RE =
  /\b(dual[- ]class|class\s+[ab]\b|supervoting|super[- ]voting|voting\s+(power|control|rights)|85\.1|proxy(\s+fight)?|board\s+(control|seats?)|governance|monarchical|tight\s+grip|complete\s+control)\b/i;

const BEAR_KEYWORD_RE =
  /\b(overvalued|hard\s+to\s+justify|skeptical|bear\s+case|bearish|frothy|paradox|money-losing|behemoth|warned|scrub|billion\s+loss|biggest\s+threat|not\s+buying)\b/i;

const FIN_RISK_RE =
  /\b(bridge\s+loan|dilution|cash\s+burn|going\s+concern|runway|down\s+round|debt\s+covenant|default(?!\s+(rate|to))|liquidity\s+(risk|crunch)|negative\s+cash\s+flow|losing\s+money|lost\s+\$[\d.]+\s*billion)\b/i;

// Valuation range: an explicit "$X to $Y billion/trillion" pattern. The
// connector can be "to", "-", or an en-dash. Also catches the canonical
// "$1.75" SpaceX anchor when written in the article body.
const RANGE_RE =
  /\$\d[\d,.]*\s*(billion|trillion|[bt])\b[\s\S]{0,40}(to|-|–|—)\s*\$\d[\d,.]*\s*(billion|trillion|[bt])\b/i;
const RANGE_ALT_RE = /\$1\.75\s*(trillion|t)\b/i;

export function matchesFacet(facet: Facet, a: FacetableArticle): boolean {
  const text = articleText(a);
  switch (facet) {
    case "governance":
      return GOVERNANCE_RE.test(text);
    case "bear":
      return a.sentiment === "bearish" || BEAR_KEYWORD_RE.test(text);
    case "financial-risk":
      return FIN_RISK_RE.test(text);
    case "valuation-range":
      return RANGE_RE.test(text) || RANGE_ALT_RE.test(text);
  }
}

// True when an article matches any protected facet. Used by WD141 to keep
// WD129's protected picks from being sliced out of the memo content.
export function isFacetProtected(a: FacetableArticle): boolean {
  return FACETS.some((f) => matchesFacet(f, a));
}

// All keyword/pattern facet regexes, paired with the facet each one signals, for
// span scanning. RANGE_RE and RANGE_ALT_RE both signal valuation-range. The bear
// facet also has a sentiment-based trigger (a.sentiment === "bearish") that
// carries no text span, so it is not represented here; facetMatchSpans only
// reports spans that exist within the scanned text.
const FACET_REGEXES: Array<{ facet: Facet; re: RegExp }> = [
  { facet: "governance", re: GOVERNANCE_RE },
  { facet: "bear", re: BEAR_KEYWORD_RE },
  { facet: "financial-risk", re: FIN_RISK_RE },
  { facet: "valuation-range", re: RANGE_RE },
  { facet: "valuation-range", re: RANGE_ALT_RE },
];

export interface FacetSpan {
  start: number;
  end: number;
  hasDigit: boolean;
  facet: Facet;
}

// Return every facet-keyword match span over `text`, sorted by start offset.
// WD134 smart-excerpt uses these offsets to center the article-body window on
// the position that captures the most distinct facet matches. The offsets are
// into the exact string passed in, so the caller MUST pass the same string it
// later slices (pickArticleBody passes its chosen `source`, not articleText)
// or the positions are meaningless.
export function facetMatchSpans(text: string): FacetSpan[] {
  const spans: FacetSpan[] = [];
  for (const { facet, re } of FACET_REGEXES) {
    const g = re.flags.includes("g") ? re : new RegExp(re.source, re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = g.exec(text)) !== null) {
      const matched = m[0];
      spans.push({
        start: m.index,
        end: m.index + matched.length,
        hasDigit: /\d/.test(matched),
        facet,
      });
      // Defensive: a zero-length match would not advance lastIndex.
      if (m.index === g.lastIndex) g.lastIndex++;
    }
  }
  spans.sort((a, b) => a.start - b.start);
  return spans;
}

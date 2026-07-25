/**
 * financials-commentary.ts -- pure helpers for the Financials tab commentary.
 *
 * Turns a company's OWN validated XBRL (the financial_facts_latest grid, via
 * fetchCompanyFinancials) into a compact structured block, builds a strictly
 * descriptive Gemini prompt over that block ONLY, and sanitizes the result.
 * There is no web pool, no cross-company data, no news: the generator sees the
 * company's reported numbers and periods and nothing else.
 *
 * Compliance is enforced in two layers: this prompt asks for descriptive-only
 * prose (allowed: figures, own-history deltas, factual firsts, line-item
 * definitions; prohibited: valuation, recommendation, verdicts, peer claims,
 * price targets), and the API route runs the output through
 * compliance-language-filter.ts as the post-generation backstop. Prompt text
 * alone drifts under token pressure, so the filter is what actually holds.
 *
 * Pure and unit-testable: no network, no model, no DB. The route owns the model
 * call and the filter application; this module owns the XBRL serialization, the
 * prompt, and the sanitizer.
 */

import type { CompanyFinancialsResult, FinancialView } from "@/lib/financial-facts";

/** Rendered under every generated commentary, on the surface. Non-negotiable. */
export const COMMENTARY_DISCLAIMER =
  "AI-generated commentary on the company's own reported figures. Not investment advice. Verify against the filings before acting.";

/** Max characters for a commentary (a short descriptive paragraph). */
export const COMMENTARY_MAX_CHARS = 900;

// Human labels for the metric keys the XBRL grid exposes. Only these are fed to
// the model; anything else in the grid is ignored so the input stays bounded.
const METRIC_LABELS: Array<{ key: string; label: string }> = [
  { key: "revenue", label: "Revenue" },
  { key: "cost_of_revenue", label: "Cost of revenue" },
  { key: "gross_profit", label: "Gross profit" },
  { key: "operating_income", label: "Operating income" },
  { key: "net_income", label: "Net income" },
  { key: "eps_diluted", label: "EPS (diluted)" },
  { key: "eps_basic", label: "EPS (basic)" },
  { key: "shares_diluted", label: "Diluted shares" },
  { key: "operating_cash_flow", label: "Operating cash flow" },
  { key: "total_assets", label: "Total assets" },
  { key: "total_liabilities", label: "Total liabilities" },
  { key: "stockholders_equity", label: "Stockholders' equity" },
  { key: "cash_and_equivalents", label: "Cash & equivalents" },
];

/** Compact numeric rendering for the prompt (full precision, no $ scaling). */
function num(v: number): string {
  if (!Number.isFinite(v)) return "n/a";
  if (Math.abs(v) >= 1000 && Number.isInteger(v)) return v.toLocaleString("en-US");
  // Keep EPS / ratios readable without trailing zeros.
  return String(Number(v.toFixed(4)));
}

/**
 * Serialize one view (annual or quarterly) as newest-first period columns with
 * one line per metric that has any value. Periods are the company's own fiscal
 * labels; values are the reported XBRL numbers. Empty views serialize to "".
 */
function serializeView(view: FinancialView): string {
  if (view.periods.length === 0) return "";
  const header = view.periods.map((p) => p.label).join(" | ");
  const lines: string[] = [`Periods (newest first): ${header}`];
  for (const { key, label } of METRIC_LABELS) {
    const cells = view.grid[key];
    if (!cells) continue;
    const row = view.periods.map((p) => {
      const cell = cells[p.key];
      return cell && Number.isFinite(cell.value) ? num(cell.value) : "-";
    });
    if (row.every((r) => r === "-")) continue;
    lines.push(`${label}: ${row.join(" | ")}`);
  }
  return lines.join("\n");
}

/**
 * Assemble the ONLY input the generator receives: this company's structured
 * XBRL, annual and quarterly. Returns null when there is nothing to describe.
 * No web pool, no news, no peer data enters here by construction.
 */
export function assembleXbrlInput(
  companyName: string,
  financials: CompanyFinancialsResult,
): string | null {
  const annual = serializeView(financials.annual);
  const quarterly = serializeView(financials.quarterly);
  if (!annual && !quarterly) return null;

  const blocks: string[] = [`Company: ${companyName}`];
  blocks.push("Currency: USD unless a per-share (EPS) or share-count line.");
  if (annual) blocks.push(`ANNUAL (fiscal years):\n${annual}`);
  if (quarterly) blocks.push(`QUARTERLY (fiscal quarters; year-end columns carry the balance sheet, income lines dash there):\n${quarterly}`);
  return blocks.join("\n\n");
}

/**
 * System + user prompt for the commentary call. The descriptive-only contract
 * is pinned here verbatim so the unit tests assert it and the model has an
 * explicit boundary. The user message carries the XBRL block and nothing else.
 */
export function buildCommentaryPrompt(xbrlBlock: string): { system: string; user: string } {
  const system = [
    "You write a SHORT descriptive commentary on a company's own reported financials for an analyst reference sheet.",
    "Your ONLY source is the structured XBRL figures in the user message. Use nothing else. Never invent a number, a period, a segment, a customer, or a cause. If a figure is not in the input, do not mention it.",
    "OUTPUT: 3 to 5 plain sentences. No headings, no markdown, no bullet points, no lead-in, no sign-off.",
    "ALLOWED, and all you should do: state reported figures and their changes (revenue, margins, EPS, YoY and QoQ deltas you can compute from the given periods); describe trends across the company's OWN history (e.g. 'operating margin expanded in each of the last four quarters'); note a factual first visible in the data (e.g. 'first positive operating income in the periods shown'); explain what a line item is.",
    "STRICTLY PROHIBITED. Do not write any of these: valuation language (cheap, expensive, undervalued, overvalued, attractive, fairly valued, discount, premium, multiple); any buy, sell, hold, accumulate, or avoid; any assessment of the security (compelling, well-positioned, strong investment, high conviction, de-risked); price targets or any forward projection not in the input; peer or competitor comparisons (you have no peer data, so any such claim is fabricated); qualitative verdicts on whether results are good, bad, healthy, weak, strong, impressive, or disappointing.",
    "The rule: DESCRIPTIVE and factual from THIS company's XBRL, never PRESCRIPTIVE or evaluative about the security. When in doubt, state the number and stop.",
    "Compute deltas only from periods present in the input. Label them (YoY, QoQ). Zero em-dashes; use periods and commas.",
  ].join("\n");

  const user = [
    "Reported XBRL figures (the only source you may use):",
    "",
    xbrlBlock,
    "",
    "Write the descriptive commentary now, plain text only.",
  ].join("\n");

  return { system, user };
}

/**
 * Defensive post-processing before the compliance filter runs: strip code
 * fences/quotes, drop em-dashes, collapse whitespace, hard-cap at a sentence
 * boundary. Returns "" for empty input. Never throws.
 */
export function sanitizeCommentary(raw: string | null | undefined): string {
  let s = (raw ?? "").trim();
  if (!s) return "";
  s = s.replace(/^```[a-z]*\n?|\n?```$/gi, "").trim();
  s = s.replace(/^["']|["']$/g, "").trim();
  s = s.replace(/\s*\u2014\s*/g, ", ").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, " ").trim();
  if (s.length <= COMMENTARY_MAX_CHARS) return s;
  const slice = s.slice(0, COMMENTARY_MAX_CHARS);
  const stop = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (stop > 200) return slice.slice(0, stop + 1);
  return slice.replace(/\s+\S*$/, "") + "...";
}

/**
 * Stable, order-independent hash of the XBRL block. Cache-invalidation key: a
 * cached commentary is reused only while this matches, so new filings trigger
 * one regeneration. djb2, not cryptographic.
 */
export function commentarySourceHash(xbrlBlock: string): string {
  const norm = (xbrlBlock ?? "").replace(/\s+/g, " ").trim();
  let h = 5381;
  for (let i = 0; i < norm.length; i++) {
    h = ((h << 5) + h + norm.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

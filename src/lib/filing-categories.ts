/**
 * filing-categories.ts -- pure form-type classification for the Filings tab.
 *
 * WHY. Form 4 shells dominate the filing feed: 735 of 2,069 sec_filings rows are
 * Form 3/4/5, and for Taiwan Semiconductor every single stored filing is a Form
 * 4. Rendering them undifferentiated, newest-first, buries the material filings
 * a reader actually came for (10-K, 10-Q, 8-K for US filers; 20-F and 6-K for
 * foreign private issuers).
 *
 * The fix is a DEFAULT, not a deletion. Material forms show first; a chip row
 * exposes every category with its count, so nothing is hidden and the counts
 * make it obvious what was set aside. Insider forms now have their own tab.
 *
 * Pure and dependency-free. Unit-testable.
 */

export type FilingCategory = "annual" | "quarterly" | "events" | "insider" | "other";

/** Chip identity. "all" is a view, not a category. */
export type FilingFilter = "all" | FilingCategory;

/** Normalize "10-K/A" or " 10-k " to "10-K" for matching. */
export function normalizeForm(form: string | null | undefined): string {
  return (form ?? "").trim().toUpperCase();
}

/** Strip the amendment suffix so 10-K/A classifies with 10-K. */
export function baseForm(form: string | null | undefined): string {
  return normalizeForm(form).replace(/\/A$/, "");
}

const ANNUAL = new Set(["10-K", "10-KSB", "20-F", "40-F", "11-K"]);
const QUARTERLY = new Set(["10-Q", "10-QSB"]);
const EVENTS = new Set(["8-K", "6-K", "S-1", "S-3", "S-4", "DEF 14A", "DEFA14A", "425"]);
const INSIDER = new Set(["3", "4", "5"]);

/**
 * Category for a form type. Amendment variants follow their base form, so
 * "10-K/A" is annual and "4/A" is insider. Anything unrecognized is "other",
 * which is a real chip, so unknown forms stay reachable.
 */
export function categorizeForm(form: string | null | undefined): FilingCategory {
  const base = baseForm(form);
  if (ANNUAL.has(base)) return "annual";
  if (QUARTERLY.has(base)) return "quarterly";
  if (EVENTS.has(base)) return "events";
  if (INSIDER.has(base)) return "insider";
  return "other";
}

/**
 * Material by default: everything except insider forms. "Other" stays in the
 * default view deliberately, because an unclassified form is more likely to be
 * something we should surface than something to suppress.
 */
export function isMaterialByDefault(form: string | null | undefined): boolean {
  return categorizeForm(form) !== "insider";
}

export interface FilingLike {
  formType: string | null;
}

/** Count per category plus the total, for the chip labels. */
export function countByCategory<T extends FilingLike>(
  filings: T[],
): Record<FilingFilter, number> {
  const counts: Record<FilingFilter, number> = {
    all: filings.length,
    annual: 0,
    quarterly: 0,
    events: 0,
    insider: 0,
    other: 0,
  };
  for (const f of filings) counts[categorizeForm(f.formType)] += 1;
  return counts;
}

/**
 * Apply a chip selection. `null` means the default view: material forms only.
 * "all" returns everything including insider forms.
 */
export function applyFilter<T extends FilingLike>(
  filings: T[],
  filter: FilingFilter | null,
): T[] {
  if (filter === null) return filings.filter((f) => isMaterialByDefault(f.formType));
  if (filter === "all") return filings;
  return filings.filter((f) => categorizeForm(f.formType) === filter);
}

/** Chip order, fixed so the row does not reflow between companies. */
export const FILTER_ORDER: FilingFilter[] = [
  "all",
  "annual",
  "quarterly",
  "events",
  "insider",
  "other",
];

export const FILTER_LABELS: Record<FilingFilter, string> = {
  all: "All",
  annual: "Annual",
  quarterly: "Quarterly",
  events: "Events",
  insider: "Insider",
  other: "Other",
};

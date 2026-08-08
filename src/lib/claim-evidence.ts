/**
 * claim-evidence - pure helpers for the evidence a claim accumulates while open.
 *
 * The daily shared pass (backend/grading/claim_evidence.py) records supporting
 * and challenging stories against open claims. This module turns those rows into
 * exactly what the surface shows: a plain count of supporting vs challenging
 * since the claim was committed, and the most recent few with their dates.
 *
 * HONESTY, enforced here rather than in the view:
 *  - No score. No percentage. No ratio. No implied verdict. The grader is the
 *    only thing that decides a claim's outcome; this is an observation log.
 *  - Absence is the common state (roughly 80% of stories are neutral and record
 *    nothing). A claim with no evidence gets an honest empty line, never a "0%"
 *    or a zeroed-out scoreboard.
 *
 * Pure: no React, no fetch, no DOM. Unit-tested under node:test.
 */

export type EvidenceStance = "support" | "challenge";

/** One recorded story, as the claims API returns it (article title/url joined). */
export interface ClaimEvidenceItem {
  stance: EvidenceStance;
  title: string | null;
  url: string | null;
  publishedAt: string | null;
}

/** The per-claim summary the surface renders. */
export interface ClaimEvidenceSummary {
  supporting: number;
  challenging: number;
  /** Newest first, capped by the caller (RECENT_LIMIT). */
  recent: ClaimEvidenceItem[];
  /** True when nothing has been recorded. The surface shows the empty line. */
  isEmpty: boolean;
}

export const RECENT_LIMIT = 3;

export const EVIDENCE_COPY = {
  /** Shown when nothing has matched. Absence stated plainly, never a zero score. */
  empty: "No new evidence yet.",
  /** Trailing clause on the count line. */
  since: "since you committed",
} as const;

/** A raw ledger row as read from claim_evidence (article embedded). */
export interface RawEvidenceRow {
  stance?: string | null;
  article_published_at?: string | null;
  articles?: { title?: string | null; url?: string | null } | null;
}

/**
 * Fold raw ledger rows for a single claim into the surface summary. Rows may
 * arrive in any order; recent is sorted newest-first and capped. Unknown or
 * malformed stances are ignored rather than guessed.
 */
export function summarizeClaimEvidence(rows: RawEvidenceRow[] | null | undefined): ClaimEvidenceSummary {
  const list = rows ?? [];
  let supporting = 0;
  let challenging = 0;
  const items: ClaimEvidenceItem[] = [];
  for (const r of list) {
    const stance = r.stance === "support" || r.stance === "challenge" ? r.stance : null;
    if (!stance) continue;
    if (stance === "support") supporting += 1;
    else challenging += 1;
    items.push({
      stance,
      title: r.articles?.title ?? null,
      url: r.articles?.url ?? null,
      publishedAt: r.article_published_at ?? null,
    });
  }
  items.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  return {
    supporting,
    challenging,
    recent: items.slice(0, RECENT_LIMIT),
    isEmpty: supporting === 0 && challenging === 0,
  };
}

/**
 * The count line, e.g. "3 supporting, 1 challenging since you committed".
 * Returns null when nothing has matched, so the caller renders the empty line
 * instead. Never a score or a percentage: just two honest counts.
 */
export function evidenceCountLine(summary: ClaimEvidenceSummary): string | null {
  if (summary.isEmpty) return null;
  const s = `${summary.supporting} supporting`;
  const c = `${summary.challenging} challenging`;
  return `${s}, ${c} ${EVIDENCE_COPY.since}`;
}

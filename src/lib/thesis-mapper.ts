/**
 * Single source of truth for mapping raw Supabase `theses` rows into the
 * `ThesisItem` shape consumed by the frontend. Used by both:
 *   - /api/theses           (bulk GET)
 *   - /api/theses/[id]      (single PATCH response)
 *
 * NOTE: `conviction` is TEXT in Supabase — one of HIGH, MEDIUM, WATCH, BULLISH,
 * BEARISH. There is NO numeric "score" field surfaced here. The ring renders
 * the conviction label only.
 */

import type { ThesisItem, ThesisStatus, EvidenceItem } from "@/components/thesis/thesis-types";

/**
 * Alias of `ThesisItem` so server-side consumers have an explicit,
 * importable name and client code isn't coupled to a UI-type export.
 */
export type MappedThesis = ThesisItem;

export interface RawThesisRow {
  id?: string | null;
  title?: string | null;
  conviction?: string | null;
  sector?: string | null;
  rationale?: string | null;
  catalyst?: string | null;
  catalyst_note?: string | null;
  evidence_chain?: unknown;
  status?: string | null;
  source?: string | null;
  bear_case?: string | null;
  adversarial_score?: number | null;
  passed_adversarial?: boolean | null;
  outcome?: string | null;
  outcome_notes?: string | null;
  signal_breakdown?: Record<string, unknown> | null;
  supporting_articles?: string[] | null;
  ticker?: string | null;
  horizon?: string | null;
  check_after?: string | null;
  generated_at?: string | null;
  verifiable_signal?: string | null;
  user_id?: string | null;
  // Allow arbitrary extra columns — we discard them.
  [key: string]: unknown;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (!Number.isFinite(diff)) return "recently";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function coerceConviction(value: unknown): ThesisItem["conviction"] {
  if (typeof value !== "string") return "WATCH";
  const up = value.toUpperCase();
  if (up === "HIGH" || up === "MEDIUM" || up === "WATCH" || up === "BULLISH" || up === "BEARISH") {
    return up;
  }
  return "WATCH";
}

function coerceOutcome(value: unknown): ThesisItem["outcome"] {
  if (value === "confirmed" || value === "invalidated" || value === "inconclusive") return value;
  return null;
}

function coerceEvidenceChain(value: unknown): ThesisItem["evidence_chain"] {
  if (Array.isArray(value)) return value as EvidenceItem[] | Record<string, unknown>[];
  if (value === null || value === undefined) return null;
  return null;
}

/**
 * Map a raw `theses` row into the UI `ThesisItem` shape.
 *
 * Safe to call on unknown-shaped objects — unexpected fields are discarded,
 * missing fields fall through to conservative defaults (`WATCH`, `new-signal`).
 */
export function mapThesisRow(row: RawThesisRow): MappedThesis {
  const generatedAt = typeof row.generated_at === "string" ? row.generated_at : null;

  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? ""),
    conviction: coerceConviction(row.conviction),
    sector: String(row.sector ?? "General"),
    summary: String(row.rationale ?? "").slice(0, 200),
    rationale: typeof row.rationale === "string" ? row.rationale : undefined,
    catalyst: typeof row.catalyst === "string" ? row.catalyst : undefined,
    catalyst_note: typeof row.catalyst_note === "string" ? row.catalyst_note : undefined,
    evidence_chain: coerceEvidenceChain(row.evidence_chain),
    status: ((typeof row.status === "string" && row.status) || "new-signal") as ThesisStatus,
    updatedAt: generatedAt ? timeAgo(generatedAt) : "recently",
    source: typeof row.source === "string" ? row.source : undefined,
    bear_case: typeof row.bear_case === "string" ? row.bear_case : null,
    adversarial_score: (() => {
      const raw = typeof row.adversarial_score === "number" ? row.adversarial_score : null;
      if (raw === null || raw < 0) return null;
      return raw;
    })(),
    passed_adversarial: (() => {
      const raw = typeof row.adversarial_score === "number" ? row.adversarial_score : null;
      if (raw === null || raw < 0) return null;
      return typeof row.passed_adversarial === "boolean" ? row.passed_adversarial : null;
    })(),
    outcome: coerceOutcome(row.outcome),
    outcome_notes: typeof row.outcome_notes === "string" ? row.outcome_notes : null,
    signal_breakdown:
      row.signal_breakdown && typeof row.signal_breakdown === "object" && !Array.isArray(row.signal_breakdown)
        ? (row.signal_breakdown as Record<string, unknown>)
        : null,
    supporting_article_ids: Array.isArray(row.supporting_articles)
      ? (row.supporting_articles.filter((x) => typeof x === "string") as string[])
      : null,
    ticker: typeof row.ticker === "string" ? row.ticker : null,
    horizon: typeof row.horizon === "string" ? row.horizon : null,
    check_after: typeof row.check_after === "string" ? row.check_after : null,
    generated_at: generatedAt,
    output_id: typeof row.output_id === "string" ? row.output_id : null,
  };
}

/**
 * Dedup key = `${title.trim().toLowerCase()}|${sector}`.
 * Paired with the "most recent by generated_at" rule in both frontend and
 * backend dedup.
 */
export function thesisDedupKey(row: { title?: string | null; sector?: string | null }): string {
  const title = String(row.title ?? "").trim().toLowerCase();
  const sector = String(row.sector ?? "").trim().toLowerCase();
  return `${title}|${sector}`;
}

/**
 * Fuzzy dedup key — uses the first 5 words of the title + sector to catch
 * near-duplicate theses like "SpaceX IPO Momentum Builds" vs
 * "SpaceX IPO Momentum Builds Amid Musk's Social Media Activity".
 */
export function thesisFuzzyKey(row: { title?: string | null; sector?: string | null }): string {
  const words = String(row.title ?? "").trim().toLowerCase().split(/\s+/).slice(0, 5).join(" ");
  const sector = String(row.sector ?? "").trim().toLowerCase();
  return `${words}|${sector}`;
}

/**
 * Deduplicate a list of theses by exact `(title|sector)` AND fuzzy
 * (first-5-words|sector), keeping the row with the most recent
 * `generated_at`. Ties resolve to the first occurrence.
 */
export function dedupByTitleSector<T extends { title?: string | null; sector?: string | null; generated_at?: string | null }>(
  rows: T[],
): { deduped: T[]; dupeCount: number } {
  const exactMap = new Map<string, T>();
  const fuzzyMap = new Map<string, T>();
  let dupeCount = 0;

  function isNewerThan(row: T, existing: T): boolean {
    return new Date(row.generated_at ?? 0).getTime() > new Date(existing.generated_at ?? 0).getTime();
  }

  for (const row of rows) {
    const exactKey = thesisDedupKey(row);
    const fuzzyKey = thesisFuzzyKey(row);

    // Check exact match first
    const exactExisting = exactMap.get(exactKey);
    if (exactExisting) {
      dupeCount++;
      if (isNewerThan(row, exactExisting)) {
        exactMap.set(exactKey, row);
        fuzzyMap.set(fuzzyKey, row);
      }
      continue;
    }

    // Check fuzzy match (catches "SpaceX IPO Momentum Builds" vs
    // "SpaceX IPO Momentum Builds Amid Musk's Social Media Activity")
    const fuzzyExisting = fuzzyMap.get(fuzzyKey);
    if (fuzzyExisting) {
      dupeCount++;
      if (isNewerThan(row, fuzzyExisting)) {
        // Remove old exact key and replace with new
        exactMap.delete(thesisDedupKey(fuzzyExisting));
        exactMap.set(exactKey, row);
        fuzzyMap.set(fuzzyKey, row);
      }
      continue;
    }

    exactMap.set(exactKey, row);
    fuzzyMap.set(fuzzyKey, row);
  }

  return { deduped: Array.from(exactMap.values()), dupeCount };
}

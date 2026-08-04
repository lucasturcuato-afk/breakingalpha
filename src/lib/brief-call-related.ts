/**
 * brief-call-related - deterministic "next to watch" matching for closed calls.
 *
 * When a desk call resolves, the brief points the reader at a genuinely
 * related object that ALREADY EXISTS: another open desk call, or an emerging
 * Radar trend cluster. Nothing here is generated; every candidate is a real
 * row fetched from the database, and the matching is plain string and sector
 * logic a test can pin down. If nothing real matches, the answer is null and
 * the UI says so quietly.
 *
 * The ladder, most specific first:
 *   1. an OPEN desk call on the same symbol
 *   2. an OPEN desk call in the same sector (via the companies table's sector
 *      label, or the sector ETF a sector-claim targets)
 *   3. an emerging trend cluster whose top_sectors overlap the call's sector
 *   4. null - "no related live call yet"
 *
 * Pure module: no fetch, no React. Importable from tests.
 */

/** The sector ETF -> sector vocabulary. Mirrors SECTOR_ETF_MAP in
 *  backend/grading/benchmarks.py (inverted); keep the two in sync. */
const ETF_SECTOR_WORDS: Record<string, string> = {
  XLK: "technology",
  XLE: "energy",
  XLF: "financial",
  XLV: "healthcare",
  XLY: "consumer",
  XLP: "consumer staples",
  XLI: "industrials",
  XLB: "materials",
  XLRE: "real estate",
  XLU: "utilities",
  XLC: "communications",
};

/** Words that carry no sector meaning on their own. */
const SECTOR_STOPWORDS = new Set(["and", "the", "of", "services", "sector"]);

/** Lower-cased meaningful tokens of a sector label ("Healthcare & Biotech"
 *  -> {healthcare, biotech}). */
export function sectorTokens(label: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const t of (label ?? "").toLowerCase().split(/[^a-z]+/)) {
    if (t.length > 1 && !SECTOR_STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

/** Whether two sector labels share any meaningful token. */
export function sectorsOverlap(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ta = sectorTokens(a);
  if (ta.size === 0) return false;
  for (const t of sectorTokens(b)) {
    if (ta.has(t)) return true;
  }
  return false;
}

/** What a call is about, sector-wise. Every source is real:
 *  - a ticker claim resolves through the companies table's sector label
 *  - a sector/index claim targeting a sector ETF resolves through the ETF map
 *  - a sector claim naming the sector in words is its own label
 *  Unknown stays null; matching then degrades to same-symbol only. */
export function callSectorLabel(
  call: { target_symbol: string | null; claim_type: string | null },
  sectorByTicker: Record<string, string>,
): string | null {
  const sym = (call.target_symbol ?? "").trim();
  if (!sym) return null;
  const type = (call.claim_type ?? "").trim().toLowerCase();
  const etfSector = ETF_SECTOR_WORDS[sym.toUpperCase()];
  if (etfSector) return etfSector;
  if (type === "ticker") return sectorByTicker[sym.toUpperCase()] ?? null;
  if (type === "sector") return sym; // sector named in words
  return null;
}

export interface RelatableCall {
  id: string;
  claim_text: string;
  target_symbol: string | null;
  claim_type: string | null;
  brief_date: string | null;
  resolve_on: string | null;
}

export interface EmergingCluster {
  id: string;
  label: string | null;
  headline: string | null;
  /** JSONB in the table but historically serialized as a JSON string. */
  top_sectors: string[] | string | null;
  created_at: string | null;
}

/** top_sectors as a real array, whatever shape the row stored. */
export function clusterSectors(c: EmergingCluster): string[] {
  const raw = c.top_sectors;
  if (Array.isArray(raw)) return raw.filter((s) => typeof s === "string");
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((s: unknown) => typeof s === "string")
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

export type RelatedNext =
  | { kind: "call"; call: RelatableCall; why: "same symbol" | "same sector" }
  | { kind: "cluster"; cluster: EmergingCluster; why: string };

/**
 * The most specific real object a closed call can point at, or null.
 * `openCalls` must already be filtered to genuinely live calls (window still
 * open, no outcome row) and ordered freshest-first, so ties break toward the
 * freshest candidate.
 */
export function findNextToWatch(
  closed: RelatableCall,
  openCalls: RelatableCall[],
  sectorByTicker: Record<string, string>,
  clusters: EmergingCluster[],
): RelatedNext | null {
  const closedSym = (closed.target_symbol ?? "").trim().toUpperCase();

  if (closedSym) {
    const same = openCalls.find(
      (o) =>
        o.id !== closed.id &&
        (o.target_symbol ?? "").trim().toUpperCase() === closedSym,
    );
    if (same) return { kind: "call", call: same, why: "same symbol" };
  }

  const closedSector = callSectorLabel(closed, sectorByTicker);
  if (closedSector) {
    const sameSector = openCalls.find(
      (o) =>
        o.id !== closed.id &&
        sectorsOverlap(closedSector, callSectorLabel(o, sectorByTicker)),
    );
    if (sameSector) return { kind: "call", call: sameSector, why: "same sector" };

    const cluster = clusters.find((c) =>
      clusterSectors(c).some((s) => sectorsOverlap(closedSector, s)),
    );
    if (cluster) return { kind: "cluster", cluster, why: closedSector };
  }

  return null;
}

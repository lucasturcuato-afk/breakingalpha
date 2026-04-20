// Minimal structural types — no import from user-profile to stay client-safe
type RelevanceProfile = {
  sectors?: string[] | null;
  inferred_sector_weights?: Record<string, number> | null;
};

type WatchlistProfile = {
  watchlist_tickers?: string[] | null;
};

function localClamp(n: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 1.0;
  return Math.max(0.3, Math.min(2.5, n));
}

function localSectorWeight(profile: RelevanceProfile, sector: string): number {
  const s = sector.trim();
  if (!s) return 1.0;
  const sectors = profile.sectors ?? [];
  const weights = profile.inferred_sector_weights ?? {};
  if (sectors.includes(s)) return localClamp((weights[s] ?? 1.0) * 1.3);
  return localClamp(weights[s] ?? 1.0);
}

function localNormalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(
      /\b(inc|corp|pbc|ltd|group|llc|plc|co|company|holdings|international|technologies|technology|solutions|services|capital|partners|ventures|management|global|systems|networks)\b/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

const SECTOR_EXPLICIT: [string, string][] = [
  ["venture capital & startup funding", "Venture Capital"],
  ["private equity & buyouts", "Private Equity"],
  ["technology m&a & investment banking", "Technology"],
  ["healthcare & biotech", "Healthcare & Biotech"],
  ["energy & oil/gas", "Energy & Oil/Gas"],
  ["financial services", "Financial Services"],
  ["consumer & retail", "Consumer & Retail"],
  ["industrials & manufacturing", "Industrials & Manufacturing"],
  ["aerospace & defense", "Aerospace & Defense"],
  ["real estate", "Real Estate"],
  ["media & telecom", "Media & Telecom"],
  ["materials & mining", "Materials & Mining"],
  ["agriculture", "Agriculture"],
  ["technology", "Technology"],
  ["venture capital", "Venture Capital"],
  ["private equity", "Private Equity"],
];

export function getDealTypeStyle(dealType: string): string {
  const t = dealType?.toLowerCase() ?? "";
  if (t.includes("m&a") || t.includes("merger") || t.includes("acquisition") || t.includes("lbo"))
    return "bg-blue-500/10 text-blue-600 dark:text-blue-300 border-blue-500/20";
  if (t.includes("vc") || t.includes("venture"))
    return "bg-purple-500/10 text-purple-600 dark:text-purple-300 border-purple-500/20";
  if (t.includes("ipo") || t.includes("spac") || t.includes("capital markets"))
    return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/20";
  if (t.includes("pe") || t.includes("private equity") || t.includes("buyout") || t.includes("minority stake"))
    return "bg-amber-500/10 text-amber-600 dark:text-amber-300 border-amber-500/20";
  if (t.includes("asset sale") || t.includes("restructur") || t.includes("recap") || t.includes("debt"))
    return "bg-rose-500/10 text-rose-600 dark:text-rose-300 border-rose-500/20";
  return "bg-white/[0.06] text-[#9a9a94] border-white/[0.10]";
}

export function normalizeSector(sector: string): string {
  const lower = sector.toLowerCase();
  for (const [pattern, label] of SECTOR_EXPLICIT) {
    if (lower.includes(pattern)) return label;
  }
  return sector.length > 24 ? sector.slice(0, 24).trimEnd() + "…" : sector;
}

export function dealRelevanceScore(
  deal: { sector?: string | null },
  profile: RelevanceProfile | null | undefined,
): "high" | "none" {
  if (!profile || !deal.sector) return "none";
  const weight = localSectorWeight(profile, normalizeSector(deal.sector));
  return weight >= 1.5 ? "high" : "none";
}

export function dealIsWatchlistMatch(
  deal: { company?: string | null },
  profile: WatchlistProfile | null | undefined,
): boolean {
  if (!profile || !deal.company) return false;
  const normalized = localNormalizeCompany(deal.company);
  return (profile.watchlist_tickers ?? []).some(
    (t) => normalized.includes(t.toLowerCase()) || t.toLowerCase().includes(normalized),
  );
}

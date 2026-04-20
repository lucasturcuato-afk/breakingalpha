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

export function normalizeSector(sector: string): string {
  const lower = sector.toLowerCase();
  for (const [pattern, label] of SECTOR_EXPLICIT) {
    if (lower.includes(pattern)) return label;
  }
  return sector.length > 24 ? sector.slice(0, 24).trimEnd() + "…" : sector;
}

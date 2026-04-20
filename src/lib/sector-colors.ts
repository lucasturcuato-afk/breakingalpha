import type { CSSProperties } from "react";

// SECTOR VERTICALS — always neutral, these are taxonomy labels not signals.
//
// NOTE: This CSS-properties value targets DARK MODE only (translucent white on
// dark surfaces). For LIGHT MODE, consumers should prefer the className-based
// path via `NEUTRAL_PILL_CLASSNAME` + `isSectorVertical`, which uses Tailwind's
// `dark:` variant so the same pill renders legibly in both themes. The
// inline-style variant is retained for sites that already rely on
// `getTagPillStyle` / `getSectorStyle` returning a CSSProperties object.
const NEUTRAL_PILL: CSSProperties = {
  backgroundColor: "rgba(255, 255, 255, 0.06)",
  color: "#9a9a94",
  border: "1px solid rgba(255, 255, 255, 0.10)",
};

// Tailwind classes for neutral pills that render correctly in both light and
// dark modes. Use with `isSectorVertical(tag)` — when true, prefer this over
// the inline-style NEUTRAL_PILL. Activity-type pills (M&A, VC, IPO, …) keep
// their semantic colors via `getActivityColor` / `getTagPillStyle`.
//
//   Light:  subtle parchment-darker bg, text-muted-ish foreground
//   Dark:   translucent white bg, mid-gray foreground
export const NEUTRAL_PILL_CLASSNAME =
  "bg-black/[0.04] text-text-secondary border border-black/[0.08] " +
  "dark:bg-white/[0.06] dark:text-text-secondary dark:border-white/[0.10]";

// Activity type → semantic color (matches getDealTypeStyle in deal-utils.ts)
function getActivityColor(activity: string): CSSProperties {
  const t = activity?.toLowerCase() ?? "";
  if (t.includes("m&a") || t.includes("merger") || t.includes("acquisition") || t.includes("lbo"))
    return { backgroundColor: "rgba(59,130,246,0.10)", color: "#93c5fd", border: "1px solid rgba(59,130,246,0.20)" };
  if (t.includes("venture capital") || t.includes("vc ") || t.includes("startup funding"))
    return { backgroundColor: "rgba(168,85,247,0.10)", color: "#d8b4fe", border: "1px solid rgba(168,85,247,0.20)" };
  if (t.includes("ipo") || t.includes("spac") || t.includes("capital markets"))
    return { backgroundColor: "rgba(16,185,129,0.10)", color: "#6ee7b7", border: "1px solid rgba(16,185,129,0.20)" };
  if (t.includes("private equity") || t.includes("buyout") || t.includes("minority stake"))
    return { backgroundColor: "rgba(245,158,11,0.10)", color: "#fcd34d", border: "1px solid rgba(245,158,11,0.20)" };
  if (t.includes("restructur") || t.includes("asset sale") || t.includes("debt financ") || t.includes("recap"))
    return { backgroundColor: "rgba(244,63,94,0.10)", color: "#fda4af", border: "1px solid rgba(244,63,94,0.20)" };
  if (t.includes("earnings") || t.includes("results") || t.includes("public markets"))
    return { backgroundColor: "rgba(14,165,233,0.10)", color: "#7dd3fc", border: "1px solid rgba(14,165,233,0.20)" };
  if (
    t.includes("geopolit") || t.includes("macro") || t.includes("regulation") ||
    t.includes("legal") || t.includes("leadership") || t.includes("operations")
  )
    return { backgroundColor: "rgba(100,116,139,0.12)", color: "#cbd5e1", border: "1px solid rgba(100,116,139,0.22)" };
  if (t.includes("fundrais") || t.includes("crypto") || t.includes("digital assets"))
    return { backgroundColor: "rgba(139,92,246,0.10)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.20)" };
  return NEUTRAL_PILL;
}

// Known sector verticals — always get neutral pill
const SECTOR_VERTICALS = [
  "technology", "healthcare", "biotech", "energy", "oil", "gas",
  "financial services", "consumer", "retail", "industrials", "manufacturing",
  "aerospace", "defense", "real estate", "media", "telecom",
  "materials", "mining", "agriculture", "fintech",
];

export function isSectorVertical(tag: string | null | undefined): boolean {
  const t = tag?.toLowerCase() ?? "";
  if (!t) return false;
  return SECTOR_VERTICALS.some((s) => t.includes(s));
}

// Legacy: getSectorStyle — now always returns neutral for true sectors
export function getSectorStyle(
  sector: string | null | undefined,
  _isDark = false,
): CSSProperties {
  if (!sector) return {};
  if (isSectorVertical(sector)) return NEUTRAL_PILL;
  return getActivityColor(sector);
}

// Vertical filter bar chips — neutral (filter UI, not data badges)
export function getVerticalStyle(_vertical: string): { bg: string; text: string; border: string } {
  return {
    bg: "rgba(255, 255, 255, 0.06)",
    text: "#9a9a94",
    border: "rgba(255, 255, 255, 0.10)",
  };
}

// Activity type filter bar chips — neutral (filter UI, not data badges)
export function getActivityTypeStyle(_activityType: string): { bg: string; text: string; border: string } {
  return {
    bg: "rgba(255, 255, 255, 0.06)",
    text: "#9a9a94",
    border: "rgba(255, 255, 255, 0.10)",
  };
}

// Tag pill helper — detects type and applies correct style
// Use this for article/story tag pills across Live Feed, Trends, Dashboard
export function getTagPillStyle(tag: string): CSSProperties {
  if (!tag) return NEUTRAL_PILL;
  if (isSectorVertical(tag)) return NEUTRAL_PILL;
  return getActivityColor(tag);
}

// Keep SECTOR_COLORS export as empty object to avoid breaking any imports
export const SECTOR_COLORS: Record<string, never> = {};

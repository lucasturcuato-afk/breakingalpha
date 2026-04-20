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

// Activity type → semantic color (matches getDealTypeStyle in deal-utils.ts).
// Each branch resolves to CSS variables defined in src/styles/tokens.css so
// pills render legibly in both light and dark modes. Activity pills sit at
// ~8-10% bg / 20-26% border — visibly more prominent than sector pills.
function getActivityColor(activity: string): CSSProperties {
  const t = activity?.toLowerCase() ?? "";
  if (t.includes("m&a") || t.includes("merger") || t.includes("acquisition") || t.includes("lbo"))
    return pillFromActivityVars("ma");
  if (t.includes("venture capital") || t.includes("vc ") || t.includes("startup funding"))
    return pillFromActivityVars("vc");
  if (t.includes("ipo") || t.includes("spac") || t.includes("capital markets"))
    return pillFromActivityVars("ipo");
  if (t.includes("private equity") || t.includes("buyout") || t.includes("minority stake"))
    return pillFromActivityVars("pe");
  if (t.includes("restructur") || t.includes("asset sale") || t.includes("debt financ") || t.includes("recap"))
    return pillFromActivityVars("restructure");
  if (t.includes("earnings") || t.includes("results") || t.includes("public markets"))
    return pillFromActivityVars("earnings");
  if (
    t.includes("geopolit") || t.includes("macro") || t.includes("regulation") ||
    t.includes("legal") || t.includes("leadership") || t.includes("operations")
  )
    return pillFromActivityVars("slate");
  if (t.includes("fundrais") || t.includes("crypto") || t.includes("digital assets"))
    return pillFromActivityVars("crypto");
  return NEUTRAL_PILL;
}

function pillFromActivityVars(name: string): CSSProperties {
  return {
    backgroundColor: `var(--pill-activity-${name}-bg)`,
    color: `var(--pill-activity-${name}-text)`,
    border: `1px solid var(--pill-activity-${name}-border)`,
  };
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

// Per-sector desaturated tint. Resolves via the CSS variables defined in
// src/styles/tokens.css for both light and dark mode. Sectors that don't
// match any keyword fall back to the neutral pill.
export function getSectorColor(sector: string | null | undefined): CSSProperties {
  const t = sector?.toLowerCase() ?? "";
  if (!t) return NEUTRAL_PILL;

  if (t.includes("technology"))
    return pillFromVars("tech");
  if (t.includes("healthcare") || t.includes("biotech"))
    return pillFromVars("health");
  if (t.includes("financial services") || t.includes("fintech"))
    return pillFromVars("finserv");
  if (t.includes("energy") || t.includes("oil") || t.includes("gas"))
    return pillFromVars("energy");
  if (t.includes("consumer") || t.includes("retail"))
    return pillFromVars("consumer");
  if (t.includes("industrials") || t.includes("manufacturing"))
    return pillFromVars("industrials");
  if (t.includes("aerospace") || t.includes("defense"))
    return pillFromVars("aerospace");
  if (t.includes("real estate"))
    return pillFromVars("realestate");
  if (t.includes("media") || t.includes("telecom"))
    return pillFromVars("media");
  if (t.includes("materials") || t.includes("mining"))
    return pillFromVars("materials");
  if (t.includes("agriculture"))
    return pillFromVars("agriculture");

  return NEUTRAL_PILL;
}

function pillFromVars(name: string): CSSProperties {
  return {
    backgroundColor: `var(--pill-sector-${name}-bg)`,
    color: `var(--pill-sector-${name}-text)`,
    border: `1px solid var(--pill-sector-${name}-border)`,
  };
}

// getSectorStyle — routes true sector verticals to their per-sector tint,
// anything else to the activity-type palette. Kept for backwards compat with
// existing consumers that pass CSSProperties through inline style.
export function getSectorStyle(
  sector: string | null | undefined,
  _isDark = false,
): CSSProperties {
  if (!sector) return {};
  if (isSectorVertical(sector)) return getSectorColor(sector);
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

// Tag pill helper — detects type and applies correct style.
// Sector verticals get their desaturated per-sector tint; activity types get
// the more prominent semantic color. Use this for article/story tag pills
// across Live Feed, Trends, Dashboard.
export function getTagPillStyle(tag: string): CSSProperties {
  if (!tag) return NEUTRAL_PILL;
  if (isSectorVertical(tag)) return getSectorColor(tag);
  return getActivityColor(tag);
}

// Keep SECTOR_COLORS export as empty object to avoid breaking any imports
export const SECTOR_COLORS: Record<string, never> = {};

import type { CSSProperties } from "react";

export const SECTOR_COLORS: Record<string, { bg: string; text: string; darkBg: string; darkText: string }> = {
  "Technology M&A": { bg: "#E8F4FD", text: "#1565C0", darkBg: "#1a3a5c", darkText: "#90CAF9" },
  "Technology M&A & Investment Banking": { bg: "#E8F4FD", text: "#1565C0", darkBg: "#1a3a5c", darkText: "#90CAF9" },
  "Healthcare & Biotech": { bg: "#E8F5E9", text: "#2E7D32", darkBg: "#1a3d1f", darkText: "#A5D6A7" },
  "Fintech & Crypto": { bg: "#FFF8E1", text: "#F57F17", darkBg: "#3d2e00", darkText: "#FFE082" },
  "Geopolitics & Macro": { bg: "#FCE4EC", text: "#880E4F", darkBg: "#3d0a1f", darkText: "#F48FB1" },
  "Public Markets & Earnings": { bg: "#EDE7F6", text: "#4527A0", darkBg: "#1a0a3d", darkText: "#CE93D8" },
  "Private Equity": { bg: "#FBE9E7", text: "#BF360C", darkBg: "#3d1200", darkText: "#FFAB91" },
  "Real Estate": { bg: "#E0F2F1", text: "#00695C", darkBg: "#003d35", darkText: "#80CBC4" },
  "Energy & Climate": { bg: "#F1F8E9", text: "#33691E", darkBg: "#1a2d00", darkText: "#C5E1A5" },
  "Venture Capital & Startup Funding": { bg: "#E3F2FD", text: "#0277BD", darkBg: "#012d4d", darkText: "#81D4FA" },
  "Defense & Aerospace": { bg: "#ECEFF1", text: "#455A64", darkBg: "#1a2327", darkText: "#B0BEC5" },
};

export function getSectorStyle(sector: string | null | undefined, isDark = false): CSSProperties {
  if (!sector) return {};
  const match = Object.keys(SECTOR_COLORS).find(
    (k) => sector.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(sector.toLowerCase()),
  );
  const colors = match ? SECTOR_COLORS[match] : null;
  if (!colors) return {};
  return isDark
    ? { backgroundColor: colors.darkBg, color: colors.darkText }
    : { backgroundColor: colors.bg, color: colors.text };
}

export const VERTICAL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "Technology":                  { bg: "rgba(59,130,246,0.1)",  text: "#60a5fa", border: "rgba(59,130,246,0.2)" },
  "Healthcare & Biotech":        { bg: "rgba(6,182,212,0.1)",   text: "#22d3ee", border: "rgba(6,182,212,0.2)" },
  "Energy & Oil/Gas":            { bg: "rgba(20,184,166,0.1)",  text: "#2dd4bf", border: "rgba(20,184,166,0.2)" },
  "Financial Services":          { bg: "rgba(14,165,233,0.1)",  text: "#38bdf8", border: "rgba(14,165,233,0.2)" },
  "Consumer & Retail":           { bg: "rgba(99,102,241,0.1)",  text: "#818cf8", border: "rgba(99,102,241,0.2)" },
  "Industrials & Manufacturing": { bg: "rgba(100,116,139,0.1)", text: "#94a3b8", border: "rgba(100,116,139,0.2)" },
  "Aerospace & Defense":         { bg: "rgba(29,78,216,0.1)",   text: "#93c5fd", border: "rgba(29,78,216,0.2)" },
  "Real Estate":                 { bg: "rgba(14,116,144,0.1)",  text: "#67e8f9", border: "rgba(14,116,144,0.2)" },
  "Media & Telecom":             { bg: "rgba(139,92,246,0.1)",  text: "#c4b5fd", border: "rgba(139,92,246,0.2)" },
  "Materials & Mining":          { bg: "rgba(71,85,105,0.1)",   text: "#cbd5e1", border: "rgba(71,85,105,0.2)" },
  "Agriculture":                 { bg: "rgba(13,148,136,0.1)",  text: "#5eead4", border: "rgba(13,148,136,0.2)" },
}

export const ACTIVITY_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "Mergers & Acquisitions":  { bg: "rgba(245,158,11,0.1)",  text: "#fbbf24", border: "rgba(245,158,11,0.2)" },
  "Private Equity":          { bg: "rgba(249,115,22,0.1)",  text: "#fb923c", border: "rgba(249,115,22,0.2)" },
  "Venture Capital":         { bg: "rgba(244,63,94,0.1)",   text: "#fb7185", border: "rgba(244,63,94,0.2)" },
  "IPO & Capital Markets":   { bg: "rgba(217,119,6,0.1)",   text: "#fcd34d", border: "rgba(217,119,6,0.2)" },
  "Earnings & Results":      { bg: "rgba(234,179,8,0.1)",   text: "#fde047", border: "rgba(234,179,8,0.2)" },
  "Macro & Policy":          { bg: "rgba(234,88,12,0.1)",   text: "#fdba74", border: "rgba(234,88,12,0.2)" },
  "Geopolitics":             { bg: "rgba(239,68,68,0.1)",   text: "#f87171", border: "rgba(239,68,68,0.2)" },
  "Regulation & Legal":      { bg: "rgba(225,29,72,0.1)",   text: "#fda4af", border: "rgba(225,29,72,0.2)" },
  "Fundraising":             { bg: "rgba(180,83,9,0.1)",    text: "#fde68a", border: "rgba(180,83,9,0.2)" },
  "Crypto & Digital Assets": { bg: "rgba(194,65,12,0.1)",   text: "#fdba74", border: "rgba(194,65,12,0.2)" },
  "Leadership & Operations": { bg: "rgba(202,138,4,0.1)",   text: "#fef08a", border: "rgba(202,138,4,0.2)" },
}

export function getVerticalStyle(vertical: string): { bg: string; text: string; border: string } {
  return VERTICAL_COLORS[vertical] ?? { bg: "rgba(59,130,246,0.1)", text: "#60a5fa", border: "rgba(59,130,246,0.2)" }
}

export function getActivityTypeStyle(activityType: string): { bg: string; text: string; border: string } {
  return ACTIVITY_TYPE_COLORS[activityType] ?? { bg: "rgba(245,158,11,0.1)", text: "#fbbf24", border: "rgba(245,158,11,0.2)" }
}

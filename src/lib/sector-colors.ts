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
  "Technology":                  { bg: "bg-blue-500/10",    text: "text-blue-400",    border: "border-blue-500/20" },
  "Healthcare & Biotech":        { bg: "bg-cyan-500/10",    text: "text-cyan-400",    border: "border-cyan-500/20" },
  "Energy & Oil/Gas":            { bg: "bg-teal-500/10",    text: "text-teal-400",    border: "border-teal-500/20" },
  "Financial Services":          { bg: "bg-sky-500/10",     text: "text-sky-400",     border: "border-sky-500/20" },
  "Consumer & Retail":           { bg: "bg-indigo-500/10",  text: "text-indigo-400",  border: "border-indigo-500/20" },
  "Industrials & Manufacturing": { bg: "bg-slate-500/10",   text: "text-slate-400",   border: "border-slate-500/20" },
  "Aerospace & Defense":         { bg: "bg-blue-700/10",    text: "text-blue-300",    border: "border-blue-700/20" },
  "Real Estate":                 { bg: "bg-cyan-700/10",    text: "text-cyan-300",    border: "border-cyan-700/20" },
  "Media & Telecom":             { bg: "bg-violet-500/10",  text: "text-violet-400",  border: "border-violet-500/20" },
  "Materials & Mining":          { bg: "bg-slate-600/10",   text: "text-slate-300",   border: "border-slate-600/20" },
  "Agriculture":                 { bg: "bg-teal-600/10",    text: "text-teal-300",    border: "border-teal-600/20" },
}

export const ACTIVITY_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "Mergers & Acquisitions":  { bg: "bg-amber-500/10",  text: "text-amber-400",  border: "border-amber-500/20" },
  "Private Equity":          { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/20" },
  "Venture Capital":         { bg: "bg-rose-500/10",   text: "text-rose-400",   border: "border-rose-500/20" },
  "IPO & Capital Markets":   { bg: "bg-amber-600/10",  text: "text-amber-300",  border: "border-amber-600/20" },
  "Earnings & Results":      { bg: "bg-yellow-500/10", text: "text-yellow-400", border: "border-yellow-500/20" },
  "Macro & Policy":          { bg: "bg-orange-600/10", text: "text-orange-300", border: "border-orange-600/20" },
  "Geopolitics":             { bg: "bg-red-500/10",    text: "text-red-400",    border: "border-red-500/20" },
  "Regulation & Legal":      { bg: "bg-rose-600/10",   text: "text-rose-300",   border: "border-rose-600/20" },
  "Fundraising":             { bg: "bg-amber-700/10",  text: "text-amber-200",  border: "border-amber-700/20" },
  "Crypto & Digital Assets": { bg: "bg-orange-700/10", text: "text-orange-300", border: "border-orange-700/20" },
  "Leadership & Operations": { bg: "bg-yellow-600/10", text: "text-yellow-300", border: "border-yellow-600/20" },
}

export function getVerticalStyle(vertical: string): { bg: string; text: string; border: string } {
  return VERTICAL_COLORS[vertical] ?? { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20" }
}

export function getActivityTypeStyle(activityType: string): { bg: string; text: string; border: string } {
  return ACTIVITY_TYPE_COLORS[activityType] ?? { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20" }
}

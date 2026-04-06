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

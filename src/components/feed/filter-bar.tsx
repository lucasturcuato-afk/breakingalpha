"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { getVerticalStyle, getActivityTypeStyle } from "@/lib/sector-colors";
import { Bell, Bookmark } from "lucide-react";

const INDUSTRY_VERTICALS = [
  "Technology", "Healthcare & Biotech", "Energy & Oil/Gas", "Financial Services",
  "Consumer & Retail", "Industrials & Manufacturing", "Aerospace & Defense",
  "Real Estate", "Media & Telecom", "Materials & Mining", "Agriculture",
];

const ACTIVITY_TYPES = [
  "Mergers & Acquisitions", "Private Equity", "Venture Capital", "IPO & Capital Markets",
  "Earnings & Results", "Macro & Policy", "Geopolitics", "Regulation & Legal",
  "Fundraising", "Crypto & Digital Assets", "Leadership & Operations",
];

// ── Shared style constants ──────────────────────────────────────────────────

const CHIP_BASE: CSSProperties = {
  fontSize: "11px",
  fontWeight: 500,
  letterSpacing: "0.02em",
  textTransform: "uppercase",
  padding: "2px 7px",
  borderRadius: "3px",
  whiteSpace: "nowrap",
  flexShrink: 0,
  cursor: "pointer",
  transition: "color 100ms, border-color 100ms",
  lineHeight: 1.4,
};

const CHIP_INACTIVE: CSSProperties = {
  backgroundColor: "transparent",
  color: "#6b7280",
  border: "1px solid #2a2a2a",
};

const CHIP_HOVER: CSSProperties = {
  backgroundColor: "transparent",
  color: "#9ca3af",
  border: "1px solid #4b5563",
};

const ROW_LABEL: CSSProperties = {
  fontSize: "9px",
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "#4b5563",
  width: "64px",
  flexShrink: 0,
};

// ── Internal Chip component (owns hover state) ──────────────────────────────

interface ChipProps {
  label: string;
  isActive: boolean;
  activeStyle: { bg: string; text: string; border: string };
  onToggle: () => void;
}

function Chip({ label, isActive, activeStyle, onToggle }: ChipProps) {
  const [hovered, setHovered] = useState(false);

  const dynamicStyle: CSSProperties = isActive
    ? {
        backgroundColor: activeStyle.bg,
        color: activeStyle.text,
        border: `1px solid ${activeStyle.border}`,
      }
    : hovered
    ? CHIP_HOVER
    : CHIP_INACTIVE;

  return (
    <button
      type="button"
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ ...CHIP_BASE, ...dynamicStyle }}
    >
      {label}
    </button>
  );
}

// ── Utility chip (Alerts / Saved) ───────────────────────────────────────────

interface UtilChipProps {
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  onToggle: () => void;
  badge?: number;
}

function UtilChip({ label, icon, isActive, onToggle, badge }: UtilChipProps) {
  const [hovered, setHovered] = useState(false);

  const GOLD = "#d4a84b";
  const dynamicStyle: CSSProperties = isActive
    ? {
        backgroundColor: "rgba(212,168,75,0.08)",
        color: GOLD,
        border: `1px solid rgba(212,168,75,0.3)`,
      }
    : hovered
    ? CHIP_HOVER
    : CHIP_INACTIVE;

  return (
    <button
      type="button"
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...CHIP_BASE,
        ...dynamicStyle,
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
      }}
    >
      {icon}
      {label}
      {badge != null && badge > 0 && (
        <span
          style={{
            fontSize: "9px",
            fontWeight: 700,
            lineHeight: 1,
            padding: "1px 4px",
            borderRadius: "2px",
            backgroundColor: isActive ? "rgba(212,168,75,0.2)" : "rgba(255,255,255,0.07)",
            color: isActive ? GOLD : "#6b7280",
            letterSpacing: 0,
            textTransform: "none",
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// ── FilterBar ───────────────────────────────────────────────────────────────

interface FilterBarProps {
  selectedVerticals: string[];
  selectedActivityTypes: string[];
  onVerticalToggle: (v: string) => void;
  onActivityTypeToggle: (a: string) => void;
  showAlertsOnly: boolean;
  onAlertsToggle: () => void;
  showSavedOnly: boolean;
  onSavedToggle: () => void;
  alertCount?: number;
}

export function FilterBar({
  selectedVerticals,
  selectedActivityTypes,
  onVerticalToggle,
  onActivityTypeToggle,
  showAlertsOnly,
  onAlertsToggle,
  showSavedOnly,
  onSavedToggle,
  alertCount = 0,
}: FilterBarProps) {
  return (
    <div
      className="bg-parchment"
      style={{ padding: "6px 16px 5px", borderBottom: "1px solid #1e1e1e" }}
    >
      {/* Row 1 — SECTORS */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: "4px" }}>
        <span style={ROW_LABEL}>Sectors</span>
        <div
          className="no-scrollbar"
          style={{ display: "flex", alignItems: "center", gap: "6px", overflowX: "auto", flex: 1 }}
        >
          {INDUSTRY_VERTICALS.map((v) => (
            <Chip
              key={v}
              label={v}
              isActive={selectedVerticals.includes(v)}
              activeStyle={getVerticalStyle(v)}
              onToggle={() => onVerticalToggle(v)}
            />
          ))}
        </div>
      </div>

      {/* Separator */}
      <div style={{ borderBottom: "1px solid #1a1a1a", marginBottom: "4px" }} />

      {/* Row 2 — ACTIVITY */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: "4px" }}>
        <span style={ROW_LABEL}>Activity</span>
        <div
          className="no-scrollbar"
          style={{ display: "flex", alignItems: "center", gap: "6px", overflowX: "auto", flex: 1 }}
        >
          {ACTIVITY_TYPES.map((a) => (
            <Chip
              key={a}
              label={a}
              isActive={selectedActivityTypes.includes(a)}
              activeStyle={getActivityTypeStyle(a)}
              onToggle={() => onActivityTypeToggle(a)}
            />
          ))}
        </div>
      </div>

      {/* Row 3 — Utility (right-aligned) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "6px" }}>
        <UtilChip
          label="Alerts"
          icon={<Bell size={9} />}
          isActive={showAlertsOnly}
          onToggle={onAlertsToggle}
          badge={alertCount}
        />
        <UtilChip
          label="Saved"
          icon={<Bookmark size={9} />}
          isActive={showSavedOnly}
          onToggle={onSavedToggle}
        />
      </div>
    </div>
  );
}

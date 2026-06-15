/**
 * MacroPanel: the deterministic macro render for the morning brief.
 *
 * Slice 1 (this file) renders ONLY the compact strip: a single glanceable line of
 * the most-cited headline numbers, each tagged with its period month. The numbers
 * come straight from the BLS + BEA data layers via the stored briefing.macro_panel
 * (never from the LLM). The strip is intentionally a curated subset, not the full set.
 *
 * Slice 2 will add a full grouped panel and a short LLM "read"; the `mode` prop and
 * the full MacroPanelData (all releases + periods) are accepted now so that lands as
 * a pure addition here, with no change to the page wiring.
 */

export interface MacroFigure {
  label: string;
  value: number | null;
  unit: string; // "%", "K" (thousands of jobs), "pp"
  prior: number | null;
}

export interface MacroRelease {
  key: string;
  name: string;
  period: string; // "May 2026" | "April 2026" | "Q1 2026"
  figures: MacroFigure[];
  vintage_note?: string;
  confidence?: string;
  series_ids?: string[];
  footnotes?: string[];
}

export interface MacroPanelData {
  releases: MacroRelease[];
  periods?: Record<string, string>;
}

interface MacroPanelProps {
  panel: MacroPanelData | null | undefined;
  /** Slice 1 implements "compact" only; "full" is reserved for slice 2. */
  mode?: "compact" | "full";
}

// Curated headline subset for the compact strip, pulled by (release key, figure
// label). The labels match the merged data layers (BLS macro_calendar, BEA
// bea_calendar); an item that does not resolve is silently skipped.
const STRIP_ITEMS: Array<{ releaseKey: string; figureLabel: string; display: string }> = [
  { releaseKey: "cpi", figureLabel: "y/y (NSA)", display: "CPI y/y" },
  { releaseKey: "core_pce", figureLabel: "y/y", display: "Core PCE y/y" },
  { releaseKey: "unemployment", figureLabel: "rate (SA)", display: "Unemployment" },
  { releaseKey: "nonfarm_payrolls", figureLabel: "m/m change (SA)", display: "Payrolls m/m" },
  { releaseKey: "gdp", figureLabel: "q/q annualized", display: "Real GDP" },
];

const GOLD_DARK = "var(--gold-dark)";

function formatValue(value: number, unit: string): string {
  if (unit === "K") {
    const sign = value >= 0 ? "+" : "";
    return `${sign}${Math.round(value)}K`;
  }
  // percent (and percentage-point) values render to one decimal
  return `${value.toFixed(1)}%`;
}

// "May 2026" -> "May"; "Q1 2026" -> "Q1". The first token is the month or quarter.
function periodTag(period: string): string {
  return (period || "").trim().split(/\s+/)[0] || "";
}

interface StripCell {
  display: string;
  valueText: string;
  tag: string;
}

function buildCells(panel: MacroPanelData): StripCell[] {
  const byKey = new Map<string, MacroRelease>();
  for (const r of panel.releases) {
    if (r && typeof r.key === "string") byKey.set(r.key, r);
  }
  const cells: StripCell[] = [];
  for (const item of STRIP_ITEMS) {
    const release = byKey.get(item.releaseKey);
    if (!release || !Array.isArray(release.figures)) continue;
    const figure = release.figures.find((f) => f.label === item.figureLabel);
    if (!figure || figure.value === null || figure.value === undefined) continue;
    cells.push({
      display: item.display,
      valueText: formatValue(figure.value, figure.unit),
      tag: periodTag(release.period),
    });
  }
  return cells;
}

export default function MacroPanel({ panel, mode = "compact" }: MacroPanelProps) {
  // Graceful: render nothing when absent / empty / nothing resolves. Never a blank block.
  if (!panel || !Array.isArray(panel.releases) || panel.releases.length === 0) return null;

  const cells = buildCells(panel);
  if (cells.length === 0) return null;

  // Slice 1: compact strip only. "full" mode is a slice-2 seam and falls through
  // to the compact strip for now (no behavior change once full mode lands).
  void mode;

  return (
    <div
      aria-label="Macro snapshot"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "8px 20px",
        padding: "12px 16px",
        borderRadius: 12,
        border: "1px solid var(--gold-border)",
        background: "var(--gold-muted)",
      }}
    >
      <span
        className="font-sans"
        style={{
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: GOLD_DARK,
          fontWeight: 800,
          marginRight: 4,
        }}
      >
        Macro
      </span>
      {cells.map((c) => (
        <span
          key={c.display}
          style={{ display: "inline-flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}
        >
          <span
            className="font-sans"
            style={{ fontSize: 11.5, color: "var(--text-secondary)", fontWeight: 600 }}
          >
            {c.display}
          </span>
          <span className="font-data" style={{ fontSize: 13, color: "var(--espresso)", fontWeight: 800 }}>
            {c.valueText}
          </span>
          {c.tag ? (
            <span className="font-sans" style={{ fontSize: 10, color: "var(--text-faint)" }}>
              {c.tag}
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

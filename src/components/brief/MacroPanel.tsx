/**
 * MacroPanel: the deterministic macro render for the morning brief.
 *
 * The numbers come straight from the BLS + BEA data layers via the stored
 * briefing.macro_panel and NEVER from the LLM. Two states, branched on
 * macro_panel.fired_today (the set of releases whose period advanced today):
 *  - quiet day (fired_today empty)  -> the slice-1 compact strip (curated subset)
 *  - release day (fired_today set)  -> the full grouped panel (Inflation / Labor /
 *    Growth, every release and figure) plus the short LLM "read" paragraph.
 * Absent / empty macro_panel renders nothing.
 *
 * The `read` is the only LLM-authored field; every figure is deterministic.
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
  fired_today?: string[];
  read?: string | null;
  // Scheduled-catalyst strip data (backend/event_calendar.py). Optional and
  // additive: rides in the same macro_panel JSON, rendered by CatalystStrip.
  catalysts?: import("./CatalystStrip").CatalystItem[];
}

interface MacroPanelProps {
  panel: MacroPanelData | null | undefined;
  /** Override the state. When omitted, the state derives from fired_today. */
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

// Full-panel grouping, by release key in display order. Keys not present in the
// payload are skipped; a group with no present releases is omitted.
const FULL_GROUPS: Array<{ title: string; keys: string[] }> = [
  { title: "Inflation", keys: ["cpi", "core_cpi", "pce", "core_pce", "ppi"] },
  { title: "Labor", keys: ["nonfarm_payrolls", "unemployment"] },
  { title: "Growth", keys: ["gdp"] },
];

const GOLD_DARK = "var(--gold-dark)";

function formatValue(value: number, unit: string): string {
  if (unit === "K") {
    const sign = value >= 0 ? "+" : "";
    return `${sign}${Math.round(value).toLocaleString()}K`;
  }
  return `${value.toFixed(1)}%`;
}

// "May 2026" -> "May"; "Q1 2026" -> "Q1". The first token is the month or quarter.
function periodTag(period: string): string {
  return (period || "").trim().split(/\s+/)[0] || "";
}

function releasesByKey(panel: MacroPanelData): Map<string, MacroRelease> {
  const byKey = new Map<string, MacroRelease>();
  for (const r of panel.releases) {
    if (r && typeof r.key === "string") byKey.set(r.key, r);
  }
  return byKey;
}

const EYEBROW: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: GOLD_DARK,
  fontWeight: 800,
};

/* ── Compact strip (quiet day) ─────────────────────────────────────────────── */

interface StripCell {
  display: string;
  valueText: string;
  tag: string;
}

function buildCells(byKey: Map<string, MacroRelease>): StripCell[] {
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

function CompactStrip({ byKey }: { byKey: Map<string, MacroRelease> }) {
  const cells = buildCells(byKey);
  if (cells.length === 0) return null;
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
      <span className="font-sans" style={{ ...EYEBROW, marginRight: 4 }}>
        Macro
      </span>
      {cells.map((c) => (
        <span
          key={c.display}
          style={{ display: "inline-flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}
        >
          <span className="font-sans" style={{ fontSize: 11.5, color: "var(--text-secondary)", fontWeight: 600 }}>
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

/* ── Full panel (release day) ──────────────────────────────────────────────── */

function FigureCell({ figure }: { figure: MacroFigure }) {
  if (figure.value === null || figure.value === undefined) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5, whiteSpace: "nowrap" }}>
      <span className="font-sans" style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>
        {figure.label}
      </span>
      <span className="font-data" style={{ fontSize: 12.5, color: "var(--espresso)", fontWeight: 800 }}>
        {formatValue(figure.value, figure.unit)}
      </span>
      {figure.prior !== null && figure.prior !== undefined ? (
        <span className="font-sans" style={{ fontSize: 10, color: "var(--text-faint)" }}>
          prior {formatValue(figure.prior, figure.unit)}
        </span>
      ) : null}
    </span>
  );
}

function ReleaseRow({ release }: { release: MacroRelease }) {
  const figures = (release.figures || []).filter((f) => f.value !== null && f.value !== undefined);
  if (figures.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        gap: "4px 16px",
        padding: "7px 0",
        borderTop: "1px solid var(--gold-border)",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, minWidth: 150 }}>
        <span className="font-sans" style={{ fontSize: 12.5, color: "var(--espresso)", fontWeight: 700 }}>
          {release.name}
        </span>
        <span className="font-sans" style={{ fontSize: 10, color: "var(--text-faint)" }}>
          {periodTag(release.period)}
        </span>
      </span>
      <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "4px 16px" }}>
        {figures.map((f, i) => (
          <FigureCell key={`${release.key}-${f.label}-${i}`} figure={f} />
        ))}
      </span>
    </div>
  );
}

function FullPanel({ byKey, read }: { byKey: Map<string, MacroRelease>; read?: string | null }) {
  const groups = FULL_GROUPS.map((g) => ({
    title: g.title,
    releases: g.keys.map((k) => byKey.get(k)).filter((r): r is MacroRelease => !!r),
  })).filter((g) => g.releases.length > 0);

  if (groups.length === 0) return null;

  return (
    <div
      aria-label="Macro panel"
      style={{
        padding: "14px 16px",
        borderRadius: 12,
        border: "1px solid var(--gold-border)",
        background: "var(--gold-muted)",
      }}
    >
      <span className="font-sans" style={EYEBROW}>
        Macro &middot; release day
      </span>
      {groups.map((g) => (
        <div key={g.title} style={{ marginTop: 10 }}>
          <p
            className="font-sans"
            style={{
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-secondary)",
              fontWeight: 700,
              margin: "0 0 2px",
            }}
          >
            {g.title}
          </p>
          {g.releases.map((r) => (
            <ReleaseRow key={r.key} release={r} />
          ))}
        </div>
      ))}

      {read && read.trim() ? (
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: "1px solid var(--gold-border)",
          }}
        >
          <p className="font-sans" style={{ ...EYEBROW, margin: "0 0 6px" }}>
            The Read
          </p>
          <p
            className="font-sans"
            style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text-primary)", margin: 0 }}
          >
            {read.trim()}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/* ── Entry ─────────────────────────────────────────────────────────────────── */

export default function MacroPanel({ panel, mode }: MacroPanelProps) {
  // Graceful: render nothing when absent / empty. Never a blank block.
  if (!panel || !Array.isArray(panel.releases) || panel.releases.length === 0) return null;

  const byKey = releasesByKey(panel);
  const isReleaseDay = Array.isArray(panel.fired_today) && panel.fired_today.length > 0;
  const effectiveMode = mode ?? (isReleaseDay ? "full" : "compact");

  return effectiveMode === "full" ? (
    <FullPanel byKey={byKey} read={panel.read} />
  ) : (
    <CompactStrip byKey={byKey} />
  );
}

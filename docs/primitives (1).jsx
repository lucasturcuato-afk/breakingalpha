// Shared primitives for all 3 directions.

const SENTIMENT_STYLES = {
  BULLISH: { bg: "var(--pill-bull-bg)", fg: "var(--pill-bull-text)", bd: "var(--pill-bull-border)" },
  BEARISH: { bg: "var(--pill-bear-bg)", fg: "var(--pill-bear-text)", bd: "var(--pill-bear-border)" },
  NEUTRAL: { bg: "var(--pill-neutral-bg)", fg: "var(--pill-neutral-text)", bd: "var(--pill-neutral-border)" },
  MIXED:   { bg: "var(--pill-mixed-bg)",   fg: "var(--pill-mixed-text)",   bd: "var(--pill-mixed-border)" },
  WATCH:   { bg: "var(--pill-watch-bg)",   fg: "var(--pill-watch-text)",   bd: "var(--pill-watch-border)" },
};

const SentimentPill = ({ tone = "NEUTRAL", size = "md" }) => {
  const s = SENTIMENT_STYLES[tone] || SENTIMENT_STYLES.NEUTRAL;
  const sizes = {
    xs: { font: 8.5, pad: "2px 5px", tr: "0.10em" },
    sm: { font: 9, pad: "3px 7px", tr: "0.10em" },
    md: { font: 10, pad: "3.5px 8px", tr: "0.12em" },
    lg: { font: 11, pad: "5px 11px", tr: "0.14em" },
  };
  const z = sizes[size] || sizes.md;
  return (
    <span style={{
      display: "inline-block",
      fontFamily: "var(--font-sans)",
      fontSize: z.font, fontWeight: 700, letterSpacing: z.tr,
      padding: z.pad, borderRadius: 3,
      background: s.bg, color: s.fg, border: `1px solid ${s.bd}`,
      whiteSpace: "nowrap",
    }}>{tone}</span>
  );
};

const Wordmark = ({ size = 18 }) => (
  <span style={{
    fontFamily: "var(--font-display)", fontWeight: 700,
    fontSize: size, color: "var(--espresso)", letterSpacing: "-0.01em",
    lineHeight: 1,
  }}>
    Signal<span style={{ color: "var(--gold)" }}>era</span>
  </span>
);

const Delta = ({ value, size = 11, mono = true }) => {
  const up = value >= 0;
  return (
    <span style={{
      fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
      fontSize: size, fontWeight: 600,
      color: up ? "var(--signal-up)" : "var(--signal-dn)",
      fontVariantNumeric: "tabular-nums",
    }}>
      {up ? "▲" : "▼"} {Math.abs(value).toFixed(2)}%
    </span>
  );
};

// Inline citation marker [n] — links to source list
const Cite = ({ n, color = "var(--gold)" }) => (
  <sup style={{
    fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700,
    color, padding: "0 2px", verticalAlign: "super", cursor: "pointer",
  }}>[{n}]</sup>
);

// Render memo paragraph text with [n] markers transformed into Cite.
const CitedText = ({ children, color }) => {
  const parts = String(children).split(/(\[\d+\])/g);
  return parts.map((p, i) => {
    const m = p.match(/^\[(\d+)\]$/);
    if (m) return <Cite key={i} n={m[1]} color={color} />;
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
};

// Sparkline — fits in any direction; tone controls color
const Sparkline = ({ values, w = 120, h = 32, stroke = "var(--gold)", fill = null, strokeWidth = 1.5 }) => {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (w - 4) + 2;
    const y = h - 2 - ((v - min) / span) * (h - 4);
    return [x, y];
  });
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const area = `${d} L${w-2},${h-2} L2,${h-2} Z`;
  return (
    <svg width={w} height={h} style={{ display: "block", overflow: "visible" }}>
      {fill && <path d={area} fill={fill} stroke="none" />}
      <path d={d} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

// Bar chart for mention counts — tighter than sparkline
const MiniBars = ({ values, w = 120, h = 28, color = "var(--gold)", gap = 2 }) => {
  const max = Math.max(...values);
  const bw = (w - gap * (values.length - 1)) / values.length;
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      {values.map((v, i) => {
        const bh = (v / max) * (h - 2);
        return <rect key={i} x={i * (bw + gap)} y={h - bh} width={bw} height={bh} fill={color} rx={1} />;
      })}
    </svg>
  );
};

// Sentiment heatmap (8 cells colored by 0..1 sentiment)
const SentimentHeat = ({ values, w = 120, h = 12, gap = 2 }) => {
  const cw = (w - gap * (values.length - 1)) / values.length;
  // Map 0..1 to red→amber→green
  const colorOf = (v) => {
    if (v < 0.4) return `rgba(220,38,38,${0.30 + 0.5 * (1 - v / 0.4)})`;
    if (v < 0.55) return `rgba(245,158,11,${0.45})`;
    return `rgba(22,163,74,${0.30 + 0.5 * Math.min(1, (v - 0.55) / 0.45)})`;
  };
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      {values.map((v, i) => (
        <rect key={i} x={i * (cw + gap)} y={0} width={cw} height={h} fill={colorOf(v)} rx={2} />
      ))}
    </svg>
  );
};

// Eyebrow label
const Eyebrow = ({ children, style, color = "var(--gold)" }) => (
  <p style={{
    fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 700,
    letterSpacing: "0.14em", textTransform: "uppercase",
    color, margin: 0, ...style,
  }}>{children}</p>
);

// Phone bezel for mobile mockups (light or dark)
const PhoneBezel = ({ children, theme = "light", w = 360, h = 760 }) => {
  const bezelBg = theme === "dark" ? "#0a0a0a" : "#1a1208";
  const screenBg = theme === "dark" ? "#0f0f0f" : "var(--cream)";
  return (
    <div style={{
      width: w + 12, height: h + 12,
      background: bezelBg, borderRadius: 44, padding: 6,
      boxShadow: "0 20px 60px rgba(26,18,8,0.12)",
    }}>
      <div style={{
        width: w, height: h, background: screenBg,
        borderRadius: 38, overflow: "hidden", position: "relative",
        display: "flex", flexDirection: "column",
      }}>
        {/* status bar */}
        <div style={{
          height: 30, flexShrink: 0, padding: "8px 22px 0",
          display: "flex", justifyContent: "space-between",
          fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 600,
          color: theme === "dark" ? "#e8e8e4" : "var(--espresso)",
        }}>
          <span>9:41</span>
          <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <span style={{ fontSize: 10 }}>●●●●</span>
            <span style={{ fontSize: 9 }}>5G</span>
            <span style={{
              display: "inline-block", width: 22, height: 10, border: "1px solid currentColor",
              borderRadius: 2, position: "relative",
            }}>
              <span style={{
                position: "absolute", inset: 1, right: 6, background: "currentColor", borderRadius: 1,
              }} />
            </span>
          </span>
        </div>
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>{children}</div>
      </div>
    </div>
  );
};

// Annotation pin — a tiny gold marker with a label, used for the inline notes
const AnnoPin = ({ n, label, position = { top: 0, left: 0 }, theme = "light" }) => (
  <div style={{
    position: "absolute", ...position, zIndex: 5,
    display: "flex", alignItems: "center", gap: 6,
    pointerEvents: "none",
  }}>
    <span style={{
      width: 18, height: 18, borderRadius: 9,
      background: "var(--gold)", color: "var(--espresso)",
      fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 10,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      boxShadow: "0 0 0 4px rgba(212,168,75,0.18)",
    }}>{n}</span>
    {label && (
      <span style={{
        fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 600,
        color: theme === "dark" ? "#e8e8e4" : "var(--espresso)",
        background: theme === "dark" ? "rgba(15,15,15,0.92)" : "rgba(255,253,249,0.96)",
        border: theme === "dark" ? "1px solid rgba(212,168,75,0.3)" : "1px solid var(--gold-border)",
        padding: "3px 7px", borderRadius: 3, whiteSpace: "nowrap",
      }}>{label}</span>
    )}
  </div>
);

window.SignaleraUI = {
  SentimentPill, Wordmark, Delta, Cite, CitedText,
  Sparkline, MiniBars, SentimentHeat,
  Eyebrow, PhoneBezel, AnnoPin,
};
Object.assign(window, window.SignaleraUI);

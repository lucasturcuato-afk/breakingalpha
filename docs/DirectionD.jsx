// Direction D — A+C SYNTHESIS · Research Workspace
// Light mode. Cream surfaces. Editorial chrome (Playfair wordmark, gold accents).
// Sidebar shell from C. A's density inside. NO terminal cosplay, NO 720px column.

const DirectionD = (() => {
  const { SentimentPill, Wordmark, Delta, CitedText, Sparkline, MiniBars, SentimentHeat, PhoneBezel } = window;
  const N = window.NVIDIA;
  const P = window.PERSHING;
  const DIR = window.DIRECTORY;
  const MK = window.MARKETS;

  // ── Tokens ──
  const D = {
    cream: "#fbf6ec",
    creamHi: "#fffdf9",
    paper: "#ffffff",
    espresso: "#1a1208",
    text: "#1a1208",
    textSoft: "#6b5a40",
    textFaint: "#a8967a",
    border: "#ede4d3",
    borderHi: "#dccfb6",
    borderSoft: "#f0e8d6",
    gold: "#d4a84b",
    goldDeep: "#a88542",
    goldFaint: "rgba(212,168,75,0.10)",
    goldBorder: "rgba(212,168,75,0.32)",
    up: "#16a34a",
    dn: "#dc2626",
    rowHover: "#f6efe0",
    rowAlt: "#f9f3e6",
    rowActive: "#fbf3df",
    purple: "#8b5cf6",
    sans: "var(--font-sans)",
    mono: "var(--font-mono)",
    serif: "var(--font-display)",
  };

  // ──────────────────────────────────────
  //  SIDEBAR — research workspace nav
  // ──────────────────────────────────────
  const Sidebar = ({ active = "company-intel" }) => (
    <aside style={{
      width: 220, flexShrink: 0,
      background: D.creamHi, borderRight: "1px solid " + D.border,
      display: "flex", flexDirection: "column", padding: "14px 10px 14px",
      fontFamily: D.sans,
    }}>
      <div style={{ padding: "4px 8px 14px", display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          width: 22, height: 22, borderRadius: 4,
          background: D.espresso, color: D.gold,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: D.serif, fontWeight: 700, fontSize: 13,
        }}>S</div>
        <span style={{
          fontFamily: D.serif, fontWeight: 700, fontSize: 17,
          color: D.espresso, letterSpacing: "-0.01em",
        }}>
          Signal<span style={{ color: D.goldDeep }}>era</span>
        </span>
      </div>

      <NavSection label="Workspace">
        <NavItem id="dash"        label="Dashboard"      active={active === "dash"} />
        <NavItem id="morning"     label="Morning Brief"  badge="3" active={active === "morning"} />
        <NavItem id="evening"     label="Evening Wrap"   active={active === "evening"} />
        <NavItem id="live"        label="Live Feed"      pulse active={active === "live"} />
      </NavSection>

      <NavSection label="Research">
        <NavItem id="thesis"       label="Thesis Board"   active={active === "thesis"} />
        <NavItem id="deal"         label="Deal Flow"      active={active === "deal"} />
        <NavItem id="company-intel"label="Company Intel"  active={active === "company-intel"} />
        <NavItem id="trends"       label="Trends"         active={active === "trends"} />
        <NavItem id="track"        label="Track Record"   active={active === "track"} />
      </NavSection>

      <NavSection label="Watchlist">
        <NavItem id="w-nvda"  label="NVIDIA"   ticker="NVDA"  pinned active={active === "w-nvda"} />
        <NavItem id="w-msft"  label="Microsoft" ticker="MSFT" pinned />
        <NavItem id="w-googl" label="Alphabet" ticker="GOOGL" pinned />
        <NavItem id="w-intc"  label="Intel"    ticker="INTC"  pinned />
        <NavItem id="w-oai"   label="OpenAI"               pinned />
        <NavItem id="w-anthropic" label="Anthropic"        pinned />
      </NavSection>

      <span style={{ flex: 1 }} />

      <div style={{
        padding: "10px 10px", borderRadius: 8,
        background: D.cream, border: "1px solid " + D.border,
        display: "flex", alignItems: "center", gap: 9,
      }}>
        <div style={{
          width: 24, height: 24, borderRadius: 12, flexShrink: 0,
          background: D.gold, color: D.espresso,
          fontFamily: D.sans, fontSize: 10, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>SC</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: D.espresso }}>Sarah Chen</div>
          <div style={{ fontSize: 10, color: D.textFaint }}>Apex Capital</div>
        </div>
        <span style={{ color: D.textFaint, fontSize: 12 }}>⚙</span>
      </div>
    </aside>
  );

  const NavSection = ({ label, children }) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        fontFamily: D.mono, fontSize: 9.5, fontWeight: 700,
        color: D.textFaint, letterSpacing: "0.12em", textTransform: "uppercase",
        padding: "8px 10px 4px",
      }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>{children}</div>
    </div>
  );

  const NavItem = ({ label, ticker, badge, pulse, pinned, active }) => (
    <div style={{
      display: "flex", alignItems: "center", gap: 9, padding: "5.5px 10px",
      borderRadius: 5,
      background: active ? D.rowActive : "transparent",
      border: active ? "1px solid " + D.goldBorder : "1px solid transparent",
      fontSize: 12.5, fontWeight: active ? 600 : 500,
      color: active ? D.espresso : D.textSoft,
      cursor: "pointer",
    }}>
      {pinned ? (
        <span style={{ color: D.gold, fontSize: 8 }}>●</span>
      ) : (
        <span style={{ color: D.textFaint, fontSize: 9 }}>○</span>
      )}
      <span style={{ flex: 1 }}>{label}</span>
      {ticker && (
        <span style={{ fontFamily: D.mono, fontSize: 9.5, color: D.textFaint, fontWeight: 600 }}>{ticker}</span>
      )}
      {badge && (
        <span style={{
          fontFamily: D.mono, fontSize: 9.5, fontWeight: 700,
          color: D.goldDeep, background: D.goldFaint,
          padding: "1px 6px", borderRadius: 3, border: "1px solid " + D.goldBorder,
        }}>{badge}</span>
      )}
      {pulse && (
        <span style={{
          width: 6, height: 6, borderRadius: 3, background: D.up,
          boxShadow: "0 0 0 3px rgba(22,163,74,0.18)",
          animation: "d-pulse 1.6s ease-in-out infinite",
        }} />
      )}
    </div>
  );

  // ──────────────────────────────────────
  //  TOP BAR — search · breadcrumb · ⌘K
  // ──────────────────────────────────────
  const TopBar = ({ crumb }) => (
    <div style={{
      height: 46, padding: "0 18px", flexShrink: 0,
      borderBottom: "1px solid " + D.border, background: D.creamHi,
      display: "flex", alignItems: "center", gap: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: D.sans, fontSize: 12, color: D.textSoft }}>
        {crumb.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ color: D.textFaint }}>›</span>}
            <span style={{ color: i === crumb.length - 1 ? D.espresso : D.textSoft, fontWeight: i === crumb.length - 1 ? 600 : 500 }}>{c}</span>
          </React.Fragment>
        ))}
      </div>
      <span style={{ flex: 1 }} />
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "5px 11px",
        background: D.cream, border: "1px solid " + D.border, borderRadius: 6,
        width: 320, fontFamily: D.sans, fontSize: 12, color: D.textFaint,
      }}>
        <span>⌕</span>
        <span>Find a company, theme, or memo…</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: D.mono, fontSize: 10, padding: "1px 5px", background: D.creamHi, border: "1px solid " + D.border, borderRadius: 3 }}>⌘K</span>
      </div>
      <SBtn>Share</SBtn>
      <SBtn primary>+ Memo</SBtn>
    </div>
  );

  const SBtn = ({ children, primary, ghost, small, danger }) => (
    <button style={{
      fontFamily: D.sans, fontSize: small ? 11 : 12, fontWeight: 500,
      padding: small ? "4px 9px" : "6px 12px",
      border: ghost ? "none" : "1px solid " + (primary ? D.goldDeep : D.borderHi),
      background: primary ? D.gold : D.creamHi,
      color: primary ? D.espresso : (danger ? D.dn : D.text),
      cursor: "pointer", borderRadius: 5,
    }}>{children}</button>
  );

  // ── Markets status strip ──
  const StatusStrip = () => (
    <div style={{
      height: 30, flexShrink: 0,
      borderBottom: "1px solid " + D.border, background: D.cream,
      display: "flex", alignItems: "center", padding: "0 18px", gap: 18,
      fontFamily: D.mono, fontSize: 11,
    }}>
      <span style={{ color: D.textFaint, fontWeight: 700, letterSpacing: "0.10em", fontSize: 9.5 }}>MARKETS</span>
      {MK.map(m => (
        <span key={m.label} style={{ display: "inline-flex", alignItems: "baseline", gap: 5 }}>
          <span style={{ color: D.textSoft }}>{m.label}</span>
          <span style={{ color: D.espresso, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{m.value}</span>
          <span style={{ color: m.change >= 0 ? D.up : D.dn, fontWeight: 600, fontSize: 10 }}>
            {m.change >= 0 ? "▲" : "▼"} {Math.abs(m.change)}%
          </span>
        </span>
      ))}
      <span style={{ flex: 1 }} />
      <span style={{ color: D.textFaint, fontStyle: "italic", fontFamily: D.sans, fontSize: 11 }}>
        Markets steady · 3 active developments
      </span>
      <span style={{ color: D.textFaint }}>•</span>
      <span style={{ color: D.textSoft }}>{new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
    </div>
  );

  // ──────────────────────────────────────
  //  DIRECTORY — desktop
  // ──────────────────────────────────────
  const Directory = () => {
    const [activeSector, setSector] = React.useState("All");
    const filtered = DIR.filter(c => activeSector === "All" || c.sector === activeSector);

    return (
      <div style={{
        width: 1280, height: 820, background: D.cream, color: D.text,
        display: "flex", overflow: "hidden", border: "1px solid " + D.border,
        fontFamily: D.sans,
      }}>
        <Sidebar active="company-intel" />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <TopBar crumb={["Research", "Company Intel"]} />
          <StatusStrip />

          {/* Page header */}
          <div style={{ padding: "14px 18px 10px", borderBottom: "1px solid " + D.border, background: D.creamHi, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
              <h1 style={{ fontFamily: D.serif, fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>Company Intel</h1>
              <span style={{ fontFamily: D.sans, fontSize: 12, color: D.textSoft }}>
                {DIR.length} companies tracked · alias-deduped · last refreshed 4m ago
              </span>
              <span style={{ flex: 1 }} />
              <SBtn small>↧ Export</SBtn>
              <SBtn small primary>+ Track company</SBtn>
            </div>

            {/* Sector chips */}
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontFamily: D.mono, fontSize: 9.5, color: D.textFaint, fontWeight: 700, letterSpacing: "0.10em", marginRight: 4 }}>SECTOR</span>
              {window.SECTORS.map(s => (
                <button key={s} onClick={() => setSector(s)} style={{
                  fontFamily: D.sans, fontSize: 11.5, fontWeight: 500,
                  padding: "3.5px 10px", borderRadius: 999,
                  border: "1px solid " + (s === activeSector ? D.goldDeep : D.border),
                  background: s === activeSector ? D.gold : D.creamHi,
                  color: s === activeSector ? D.espresso : D.textSoft,
                  cursor: "pointer",
                }}>{s}</button>
              ))}
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: D.mono, fontSize: 10, color: D.textFaint }}>
                Sort: <span style={{ color: D.espresso, fontWeight: 600 }}>Mentions ↓</span>
              </span>
            </div>
          </div>

          {/* TABLE */}
          <div style={{ flex: 1, overflow: "auto", background: D.creamHi }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: D.sans }}>
              <thead style={{ position: "sticky", top: 0, background: D.creamHi, zIndex: 1 }}>
                <tr style={{ borderBottom: "1px solid " + D.border }}>
                  <Th w={28} />
                  <Th w={26}>#</Th>
                  <Th>Company</Th>
                  <Th w={64}>Ticker</Th>
                  <Th w={68} right>Mentions</Th>
                  <Th w={140}>Trend · 7d</Th>
                  <Th w={86}>Sentiment</Th>
                  <Th w={90}>Sector</Th>
                  <Th w={56} right>Last</Th>
                  <Th w={36}>Watch</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => <Row key={c.name} c={c} idx={i + 1} highlight={c.name === "NVIDIA"} />)}
              </tbody>
            </table>
          </div>

          {/* Footer status */}
          <div style={{
            height: 26, padding: "0 18px", borderTop: "1px solid " + D.border,
            background: D.cream, display: "flex", alignItems: "center", gap: 14,
            fontFamily: D.mono, fontSize: 10, color: D.textFaint, flexShrink: 0,
          }}>
            <span>Showing <span style={{ color: D.espresso, fontWeight: 600 }}>{filtered.length}</span> of {DIR.length}</span>
            <span>•</span>
            <span>j/k or ↑↓ to navigate · enter to open · w to watchlist</span>
            <span style={{ flex: 1 }} />
            <span>Index updated 4m ago · 47 sources</span>
          </div>
        </div>
      </div>
    );
  };

  const Th = ({ children, w, right }) => (
    <td style={{
      padding: "8px 10px", fontFamily: D.mono, fontSize: 9.5, fontWeight: 700,
      color: D.textFaint, letterSpacing: "0.10em", textTransform: "uppercase",
      textAlign: right ? "right" : "left",
      width: w, whiteSpace: "nowrap",
    }}>{children}</td>
  );

  const Row = ({ c, idx, highlight }) => (
    <tr style={{
      borderBottom: "1px solid " + D.borderSoft,
      background: highlight ? D.rowActive : (idx % 2 === 0 ? D.cream : "transparent"),
    }}>
      <td style={{ padding: "5.5px 10px", textAlign: "center" }}>
        <span style={{
          width: 4, height: 14, display: "inline-block", borderRadius: 1,
          background: highlight ? D.gold : "transparent",
        }} />
      </td>
      <td style={{ padding: "5.5px 10px", fontFamily: D.mono, fontSize: 10, color: D.textFaint, fontVariantNumeric: "tabular-nums" }}>
        {String(idx).padStart(2, "0")}
      </td>
      <td style={{ padding: "5.5px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: D.espresso }}>{c.name}</span>
          {c.aliases > 1 && (
            <span title={`${c.aliases} alias forms resolved to one company`} style={{
              fontFamily: D.mono, fontSize: 9, fontWeight: 600,
              color: D.goldDeep, background: D.goldFaint,
              padding: "1px 5px", borderRadius: 2,
              border: "1px solid " + D.goldBorder,
            }}>≈{c.aliases}</span>
          )}
        </div>
      </td>
      <td style={{ padding: "5.5px 10px", fontFamily: D.mono, fontSize: 10.5, color: c.ticker ? D.textSoft : D.textFaint, fontWeight: 500 }}>
        {c.ticker || "—"}
      </td>
      <td style={{ padding: "5.5px 10px", textAlign: "right", fontFamily: D.mono, fontSize: 12, color: D.espresso, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
        {c.mentions}
        <span style={{ color: D.textFaint, fontSize: 10, fontWeight: 500 }}>x</span>
      </td>
      <td style={{ padding: "3px 10px" }}>
        <SentimentHeat values={c.d7.map(v => Math.min(1, v / 30))} w={120} h={9} gap={2} />
      </td>
      <td style={{ padding: "5.5px 10px" }}>
        <SentimentPill tone={c.tone} size="xs" />
      </td>
      <td style={{ padding: "5.5px 10px", fontFamily: D.sans, fontSize: 11, color: D.textSoft }}>{c.sector}</td>
      <td style={{ padding: "5.5px 10px", textAlign: "right", fontFamily: D.mono, fontSize: 10, color: D.textFaint }}>{c.lastTime}</td>
      <td style={{ padding: "5.5px 10px" }}>
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 18, height: 18, borderRadius: 4, cursor: "pointer",
          color: c.watch ? D.gold : D.textFaint,
          background: c.watch ? D.goldFaint : "transparent",
          fontSize: 11,
        }}>{c.watch ? "★" : "☆"}</span>
      </td>
    </tr>
  );

  // ──────────────────────────────────────
  //  DIRECTORY — mobile
  // ──────────────────────────────────────
  const DirectoryMobile = () => (
    <PhoneBezel theme="light" w={360} h={760}>
      <div style={{ background: D.cream, height: "100%", overflow: "auto", color: D.text, fontFamily: D.sans }}>
        {/* compact header */}
        <div style={{
          height: 46, padding: "0 14px", display: "flex", alignItems: "center",
          borderBottom: "1px solid " + D.border, background: D.creamHi, gap: 10,
        }}>
          <span style={{ fontSize: 18, color: D.textSoft }}>☰</span>
          <span style={{
            fontFamily: D.serif, fontWeight: 700, fontSize: 15,
            color: D.espresso, letterSpacing: "-0.01em",
          }}>
            Signal<span style={{ color: D.goldDeep }}>era</span>
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 16, color: D.textSoft }}>⌕</span>
        </div>

        {/* status strip mini */}
        <div style={{
          height: 26, padding: "0 14px", borderBottom: "1px solid " + D.border,
          background: D.cream, display: "flex", alignItems: "center", gap: 12,
          fontFamily: D.mono, fontSize: 10, overflow: "auto", whiteSpace: "nowrap",
        }}>
          {MK.map(m => (
            <span key={m.label} style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ color: D.textFaint }}>{m.label}</span>
              <span style={{ color: D.espresso, fontWeight: 600 }}>{m.value}</span>
              <span style={{ color: m.change >= 0 ? D.up : D.dn, fontWeight: 600, fontSize: 9 }}>
                {m.change >= 0 ? "▲" : "▼"}{Math.abs(m.change)}
              </span>
            </span>
          ))}
        </div>

        {/* page title */}
        <div style={{ padding: "12px 14px 8px" }}>
          <h1 style={{ fontFamily: D.serif, fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>
            Company Intel
          </h1>
          <div style={{ fontSize: 11, color: D.textSoft, marginTop: 2 }}>
            {DIR.length} companies · sorted by mentions ↓
          </div>
        </div>

        {/* sector pills horizontal scroll */}
        <div style={{
          padding: "4px 14px 10px", display: "flex", gap: 6, overflow: "auto",
          whiteSpace: "nowrap", borderBottom: "1px solid " + D.borderSoft,
        }}>
          {window.SECTORS.map((s, i) => (
            <button key={s} style={{
              fontFamily: D.sans, fontSize: 11, fontWeight: 500,
              padding: "3.5px 10px", borderRadius: 999, flexShrink: 0,
              border: "1px solid " + (i === 0 ? D.goldDeep : D.border),
              background: i === 0 ? D.gold : D.creamHi,
              color: i === 0 ? D.espresso : D.textSoft,
            }}>{s}</button>
          ))}
        </div>

        {/* compact rows */}
        <div>
          {DIR.slice(0, 14).map((c, i) => (
            <div key={c.name} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "9px 14px", borderBottom: "1px solid " + D.borderSoft,
              background: i % 2 === 0 ? D.creamHi : D.cream,
            }}>
              <span style={{ fontFamily: D.mono, fontSize: 10, color: D.textFaint, width: 18, fontVariantNumeric: "tabular-nums" }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: D.espresso }}>{c.name}</span>
                  {c.ticker && (
                    <span style={{ fontFamily: D.mono, fontSize: 9.5, color: D.textFaint }}>{c.ticker}</span>
                  )}
                  {c.aliases > 1 && (
                    <span style={{
                      fontFamily: D.mono, fontSize: 8.5, fontWeight: 600,
                      color: D.goldDeep, padding: "0 4px", borderRadius: 2,
                      background: D.goldFaint,
                    }}>≈{c.aliases}</span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <SentimentPill tone={c.tone} size="xs" />
                  <span style={{ fontFamily: D.sans, fontSize: 10, color: D.textSoft }}>{c.sector}</span>
                  <span style={{ color: D.textFaint, fontSize: 10 }}>·</span>
                  <span style={{ fontFamily: D.mono, fontSize: 10, color: D.textFaint }}>{c.lastTime}</span>
                </div>
              </div>
              <SentimentHeat values={c.d7.map(v => Math.min(1, v / 30))} w={50} h={6} gap={1} />
              <div style={{ textAlign: "right", minWidth: 40 }}>
                <div style={{ fontFamily: D.mono, fontSize: 13, fontWeight: 700, color: D.espresso, fontVariantNumeric: "tabular-nums" }}>
                  {c.mentions}
                </div>
                <div style={{ fontFamily: D.mono, fontSize: 9, color: D.textFaint }}>mentions</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </PhoneBezel>
  );

  // ──────────────────────────────────────
  //  DETAIL — desktop
  // ──────────────────────────────────────
  const Detail = () => (
    <div style={{
      width: 1280, height: 1280, background: D.cream, color: D.text,
      display: "flex", overflow: "hidden", border: "1px solid " + D.border,
      fontFamily: D.sans,
    }}>
      <Sidebar active="w-nvda" />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TopBar crumb={["Research", "Company Intel", "NVIDIA"]} />
        <StatusStrip />
        <DetailBody />
      </div>
    </div>
  );

  const DetailBody = ({ embedded } = {}) => (
    <div style={{ flex: 1, overflow: "auto", background: D.cream, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
      <CompanyHeader />
      <KPIStrip />
      <FunctionTabs />
      <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 14, alignItems: "start" }}>
        <MemoCard />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <TrendCard />
          <ThemesCard />
        </div>
      </div>
      <ArticlesTable />
      <SourcesStrip />
    </div>
  );

  // company name + alias canonical strip
  const CompanyHeader = () => (
    <div style={{ background: D.creamHi, border: "1px solid " + D.border, borderRadius: 8, padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 8, flexShrink: 0,
          background: D.cream, border: "1px solid " + D.borderHi,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: D.serif, fontSize: 20, fontWeight: 700, color: D.goldDeep,
        }}>N</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ fontFamily: D.serif, fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: "-0.015em" }}>
              {N.display}
            </h1>
            <span style={{
              fontFamily: D.mono, fontSize: 11, fontWeight: 700, color: D.goldDeep,
              padding: "2px 7px", borderRadius: 3, background: D.goldFaint,
              border: "1px solid " + D.goldBorder,
            }}>{N.ticker}</span>
            <span style={{ fontFamily: D.sans, fontSize: 12, color: D.textSoft }}>NASDAQ · Technology</span>
            <SentimentPill tone="BULLISH" size="sm" />
          </div>
          {/* canonical alias strip */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6, marginTop: 9,
            fontFamily: D.mono, fontSize: 11, color: D.textSoft,
          }}>
            <span style={{
              fontSize: 9, fontWeight: 700, color: D.goldDeep,
              padding: "1px 6px", borderRadius: 2,
              background: D.goldFaint, border: "1px solid " + D.goldBorder,
              letterSpacing: "0.08em",
            }}>CANONICAL</span>
            <span style={{ color: D.espresso, fontWeight: 600 }}>NVIDIA Corp</span>
            <span style={{ color: D.textFaint }}>·</span>
            <span>aka</span>
            {N.aliasMentions.map((a, i) => (
              <React.Fragment key={a.name}>
                {i > 0 && <span style={{ color: D.textFaint }}>·</span>}
                <span><span style={{ color: D.espresso }}>{a.name}</span> <span style={{ color: D.textFaint }}>{a.n}</span></span>
              </React.Fragment>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <SBtn small>+ Watchlist</SBtn>
          <SBtn small>↧ Export</SBtn>
          <SBtn small primary>Generate Memo</SBtn>
        </div>
      </div>
    </div>
  );

  // KPI strip
  const KPIStrip = () => (
    <div style={{
      background: D.creamHi, border: "1px solid " + D.border, borderRadius: 8,
      display: "grid", gridTemplateColumns: "repeat(6, 1fr)",
    }}>
      {[
        { l: "Last", v: "$" + N.price, d: { val: N.change, pct: true, mono: true } },
        { l: "Market cap", v: N.marketCap, sub: "3.96T" },
        { l: "Mentions · 30d", v: String(N.mentions), d: { val: 38, pct: true } },
        { l: "Sentiment", v: "+0.66", d: { val: 0.32 } },
        { l: "Articles · today", v: "9", sub: "3 events" },
        { l: "Sources", v: "7", sub: "primary + tier-1" },
      ].map((k, i) => (
        <div key={i} style={{ padding: "11px 14px", borderRight: i < 5 ? "1px solid " + D.borderSoft : "none" }}>
          <div style={{ fontFamily: D.mono, fontSize: 9.5, fontWeight: 700, color: D.textFaint, letterSpacing: "0.10em", textTransform: "uppercase" }}>{k.l}</div>
          <div style={{
            fontFamily: D.mono, fontSize: 19, fontWeight: 700, color: D.espresso,
            marginTop: 3, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em",
          }}>{k.v}</div>
          {k.d && (
            <div style={{ fontFamily: D.mono, fontSize: 11, fontWeight: 600, color: k.d.val >= 0 ? D.up : D.dn, marginTop: 1 }}>
              {k.d.val >= 0 ? "▲" : "▼"} {k.d.pct ? Math.abs(k.d.val) + "%" : Math.abs(k.d.val).toFixed(2)}
            </div>
          )}
          {k.sub && <div style={{ fontFamily: D.mono, fontSize: 10, color: D.textFaint, marginTop: 1 }}>{k.sub}</div>}
        </div>
      ))}
    </div>
  );

  // Function-key style tabs (softened — mixed case, not all-caps)
  const FunctionTabs = () => {
    const tabs = [
      { k: "F1", l: "Brief",    active: true },
      { k: "F2", l: "Articles" },
      { k: "F3", l: "Themes" },
      { k: "F4", l: "Trend" },
      { k: "F5", l: "Sources" },
      { k: "F6", l: "Filings" },
      { k: "F7", l: "Comps" },
    ];
    return (
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        {tabs.map(t => (
          <div key={t.k} style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "5px 11px", borderRadius: 5,
            border: "1px solid " + (t.active ? D.goldBorder : D.border),
            background: t.active ? D.creamHi : "transparent",
            cursor: "pointer",
          }}>
            <span style={{ fontFamily: D.mono, fontSize: 9.5, fontWeight: 700, color: t.active ? D.goldDeep : D.textFaint }}>{t.k}</span>
            <span style={{ fontFamily: D.sans, fontSize: 12, fontWeight: t.active ? 600 : 500, color: t.active ? D.espresso : D.textSoft }}>{t.l}</span>
          </div>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: D.mono, fontSize: 10, color: D.textFaint }}>
          ⌥+number to jump
        </span>
      </div>
    );
  };

  // ── Memo (the C "AI Brief · Article-grounded · 9 sources" pill is mandatory)
  const MemoCard = () => (
    <div style={{ background: D.creamHi, border: "1px solid " + D.border, borderRadius: 8, overflow: "hidden" }}>
      <div style={{
        padding: "12px 16px", borderBottom: "1px solid " + D.borderSoft,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <h3 style={{ fontFamily: D.serif, fontSize: 16, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>AI Brief</h3>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          fontFamily: D.mono, fontSize: 10, fontWeight: 600, color: D.up,
          padding: "2px 7px", borderRadius: 3,
          background: "rgba(22,163,74,0.10)", border: "1px solid rgba(22,163,74,0.28)",
        }}>
          <span style={{ width: 5, height: 5, borderRadius: 3, background: D.up }} />
          Article-grounded · 9 sources
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: D.mono, fontSize: 10, color: D.textFaint }}>4h ago · 12s</span>
        <span style={{ color: D.textFaint, cursor: "pointer", fontSize: 13 }}>↗</span>
      </div>

      <div style={{ padding: "14px 18px" }}>
        {/* TLDR */}
        <div style={{
          padding: "11px 14px", borderRadius: 6, marginBottom: 14,
          background: D.goldFaint, border: "1px solid " + D.goldBorder,
        }}>
          <div style={{ fontFamily: D.mono, fontSize: 9, fontWeight: 700, color: D.goldDeep, letterSpacing: "0.12em", marginBottom: 5 }}>TLDR</div>
          <p style={{ margin: 0, fontFamily: D.sans, fontSize: 13, lineHeight: 1.6, color: D.text }}>
            <CitedText>{N.memo.tldr}</CitedText>
          </p>
        </div>

        {/* Body sections */}
        {N.memo.paragraphs.map((p, i) => {
          const labels = { lead: "Lead", context: "Context", watch: "What to watch" };
          return (
            <div key={i} style={{ display: "flex", gap: 12, marginBottom: 12 }}>
              <span style={{
                fontFamily: D.mono, fontSize: 9, fontWeight: 700,
                color: D.textFaint, letterSpacing: "0.10em",
                width: 60, flexShrink: 0, paddingTop: 4, textTransform: "uppercase",
              }}>
                {String(i + 1).padStart(2, "0")} · {labels[p.kind]}
              </span>
              <p style={{ fontFamily: D.sans, fontSize: 13, lineHeight: 1.6, color: D.text, margin: 0, flex: 1 }}>
                <CitedText>{p.text}</CitedText>
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );

  const TrendCard = () => {
    const days = ["Apr 26", "27", "28", "29", "30", "May 1", "2", "3"];
    return (
      <div style={{ background: D.creamHi, border: "1px solid " + D.border, borderRadius: 8, overflow: "hidden" }}>
        <div style={{ padding: "11px 14px", borderBottom: "1px solid " + D.borderSoft }}>
          <h3 style={{ fontFamily: D.serif, fontSize: 14, fontWeight: 700, margin: 0 }}>Signal Trend · 8d</h3>
        </div>
        <div style={{ padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
            <span style={{ fontFamily: D.mono, fontSize: 9.5, color: D.textFaint, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase" }}>Mentions</span>
            <span style={{ fontFamily: D.mono, fontSize: 18, fontWeight: 700, color: D.espresso }}>81</span>
            <span style={{ fontFamily: D.mono, fontSize: 11, color: D.up, fontWeight: 600 }}>▲ 38%</span>
          </div>
          <MiniBars values={N.mentions7d} w={310} h={42} color={D.gold} gap={4} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
            {days.map(d => <span key={d} style={{ fontFamily: D.mono, fontSize: 8.5, color: D.textFaint }}>{d}</span>)}
          </div>

          <div style={{ height: 1, background: D.borderSoft, margin: "12px 0" }} />

          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
            <span style={{ fontFamily: D.mono, fontSize: 9.5, color: D.textFaint, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase" }}>Sentiment</span>
            <span style={{ fontFamily: D.mono, fontSize: 18, fontWeight: 700, color: D.espresso }}>+0.66</span>
            <span style={{ fontFamily: D.mono, fontSize: 11, color: D.up, fontWeight: 600 }}>▲ 0.32</span>
          </div>
          <Sparkline values={N.sentiment7d} w={310} h={36} stroke={D.up} fill="rgba(22,163,74,0.10)" strokeWidth={1.8} />
          <div style={{ marginTop: 4 }}>
            <SentimentHeat values={N.sentiment7d} w={310} h={7} gap={3} />
          </div>
        </div>
      </div>
    );
  };

  const ThemesCard = () => (
    <div style={{ background: D.creamHi, border: "1px solid " + D.border, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "11px 14px", borderBottom: "1px solid " + D.borderSoft, display: "flex", alignItems: "center" }}>
        <h3 style={{ fontFamily: D.serif, fontSize: 14, fontWeight: 700, margin: 0 }}>Themes</h3>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: D.mono, fontSize: 10, color: D.textFaint }}>{N.themes.length} extracted</span>
      </div>
      <div>
        {N.themes.map((t, i) => (
          <div key={t.label} style={{
            display: "grid", gridTemplateColumns: "16px 1fr 70px 36px 56px",
            gap: 10, padding: "7px 14px", alignItems: "center",
            borderTop: i === 0 ? "none" : "1px solid " + D.borderSoft,
          }}>
            <span style={{ fontFamily: D.mono, fontSize: 9.5, color: D.textFaint, fontVariantNumeric: "tabular-nums" }}>{String(i+1).padStart(2,"0")}</span>
            <span style={{ fontFamily: D.sans, fontSize: 12, color: D.text, fontWeight: 500 }}>{t.label}</span>
            <div style={{ height: 4, background: D.cream, borderRadius: 2, overflow: "hidden", position: "relative" }}>
              <div style={{ position: "absolute", inset: 0, width: `${t.weight * 100}%`, background: D.gold, borderRadius: 2 }} />
            </div>
            <span style={{ fontFamily: D.mono, fontSize: 10.5, color: D.textSoft, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{t.count}</span>
            <SentimentPill tone={t.tone} size="xs" />
          </div>
        ))}
      </div>
    </div>
  );

  const ArticlesTable = () => (
    <div style={{ background: D.creamHi, border: "1px solid " + D.border, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "11px 16px", borderBottom: "1px solid " + D.borderSoft, display: "flex", alignItems: "center", gap: 10 }}>
        <h3 style={{ fontFamily: D.serif, fontSize: 14, fontWeight: 700, margin: 0 }}>Recent coverage</h3>
        <span style={{ fontFamily: D.mono, fontSize: 10, color: D.textFaint }}>{N.articles.length} articles · 8d</span>
        <span style={{ flex: 1 }} />
        <SBtn small>All</SBtn>
        <SBtn small ghost>Events</SBtn>
        <SBtn small ghost>Bullish</SBtn>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid " + D.borderSoft, background: D.cream }}>
            <Th w={80}>Type</Th>
            <Th>Headline</Th>
            <Th w={130}>Source</Th>
            <Th w={50} right>Score</Th>
            <Th w={70}>Tone</Th>
            <Th w={42} right>Age</Th>
          </tr>
        </thead>
        <tbody>
          {N.articles.map((a, i) => (
            <tr key={a.id} style={{
              borderTop: i === 0 ? "none" : "1px solid " + D.borderSoft,
              background: i % 2 === 0 ? "transparent" : D.cream,
            }}>
              <td style={{ padding: "8px 10px" }}>
                {a.dealType ? (
                  <span style={{
                    fontFamily: D.mono, fontSize: 9, fontWeight: 700,
                    color: D.goldDeep, padding: "2px 6px", borderRadius: 2,
                    background: D.goldFaint, border: "1px solid " + D.goldBorder,
                  }}>{a.dealType}</span>
                ) : <span style={{ color: D.textFaint, fontSize: 11 }}>—</span>}
              </td>
              <td style={{ padding: "8px 10px", fontFamily: D.sans, fontSize: 12.5, color: D.espresso, fontWeight: 500, lineHeight: 1.4 }}>
                {a.title}
              </td>
              <td style={{ padding: "8px 10px", fontFamily: D.mono, fontSize: 10.5, color: D.textSoft }}>{a.source}</td>
              <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: D.mono, fontSize: 11, color: D.espresso, fontWeight: 600 }}>{a.score}</td>
              <td style={{ padding: "8px 10px" }}><SentimentPill tone={a.tone} size="xs" /></td>
              <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: D.mono, fontSize: 10, color: D.textFaint }}>{a.time}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const SourcesStrip = () => (
    <div style={{ background: D.creamHi, border: "1px solid " + D.border, borderRadius: 8, padding: "12px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ fontFamily: D.serif, fontSize: 14, fontWeight: 700, margin: 0 }}>Sources</h3>
        <span style={{ marginLeft: 10, fontFamily: D.mono, fontSize: 10, color: D.textFaint }}>{N.sources.length} cited</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "4px 24px" }}>
        {N.sources.map(s => (
          <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
            <span style={{ fontFamily: D.mono, fontSize: 10.5, color: D.goldDeep, fontWeight: 700, width: 22 }}>[{s.n}]</span>
            <span style={{ flex: 1, fontFamily: D.sans, fontSize: 12, color: D.text }}>{s.name}</span>
            <span style={{ fontFamily: D.mono, fontSize: 10, color: D.textFaint }}>{s.url}</span>
            <span style={{
              fontFamily: D.mono, fontSize: 8.5, fontWeight: 700, letterSpacing: "0.08em",
              padding: "1px 5px", borderRadius: 2,
              color: s.type === "primary" ? D.up : D.goldDeep,
              background: s.type === "primary" ? "rgba(22,163,74,0.10)" : D.goldFaint,
              border: "1px solid " + (s.type === "primary" ? "rgba(22,163,74,0.28)" : D.goldBorder),
            }}>{s.type.toUpperCase()}</span>
          </div>
        ))}
      </div>
    </div>
  );

  // ──────────────────────────────────────
  //  DETAIL — mobile
  // ──────────────────────────────────────
  const DetailMobile = () => (
    <PhoneBezel theme="light" w={360} h={760}>
      <div style={{ background: D.cream, height: "100%", overflow: "auto", color: D.text, fontFamily: D.sans }}>
        <div style={{ height: 44, padding: "0 14px", display: "flex", alignItems: "center", borderBottom: "1px solid " + D.border, background: D.creamHi, gap: 10 }}>
          <span style={{ fontSize: 18, color: D.textSoft }}>‹</span>
          <span style={{ fontSize: 12, color: D.textSoft }}>Company Intel</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 14, color: D.textSoft }}>★</span>
        </div>

        <div style={{ padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 7,
              background: D.creamHi, border: "1px solid " + D.borderHi,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: D.serif, fontSize: 16, fontWeight: 700, color: D.goldDeep,
            }}>N</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <h1 style={{ fontFamily: D.serif, fontSize: 19, fontWeight: 700, margin: 0, letterSpacing: "-0.015em" }}>NVIDIA</h1>
                <span style={{ fontFamily: D.mono, fontSize: 10, fontWeight: 700, color: D.goldDeep, padding: "1px 5px", borderRadius: 2, background: D.goldFaint, border: "1px solid " + D.goldBorder }}>NVDA</span>
              </div>
              <div style={{ fontSize: 10.5, color: D.textSoft, marginTop: 1 }}>NASDAQ · Technology</div>
            </div>
            <SentimentPill tone="BULLISH" size="xs" />
          </div>

          {/* alias canonical strip */}
          <div style={{
            display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, marginBottom: 12,
            fontFamily: D.mono, fontSize: 10, color: D.textSoft,
          }}>
            <span style={{ fontSize: 8, fontWeight: 700, color: D.goldDeep, padding: "1px 5px", borderRadius: 2, background: D.goldFaint, letterSpacing: "0.08em" }}>CANONICAL</span>
            <span style={{ color: D.espresso, fontWeight: 600 }}>NVIDIA Corp</span>
            <span style={{ color: D.textFaint }}>·</span>
            <span>aka {N.aliasMentions.map(a => `${a.name} ${a.n}`).join(" · ")}</span>
          </div>

          {/* compact KPI grid */}
          <div style={{
            background: D.creamHi, border: "1px solid " + D.border, borderRadius: 7,
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr", marginBottom: 12,
          }}>
            {[
              ["Last", "$" + N.price, "▲ 2.14%", D.up],
              ["Mentions", "81", "▲ 38%", D.up],
              ["Sentiment", "+0.66", "▲ 0.32", D.up],
            ].map(([l, v, d, c], i) => (
              <div key={l} style={{ padding: "9px 10px", borderRight: i < 2 ? "1px solid " + D.borderSoft : "none" }}>
                <div style={{ fontFamily: D.mono, fontSize: 8.5, color: D.textFaint, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase" }}>{l}</div>
                <div style={{ fontFamily: D.mono, fontSize: 14, fontWeight: 700, color: D.espresso, marginTop: 2 }}>{v}</div>
                <div style={{ fontFamily: D.mono, fontSize: 9.5, fontWeight: 600, color: c }}>{d}</div>
              </div>
            ))}
          </div>

          {/* function-key chips, scroll */}
          <div style={{ display: "flex", gap: 4, overflow: "auto", marginBottom: 12, paddingBottom: 4 }}>
            {[
              ["F1", "Brief", true],["F2","Articles"],["F3","Themes"],["F4","Trend"],["F5","Sources"],
            ].map(([k, l, a]) => (
              <span key={k} style={{
                display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
                padding: "4px 9px", borderRadius: 4,
                border: "1px solid " + (a ? D.goldBorder : D.border),
                background: a ? D.creamHi : "transparent",
              }}>
                <span style={{ fontFamily: D.mono, fontSize: 8.5, fontWeight: 700, color: a ? D.goldDeep : D.textFaint }}>{k}</span>
                <span style={{ fontSize: 11, fontWeight: a ? 600 : 500, color: a ? D.espresso : D.textSoft }}>{l}</span>
              </span>
            ))}
          </div>

          {/* AI brief pill + TLDR */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <h3 style={{ fontFamily: D.serif, fontSize: 14, fontWeight: 700, margin: 0 }}>AI Brief</h3>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontFamily: D.mono, fontSize: 9, fontWeight: 600, color: D.up,
              padding: "1px 6px", borderRadius: 2,
              background: "rgba(22,163,74,0.10)", border: "1px solid rgba(22,163,74,0.28)",
            }}>
              <span style={{ width: 4, height: 4, borderRadius: 2, background: D.up }} />
              Article-grounded · 9
            </span>
          </div>

          <div style={{ padding: "10px 12px", borderRadius: 6, marginBottom: 10, background: D.goldFaint, border: "1px solid " + D.goldBorder }}>
            <div style={{ fontFamily: D.mono, fontSize: 8.5, fontWeight: 700, color: D.goldDeep, letterSpacing: "0.12em", marginBottom: 4 }}>TLDR</div>
            <p style={{ margin: 0, fontFamily: D.sans, fontSize: 11.5, lineHeight: 1.5 }}>
              <CitedText>{N.memo.tldr.slice(0, 240) + "…"}</CitedText>
            </p>
          </div>

          {/* trend mini */}
          <div style={{ background: D.creamHi, border: "1px solid " + D.border, borderRadius: 7, padding: "10px 12px", marginBottom: 12 }}>
            <div style={{ fontFamily: D.mono, fontSize: 9, fontWeight: 700, color: D.textFaint, letterSpacing: "0.10em", textTransform: "uppercase", marginBottom: 6 }}>Sentiment · 8d</div>
            <Sparkline values={N.sentiment7d} w={306} h={32} stroke={D.up} fill="rgba(22,163,74,0.10)" strokeWidth={1.8} />
          </div>

          {/* recent coverage */}
          <div style={{ fontFamily: D.mono, fontSize: 9, fontWeight: 700, color: D.textFaint, letterSpacing: "0.10em", textTransform: "uppercase", marginBottom: 6 }}>
            Recent coverage · {N.articles.length}
          </div>
          {N.articles.slice(0, 4).map((a, i) => (
            <div key={a.id} style={{ padding: "9px 0", borderTop: i === 0 ? "1px solid " + D.borderSoft : "1px solid " + D.borderSoft }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                {a.dealType && (
                  <span style={{ fontFamily: D.mono, fontSize: 8.5, fontWeight: 700, color: D.goldDeep, padding: "1px 5px", borderRadius: 2, background: D.goldFaint }}>{a.dealType}</span>
                )}
                <SentimentPill tone={a.tone} size="xs" />
                <span style={{ fontFamily: D.mono, fontSize: 9.5, color: D.textSoft }}>{a.source}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: D.mono, fontSize: 9, color: D.textFaint }}>{a.time}</span>
              </div>
              <h4 style={{ fontFamily: D.sans, fontSize: 12, fontWeight: 600, margin: 0, lineHeight: 1.35, color: D.espresso }}>{a.title}</h4>
            </div>
          ))}
        </div>
      </div>
    </PhoneBezel>
  );

  // ──────────────────────────────────────
  //  MEMO MODAL
  // ──────────────────────────────────────
  const MemoModal = () => (
    <div style={{
      width: 1280, height: 820, background: "rgba(26,18,8,0.42)",
      display: "flex", alignItems: "center", justifyContent: "center",
      border: "1px solid " + D.border, overflow: "hidden",
    }}>
      <div style={{
        width: 1000, height: 720, background: D.creamHi, color: D.text,
        border: "1px solid " + D.borderHi, borderRadius: 10,
        boxShadow: "0 30px 80px rgba(26,18,8,0.30)",
        display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: D.sans,
      }}>
        <div style={{ padding: "13px 18px", borderBottom: "1px solid " + D.border, display: "flex", alignItems: "center", gap: 12 }}>
          <h2 style={{ fontFamily: D.serif, fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>NVIDIA</h2>
          <span style={{ fontFamily: D.mono, fontSize: 10, fontWeight: 700, color: D.goldDeep, padding: "1px 6px", borderRadius: 2, background: D.goldFaint, border: "1px solid " + D.goldBorder }}>NVDA</span>
          <SentimentPill tone="BULLISH" size="xs" />
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            fontFamily: D.mono, fontSize: 10, fontWeight: 600, color: D.up,
            padding: "2px 7px", borderRadius: 3,
            background: "rgba(22,163,74,0.10)", border: "1px solid rgba(22,163,74,0.28)",
          }}>
            <span style={{ width: 5, height: 5, borderRadius: 3, background: D.up }} />
            AI Brief · Article-grounded · 9 sources
          </span>
          <span style={{ flex: 1 }} />
          <SBtn small>↧ Export</SBtn>
          <SBtn small>Copy</SBtn>
          <span style={{ fontSize: 16, color: D.textSoft, cursor: "pointer", padding: "0 4px" }}>×</span>
        </div>
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <div style={{ flex: 1, padding: "22px 32px", overflow: "auto" }}>
            <div style={{ padding: "13px 16px", borderRadius: 6, marginBottom: 18, background: D.goldFaint, border: "1px solid " + D.goldBorder }}>
              <div style={{ fontFamily: D.mono, fontSize: 9, color: D.goldDeep, fontWeight: 700, letterSpacing: "0.12em", marginBottom: 5 }}>TLDR</div>
              <p style={{ margin: 0, fontFamily: D.sans, fontSize: 13.5, lineHeight: 1.6 }}>
                <CitedText>{N.memo.tldr}</CitedText>
              </p>
            </div>
            {N.memo.paragraphs.map((p, i) => {
              const labels = { lead: "Lead", context: "Context", watch: "What to watch" };
              return (
                <div key={i} style={{ marginBottom: 16 }}>
                  <div style={{ fontFamily: D.mono, fontSize: 9, fontWeight: 700, color: D.goldDeep, letterSpacing: "0.12em", marginBottom: 5, textTransform: "uppercase" }}>
                    {String(i+1).padStart(2,"0")} · {labels[p.kind]}
                  </div>
                  <p style={{ fontFamily: D.sans, fontSize: 13.5, lineHeight: 1.65, margin: 0 }}>
                    <CitedText>{p.text}</CitedText>
                  </p>
                </div>
              );
            })}
          </div>
          <aside style={{ width: 280, borderLeft: "1px solid " + D.border, background: D.cream, padding: "20px 16px", overflow: "auto" }}>
            <div style={{ fontFamily: D.mono, fontSize: 9.5, color: D.textFaint, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", marginBottom: 10 }}>
              Citations · {N.sources.length}
            </div>
            {N.sources.map(s => (
              <div key={s.n} style={{ display: "flex", gap: 9, padding: "8px 0", borderBottom: "1px solid " + D.borderSoft }}>
                <span style={{ fontFamily: D.mono, fontSize: 11, color: D.goldDeep, fontWeight: 700, width: 22 }}>[{s.n}]</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: D.sans, fontSize: 12, fontWeight: 500, lineHeight: 1.35, color: D.espresso }}>{s.name}</div>
                  <div style={{ fontFamily: D.mono, fontSize: 9.5, color: D.textFaint, marginTop: 2 }}>{s.url}</div>
                </div>
              </div>
            ))}
          </aside>
        </div>
      </div>
    </div>
  );

  // ──────────────────────────────────────
  //  WEB-FALLBACK (Pershing typo)
  // ──────────────────────────────────────
  const WebFallback = () => (
    <div style={{
      width: 1280, height: 1080, background: D.cream, color: D.text,
      display: "flex", overflow: "hidden", border: "1px solid " + D.border,
      fontFamily: D.sans,
    }}>
      <Sidebar active="company-intel" />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TopBar crumb={["Research", "Company Intel", "Pershing Square"]} />
        <StatusStrip />
        <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* A's verbatim alias-resolved typo banner */}
          <div style={{
            padding: "10px 14px", borderRadius: 6,
            background: D.goldFaint, border: "1px solid " + D.goldBorder,
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <span style={{
              fontFamily: D.mono, fontSize: 9, fontWeight: 700,
              color: D.goldDeep, padding: "2px 7px", borderRadius: 3,
              background: D.creamHi, border: "1px solid " + D.goldBorder, letterSpacing: "0.10em",
            }}>ALIAS-RESOLVED</span>
            <span style={{ fontFamily: D.sans, fontSize: 13, color: D.text }}>
              Showing <strong style={{ color: D.espresso }}>Pershing Square</strong>. Did you mean to search "<span style={{ fontFamily: D.mono, color: D.textSoft }}>Perishing Square</span>"?
            </span>
            <span style={{ flex: 1 }} />
            <SBtn small ghost>Search as typed →</SBtn>
          </div>

          {/* Web banner */}
          <div style={{
            padding: "10px 14px", borderRadius: 6,
            background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.28)",
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <span style={{
              fontFamily: D.mono, fontSize: 9, fontWeight: 700, color: D.purple,
              padding: "2px 7px", borderRadius: 3, letterSpacing: "0.10em",
              background: "rgba(139,92,246,0.10)", border: "1px solid rgba(139,92,246,0.30)",
            }}>WEB-SOURCED</span>
            <span style={{ fontFamily: D.sans, fontSize: 13, color: D.text }}>
              Not yet in our article index. Memo generated from web search · auto-upgrades to article-grounded once indexed.
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ fontFamily: D.mono, fontSize: 10, color: D.textFaint }}>EXA · 8 sources · 2.4s</span>
          </div>

          {/* Company header — purple-flavoured for non-indexed */}
          <div style={{ background: D.creamHi, border: "1px solid " + D.border, borderRadius: 8, padding: "16px 18px", display: "flex", gap: 14 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 8,
              background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.30)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: D.serif, fontSize: 20, fontWeight: 700, color: D.purple, flexShrink: 0,
            }}>P</div>
            <div style={{ flex: 1 }}>
              <h1 style={{ fontFamily: D.serif, fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: "-0.015em" }}>{P.display}</h1>
              <div style={{ fontFamily: D.sans, fontSize: 12, color: D.textSoft, marginTop: 4 }}>
                Hedge Fund · Activist · Financial Services
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 9, fontFamily: D.mono, fontSize: 11, color: D.textSoft, flexWrap: "wrap" }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: D.purple, padding: "1px 6px", borderRadius: 2, background: "rgba(139,92,246,0.10)", border: "1px solid rgba(139,92,246,0.28)", letterSpacing: "0.08em" }}>CANONICAL</span>
                <span style={{ color: D.espresso, fontWeight: 600 }}>{P.canonical}</span>
                <span style={{ color: D.textFaint }}>·</span>
                <span>aka {P.aliases.slice(0, 3).join(" · ")}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <SBtn small>+ Watchlist</SBtn>
              <SBtn small primary>Regenerate from web</SBtn>
            </div>
          </div>

          {/* Web brief */}
          <div style={{ background: D.creamHi, border: "1px solid " + D.border, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid " + D.borderSoft, display: "flex", alignItems: "center", gap: 10 }}>
              <h3 style={{ fontFamily: D.serif, fontSize: 16, fontWeight: 700, margin: 0 }}>Web Brief</h3>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                fontFamily: D.mono, fontSize: 10, fontWeight: 600, color: D.purple,
                padding: "2px 7px", borderRadius: 3,
                background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.30)",
              }}>
                <span style={{ width: 5, height: 5, borderRadius: 3, background: D.purple }} />
                Web-sourced · not in index
              </span>
            </div>
            <div style={{ padding: "16px 18px" }}>
              <div style={{ padding: "11px 14px", borderRadius: 6, marginBottom: 14, background: "rgba(139,92,246,0.05)", border: "1px solid rgba(139,92,246,0.22)" }}>
                <div style={{ fontFamily: D.mono, fontSize: 9, color: D.purple, fontWeight: 700, letterSpacing: "0.12em", marginBottom: 5 }}>TLDR · WEB</div>
                <p style={{ margin: 0, fontFamily: D.sans, fontSize: 13, lineHeight: 1.6 }}>
                  Pershing Square Capital Management is a $19B activist hedge fund founded by Bill Ackman in 2004 [w1]. Concentrated portfolio (8–12 positions) currently holds Alphabet, Hilton, Restaurant Brands, Brookfield, and Howard Hughes Holdings [w2][w3]. PSUS is the closed-end vehicle launched July 2024 [w4]. Recent activity centers on the Howard Hughes Holdings reorganization Ackman is leading personally [w5].
                </p>
              </div>
              <div style={{
                padding: "10px 14px", borderRadius: 6, border: "1px dashed " + D.borderHi,
                fontFamily: D.sans, fontSize: 12, color: D.textSoft, display: "flex", alignItems: "center", gap: 10,
              }}>
                <span style={{ fontSize: 14 }}>ⓘ</span>
                <span>This page upgrades to <strong style={{ color: D.espresso }}>article-grounded</strong> the moment our ingest indexes Pershing Square. Estimated next index: 14h.</span>
              </div>
            </div>
          </div>

          {/* Web sources */}
          <div style={{ background: D.creamHi, border: "1px solid " + D.border, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid " + D.borderSoft }}>
              <h3 style={{ fontFamily: D.serif, fontSize: 14, fontWeight: 700, margin: 0 }}>Web sources · 5</h3>
            </div>
            <div>
              {[
                ["w1", "Bill Ackman's Pershing Square at $19B AUM as Concentration Returns", "ft.com", "Apr 22"],
                ["w2", "Pershing Square 13F Q1 2026 — Five Holdings, Three New", "sec.gov", "Apr 29"],
                ["w3", "Ackman Adds to Brookfield, Hilton; Trims Restaurant Brands", "bloomberg.com", "Apr 30"],
                ["w4", "Pershing Square USA Holdings — One-Year IPO Recap", "wsj.com", "Apr 15"],
                ["w5", "Howard Hughes Holdings Reorganization Plan Filed", "businesswire.com", "Apr 28"],
              ].map(([n, t, src, when], i) => (
                <div key={n} style={{ display: "flex", gap: 12, padding: "8px 16px", alignItems: "center", borderTop: i === 0 ? "none" : "1px solid " + D.borderSoft }}>
                  <span style={{ fontFamily: D.mono, fontSize: 10.5, color: D.purple, fontWeight: 700, width: 30 }}>[{n}]</span>
                  <span style={{ flex: 1, fontFamily: D.sans, fontSize: 12.5, color: D.text }}>{t}</span>
                  <span style={{ fontFamily: D.mono, fontSize: 10.5, color: D.textSoft, width: 130 }}>{src}</span>
                  <span style={{ fontFamily: D.mono, fontSize: 10.5, color: D.textFaint }}>{when}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // ──────────────────────────────────────
  //  EMPTY STATE — editorial, not diagnostic
  // ──────────────────────────────────────
  const EmptyState = () => (
    <div style={{
      width: 1280, height: 820, background: D.cream, color: D.text,
      display: "flex", overflow: "hidden", border: "1px solid " + D.border,
      fontFamily: D.sans,
    }}>
      <Sidebar active="company-intel" />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TopBar crumb={["Research", "Company Intel", "Stripe"]} />
        <StatusStrip />
        <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* still show the company header — they exist, just not covered yet */}
          <div style={{ background: D.creamHi, border: "1px solid " + D.border, borderRadius: 8, padding: "16px 18px", display: "flex", gap: 14 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 8, flexShrink: 0,
              background: D.cream, border: "1px solid " + D.borderHi,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: D.serif, fontSize: 20, fontWeight: 700, color: D.goldDeep,
            }}>S</div>
            <div style={{ flex: 1 }}>
              <h1 style={{ fontFamily: D.serif, fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: "-0.015em" }}>Stripe</h1>
              <div style={{ fontSize: 12, color: D.textSoft, marginTop: 4 }}>Private · Financials · Payments</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <SBtn small>+ Watchlist</SBtn>
              <SBtn small primary>Generate from web</SBtn>
            </div>
          </div>

          {/* editorial empty message */}
          <div style={{
            padding: "48px 56px", background: D.creamHi,
            border: "1px solid " + D.border, borderRadius: 10,
            display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 12,
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: 28,
              background: D.goldFaint, border: "1px solid " + D.goldBorder,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: D.serif, fontSize: 24, fontWeight: 700, color: D.goldDeep,
            }}>—</div>
            <h2 style={{ fontFamily: D.serif, fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.015em", maxWidth: 480 }}>
              Stripe is on our watchlist, but no recent coverage has indexed yet.
            </h2>
            <p style={{ fontFamily: D.sans, fontSize: 14, lineHeight: 1.6, color: D.textSoft, margin: 0, maxWidth: 480 }}>
              Our ingest checked 47 sources in the last 24 hours and found no qualifying mentions. We'll notify you the moment something publishes — or you can pull a memo from the open web right now.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <SBtn>Notify me when indexed</SBtn>
              <SBtn primary>Generate from web</SBtn>
            </div>
            <div style={{
              marginTop: 18, fontFamily: D.mono, fontSize: 10.5, color: D.textFaint,
              display: "flex", gap: 18, alignItems: "center",
            }}>
              <span>Last indexed · 12 days ago</span>
              <span>•</span>
              <span>Sources checked · 47</span>
              <span>•</span>
              <span>Watchlist · 14 users</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // ──────────────────────────────────────
  //  LOADING — A's progress trace, softened
  // ──────────────────────────────────────
  const Loading = () => (
    <div style={{
      width: 1280, height: 820, background: D.cream, color: D.text,
      display: "flex", overflow: "hidden", border: "1px solid " + D.border,
      fontFamily: D.sans,
    }}>
      <Sidebar active="w-nvda" />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TopBar crumb={["Research", "Company Intel", "NVIDIA"]} />
        <StatusStrip />
        <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <CompanyHeader />
          <KPIStrip />

          <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 14 }}>
            {/* Memo skeleton + status pill */}
            <div style={{ background: D.creamHi, border: "1px solid " + D.border, borderRadius: 8, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid " + D.borderSoft, display: "flex", alignItems: "center", gap: 10 }}>
                <h3 style={{ fontFamily: D.serif, fontSize: 16, fontWeight: 700, margin: 0 }}>AI Brief</h3>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  fontFamily: D.mono, fontSize: 10, fontWeight: 600, color: D.goldDeep,
                  padding: "2px 7px", borderRadius: 3,
                  background: D.goldFaint, border: "1px solid " + D.goldBorder,
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: 3, background: D.gold, animation: "d-pulse 1s ease-in-out infinite" }} />
                  Generating · streaming
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: D.mono, fontSize: 10, color: D.textFaint }}>9 articles · in progress</span>
              </div>
              <div style={{ padding: "16px 18px" }}>
                <div style={{ padding: "11px 14px", borderRadius: 6, marginBottom: 14, background: D.goldFaint, border: "1px solid " + D.goldBorder }}>
                  <div style={{ fontFamily: D.mono, fontSize: 9, fontWeight: 700, color: D.goldDeep, letterSpacing: "0.12em", marginBottom: 7 }}>TLDR</div>
                  {[100, 92, 64].map((w, i) => (
                    <div key={i} style={{
                      height: 11, marginBottom: 6, width: w + "%", borderRadius: 3,
                      background: "linear-gradient(90deg, " + D.borderHi + " 0%, " + D.cream + " 50%, " + D.borderHi + " 100%)",
                      backgroundSize: "200% 100%", animation: "d-shimmer 1.6s ease-in-out infinite",
                    }} />
                  ))}
                </div>
                {["Lead", "Context", "What to watch"].map((label, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, marginBottom: 12, opacity: i < 2 ? 1 : 0.4 }}>
                    <span style={{ fontFamily: D.mono, fontSize: 9, fontWeight: 700, color: D.textFaint, letterSpacing: "0.10em", width: 60, paddingTop: 3, textTransform: "uppercase" }}>
                      {String(i+1).padStart(2,"0")} · {label}
                    </span>
                    <div style={{ flex: 1 }}>
                      {[100, 96, 88, 70].map((w, j) => (
                        <div key={j} style={{
                          height: 12, marginBottom: 6, width: w + "%", borderRadius: 3,
                          background: "linear-gradient(90deg, " + D.borderHi + " 0%, " + D.cream + " 50%, " + D.borderHi + " 100%)",
                          backgroundSize: "200% 100%", animation: "d-shimmer 1.6s ease-in-out infinite",
                        }} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Progress trace — softened to mixed case */}
            <div style={{ background: D.creamHi, border: "1px solid " + D.border, borderRadius: 8, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid " + D.borderSoft }}>
                <h3 style={{ fontFamily: D.serif, fontSize: 14, fontWeight: 700, margin: 0 }}>Progress</h3>
                <div style={{ fontFamily: D.mono, fontSize: 10, color: D.textFaint, marginTop: 2 }}>Pipeline · 4/6 steps complete</div>
              </div>
              <div style={{ padding: "12px 16px", fontFamily: D.mono, fontSize: 11, lineHeight: 1.8 }}>
                {[
                  ["08:23:14.231", "Resolving entity · NVIDIA", "ok"],
                  ["08:23:14.488", "Alias-table lookup · 3 forms unified", "ok"],
                  ["08:23:14.612", "Article fetch · 9 documents · 7 sources", "ok"],
                  ["08:23:15.044", "Theme extraction · 6 clusters", "ok"],
                  ["08:23:15.380", "Sentiment scoring · streaming", "active"],
                  ["—",            "Memo synthesis · queued", "queued"],
                ].map(([t, msg, st], i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ color: D.textFaint, width: 92 }}>{t}</span>
                    <span style={{
                      width: 6, height: 6, borderRadius: 3, flexShrink: 0,
                      background: st === "ok" ? D.up : (st === "active" ? D.gold : D.borderHi),
                      animation: st === "active" ? "d-pulse 1s ease-in-out infinite" : "none",
                    }} />
                    <span style={{ flex: 1, color: st === "queued" ? D.textFaint : D.text, fontFamily: D.sans, fontSize: 12 }}>{msg}</span>
                    <span style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                      color: st === "ok" ? D.up : (st === "active" ? D.goldDeep : D.textFaint),
                    }}>{st === "ok" ? "✓" : st === "active" ? "···" : "queued"}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes d-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
        @keyframes d-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
      `}</style>
    </div>
  );

  // ──────────────────────────────────────
  //  ROW COMPARISON — three treatments
  // ──────────────────────────────────────
  const RowComparison = () => {
    const c = DIR.find(x => x.name === "NVIDIA");
    return (
      <div style={{
        width: 1180, padding: 28, background: D.creamHi,
        fontFamily: D.sans, color: D.text, border: "1px solid " + D.border,
      }}>
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontFamily: D.mono, fontSize: 10, fontWeight: 700, color: D.goldDeep, letterSpacing: "0.14em", margin: "0 0 6px" }}>
            DESIGN DECISION · DIRECTORY ROW
          </p>
          <h3 style={{ fontFamily: D.serif, fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.015em" }}>
            Three ways to render the same row — same data, different trade-off.
          </h3>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* A heritage — terminal */}
          <div>
            <Caption label="A · Terminal heritage" desc="Densest possible — monospace columns, no chrome. Trade-off: ~25/screen, but reads like a console." />
            <div style={{ background: "#fffdf9", border: "1px solid " + D.border, borderRadius: 4, fontFamily: D.mono, fontSize: 11.5 }}>
              <div style={{ display: "grid", gridTemplateColumns: "30px 1fr 60px 60px 110px 80px 50px", gap: 0, padding: "5px 12px", color: D.textFaint, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.10em", borderBottom: "1px solid " + D.borderSoft }}>
                <span>#</span><span>NAME</span><span>TKR</span><span style={{ textAlign: "right" }}>MNT</span><span>TREND·7D</span><span>TONE</span><span style={{ textAlign: "right" }}>AGE</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "30px 1fr 60px 60px 110px 80px 50px", gap: 0, padding: "6px 12px", alignItems: "center" }}>
                <span style={{ color: D.textFaint }}>07</span>
                <span style={{ color: D.espresso, fontWeight: 600 }}>NVIDIA <span style={{ color: D.goldDeep, fontWeight: 700, fontSize: 9.5 }}>≈3</span></span>
                <span style={{ color: D.textSoft }}>NVDA</span>
                <span style={{ textAlign: "right", color: D.espresso, fontWeight: 700 }}>90<span style={{ color: D.textFaint, fontWeight: 500 }}>x</span></span>
                <SentimentHeat values={c.d7.map(v => Math.min(1, v / 30))} w={100} h={9} gap={2} />
                <SentimentPill tone={c.tone} size="xs" />
                <span style={{ textAlign: "right", color: D.textFaint }}>4h</span>
              </div>
            </div>
          </div>

          {/* C heritage — card with spark */}
          <div>
            <Caption label="C · Card-with-spark" desc="Generous — rich preview per row. Trade-off: only ~9/screen, fails the 25-row density bar." />
            <div style={{ background: "#fff", border: "1px solid " + D.border, borderRadius: 8, padding: "12px 14px", display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 7, flexShrink: 0,
                background: D.goldFaint, border: "1px solid " + D.goldBorder,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: D.serif, fontSize: 16, fontWeight: 700, color: D.goldDeep,
              }}>N</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  <span style={{ fontFamily: D.serif, fontSize: 16, fontWeight: 700, color: D.espresso }}>NVIDIA</span>
                  <span style={{ fontFamily: D.mono, fontSize: 10, color: D.textFaint }}>NVDA</span>
                  <SentimentPill tone={c.tone} size="xs" />
                </div>
                <div style={{ fontFamily: D.sans, fontSize: 11.5, color: D.textSoft }}>
                  Technology · 9 articles today · last 4h ago · 3 alias forms
                </div>
              </div>
              <Sparkline values={c.d7} w={130} h={36} stroke={D.gold} fill="rgba(212,168,75,0.10)" strokeWidth={1.6} />
              <div style={{ textAlign: "right", minWidth: 58 }}>
                <div style={{ fontFamily: D.mono, fontSize: 22, fontWeight: 700, color: D.espresso, lineHeight: 1 }}>90</div>
                <div style={{ fontFamily: D.mono, fontSize: 9, color: D.textFaint, marginTop: 2 }}>mentions ↑38%</div>
              </div>
            </div>
          </div>

          {/* Synthesis — what we're shipping */}
          <div>
            <Caption label="Synthesis · what ships" desc="Compact table row + heat-cell trend + alias-count chip. Hits ~25/screen, keeps the data legible, signals alias resolution without noise." goldRule />
            <div style={{ background: D.creamHi, border: "1px solid " + D.border, borderRadius: 4 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody><Row c={c} idx={7} highlight /></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const Caption = ({ label, desc, goldRule }) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6, paddingLeft: goldRule ? 0 : 0 }}>
      <span style={{
        fontFamily: D.mono, fontSize: 10, fontWeight: 700, color: goldRule ? D.goldDeep : D.textSoft,
        letterSpacing: "0.10em", textTransform: "uppercase",
        padding: goldRule ? "2px 8px" : 0,
        background: goldRule ? D.goldFaint : "transparent",
        border: goldRule ? "1px solid " + D.goldBorder : "none",
        borderRadius: goldRule ? 3 : 0, flexShrink: 0,
      }}>{label}</span>
      <span style={{ fontFamily: D.sans, fontSize: 12, color: D.textSoft, fontStyle: "italic" }}>{desc}</span>
    </div>
  );

  // ──────────────────────────────────────
  //  RATIONALE
  // ──────────────────────────────────────
  const Rationale = () => (
    <div style={{
      width: 720, padding: "44px 52px", background: D.creamHi,
      fontFamily: D.sans, color: D.text, border: "1px solid " + D.border, height: "100%",
    }}>
      <p style={{ fontFamily: D.mono, fontSize: 11, fontWeight: 700, color: D.goldDeep, letterSpacing: "0.16em", margin: "0 0 14px" }}>
        RATIONALE · A+C SYNTHESIS · v2
      </p>
      <h2 style={{ fontFamily: D.serif, fontSize: 32, fontWeight: 700, margin: "0 0 22px", letterSpacing: "-0.02em", lineHeight: 1.15 }}>
        Research workspace, editorial chrome.
      </h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: D.sans, fontSize: 13.5, lineHeight: 1.65, color: D.text }}>
        <p style={{ margin: 0 }}>
          <strong style={{ color: D.espresso }}>Directory and detail are one product.</strong> The sidebar, top bar, status strip, and brand chrome are identical across both surfaces — opening a company doesn't feel like a context switch, it feels like drilling in. Workspace · Research · Watchlist live in the same rail; Company Intel is one node, not the whole app.
        </p>
        <p style={{ margin: 0 }}>
          <strong style={{ color: D.espresso }}>What B's editorial restraint sacrificed.</strong> The 720px reading column, drop caps, italic deck, and pull-quote TLDR all communicated <em>this is a publication</em>. The actual user is an analyst opening 14 companies in 90 seconds. Density wins; the editorial voice survives in the <em>chrome</em> (Playfair wordmark, cream, gold accents, Playfair section headings) — not in the data layout.
        </p>
        <p style={{ margin: 0 }}>
          <strong style={{ color: D.espresso }}>Alias resolution in the directory.</strong> The <span style={{ fontFamily: D.mono, fontSize: 12, color: D.goldDeep, fontWeight: 600 }}>≈3</span> chip next to a name says "this row represents three surface forms unified to one canonical entity." It's intentionally small — it doesn't scream when there's only one alias, it grows louder as the count rises. The <span style={{ fontFamily: D.mono, fontSize: 12 }}>x</span> suffix on mention counts ("90x") connotes the deduped total without an explanation. Hovering the chip reveals the alias breakdown.
        </p>
        <p style={{ margin: 0 }}>
          <strong style={{ color: D.espresso }}>Least-sure surface.</strong> The function-key tab row (F1–F7). Softening "F1 BRIEF" to "F1 Brief" is a step away from terminal cosplay, but the tab strip is still a heritage gesture — modern users may not recognize the F-key affordance, in which case it's just visual noise. A backup option is to drop the F-keys entirely and use plain tabs, keeping ⌥+number as a hidden keyboard shortcut. Worth user testing before committing.
        </p>
      </div>

      <div style={{
        marginTop: 28, padding: "14px 18px",
        background: D.cream, border: "1px solid " + D.border, borderRadius: 6,
        fontFamily: D.mono, fontSize: 10, color: D.textFaint, letterSpacing: "0.05em",
      }}>
        <strong style={{ color: D.espresso, letterSpacing: "0.10em", textTransform: "uppercase", fontSize: 9.5 }}>Hard constraints met</strong>
        <ul style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.8, color: D.textSoft }}>
          <li>Light mode only · cream + gold + espresso preserved</li>
          <li>~28 rows visible on directory desktop without scroll</li>
          <li>No new fonts — Playfair / Inter / JetBrains Mono only</li>
          <li>Wordmark unchanged · Playfair, "Signal" espresso + "era" gold</li>
          <li>"AI Brief · Article-grounded · 9 sources" pill in every memo header</li>
          <li>A's typo redirect banner verbatim · A's progress trace verbatim (mixed case)</li>
        </ul>
      </div>
    </div>
  );

  return { Directory, DirectoryMobile, Detail, DetailMobile, MemoModal, WebFallback, EmptyState, Loading, RowComparison, Rationale };
})();

window.DirectionD = DirectionD;

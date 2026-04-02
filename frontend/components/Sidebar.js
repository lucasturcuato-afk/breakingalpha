import { useState } from 'react'
import styles from './Sidebar.module.css'

// ── Nav item definitions ──────────────────────────────────────────────────────
// Icons are 15×15 to stay crisp at the tight density target.

const NAV = [
  {
    id: 'morning',
    label: 'Morning Review',
    short: 'Morning',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="5"/>
        <line x1="12" y1="1" x2="12" y2="3"/>
        <line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1" y1="12" x2="3" y2="12"/>
        <line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>
    ),
  },
  {
    id: 'live',
    label: 'Live Tracker',
    short: 'Live',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
    live: true,
  },
  {
    id: 'evening',
    label: 'Evening Wrap',
    short: 'Evening',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
    ),
  },
  {
    id: 'dealflow',
    label: 'Deal Flow',
    short: 'Deals',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
      </svg>
    ),
  },
  {
    id: 'thesis',
    label: 'Thesis Board',
    short: 'Thesis',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
      </svg>
    ),
  },
  {
    id: 'companies',
    label: 'Company Intel',
    short: 'Intel',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M3 9h18"/>
        <path d="M9 21V9"/>
      </svg>
    ),
  },
  {
    id: 'trends',
    label: 'Trends',
    short: 'Trends',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
        <polyline points="17 6 23 6 23 12"/>
      </svg>
    ),
  },
]

const SECTORS = [
  { name: 'Technology M&A',    color: '#f59e0b' },
  { name: 'Venture Capital',   color: '#8b5cf6' },
  { name: 'Private Equity',    color: '#3b82f6' },
  { name: 'Public Markets',    color: '#10b981' },
  { name: 'Geopolitics',       color: '#ef4444' },
  { name: 'Real Estate',       color: '#f97316' },
  { name: 'Fintech & Crypto',  color: '#06b6d4' },
  { name: 'Healthcare',        color: '#ec4899' },
  { name: 'Energy',            color: '#84cc16' },
  { name: 'Consumer & Retail', color: '#a78bfa' },
]

// ── Design tokens (mirrors globals.css) ──────────────────────────────────────
const T = {
  bg:          '#060a15',
  surface:     '#08080f',
  border:      '#111827',
  border2:     '#1a2235',
  amber:       '#e8940a',
  amberHover:  'rgba(232,148,10,0.06)',
  amberActive: 'rgba(232,148,10,0.10)',
  text:        '#e8e8f5',
  text2:       '#a0a0c0',
  text3:       '#55556e',
  text4:       '#32324a',
  mono:        "'DM Mono', 'JetBrains Mono', monospace",
  sans:        "'DM Sans', 'Inter', system-ui, sans-serif",
  green:       '#16c25e',
  red:         '#e83a3a',
}

const EXPANDED_W = 220
const COLLAPSED_W = 52

// ── ChevronLeft / ChevronRight icons ─────────────────────────────────────────
function IconChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  )
}
function IconChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  )
}

// ── Sidebar component ─────────────────────────────────────────────────────────
export default function Sidebar({ activeTab, onTabChange, marketTime, marketOpen }) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <>
      <aside
        className={styles['sb-root']}
        style={{
          width: collapsed ? COLLAPSED_W : EXPANDED_W,
          flexShrink: 0,
          background: T.bg,
          borderRight: `1px solid ${T.border}`,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflowX: 'hidden',
          overflowY: 'auto',
          userSelect: 'none',
        }}
        aria-label="Main navigation"
      >

        {/* ── Logo + collapse toggle ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          padding: collapsed ? '14px 0' : '14px 12px 13px',
          borderBottom: `1px solid ${T.border}`,
          flexShrink: 0,
          gap: 6,
          minHeight: 52,
        }}>
          {!collapsed && (
            <div style={{ overflow: 'hidden' }}>
              <div style={{
                fontFamily: "'Cormorant Garamond', Georgia, serif",
                fontSize: '19px',
                fontWeight: 700,
                lineHeight: 1.1,
                whiteSpace: 'nowrap',
              }}>
                <span style={{ color: T.text }}>Breaking</span>
                <span style={{ color: T.amber }}>Alpha</span>
              </div>
              <div style={{
                fontSize: '9px',
                fontFamily: T.mono,
                color: T.text4,
                letterSpacing: '0.16em',
                marginTop: '2px',
                whiteSpace: 'nowrap',
              }}>
                MARKET INTELLIGENCE
              </div>
            </div>
          )}

          {collapsed && (
            <div style={{
              fontFamily: "'Cormorant Garamond', Georgia, serif",
              fontSize: '17px',
              fontWeight: 700,
              lineHeight: 1,
            }}>
              <span style={{ color: T.text }}>B</span>
              <span style={{ color: T.amber }}>α</span>
            </div>
          )}

          <button
            className={styles['sb-collapse-btn']}
            onClick={() => setCollapsed(c => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand' : 'Collapse'}
            style={{ marginLeft: collapsed ? 0 : 'auto' }}
          >
            {collapsed ? <IconChevronRight /> : <IconChevronLeft />}
          </button>
        </div>

        {/* ── Primary navigation ── */}
        <nav
          style={{ padding: '6px 0', flexShrink: 0 }}
          aria-label="Primary"
        >
          {NAV.map(item => (
            <button
              key={item.id}
              className={`${styles['sb-nav-item']}${activeTab === item.id ? ' ' + styles.active : ''}`}
              onClick={() => onTabChange(item.id)}
              title={collapsed ? item.label : undefined}
              aria-current={activeTab === item.id ? 'page' : undefined}
              style={{
                justifyContent: collapsed ? 'center' : undefined,
                padding: collapsed ? '6px 0' : '6px 10px',
              }}
            >
              <span className={styles['sb-icon']}>
                {item.icon}
              </span>

              {!collapsed && (
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.short}
                </span>
              )}

              {/* Live pulse dot */}
              {item.live && !collapsed && (
                <span
                  className={styles['sb-pulse']}
                  aria-label="Live"
                  style={{
                    marginLeft: 'auto',
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: T.green,
                    flexShrink: 0,
                  }}
                />
              )}
              {item.live && collapsed && activeTab !== item.id && (
                <span
                  className={styles['sb-pulse']}
                  style={{
                    position: 'absolute',
                    top: 5,
                    right: 5,
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    background: T.green,
                  }}
                />
              )}
            </button>
          ))}
        </nav>

        {/* ── Divider ── */}
        <div style={{ height: 1, background: T.border, flexShrink: 0, margin: '2px 0' }} />

        {/* ── Sectors tracked ── */}
        <div style={{ padding: collapsed ? '10px 0' : '10px 0 8px', flexShrink: 0 }}>
          {!collapsed && (
            <div style={{
              fontSize: '9px',
              fontFamily: T.mono,
              color: T.text4,
              letterSpacing: '0.14em',
              padding: '0 12px 6px',
            }}>
              SECTORS TRACKED
            </div>
          )}

          {SECTORS.map(s => (
            <div
              key={s.name}
              className={styles['sb-sector-row']}
              style={{
                justifyContent: collapsed ? 'center' : undefined,
                padding: collapsed ? '4px 0' : '3px 10px',
              }}
              title={collapsed ? s.name : undefined}
            >
              <div style={{
                width: collapsed ? 5 : 4,
                height: collapsed ? 5 : 4,
                borderRadius: '1px',
                background: s.color,
                flexShrink: 0,
              }} />
              {!collapsed && (
                <span className={styles['sb-sector-label']}>{s.name}</span>
              )}
            </div>
          ))}
        </div>

        {/* ── Divider ── */}
        <div style={{ height: 1, background: T.border, flexShrink: 0, margin: '2px 0' }} />

        {/* ── Market status ── */}
        <div style={{
          padding: collapsed ? '10px 0' : '10px 12px 12px',
          marginTop: 'auto',
          flexShrink: 0,
        }}>
          {!collapsed && (
            <>
              <div style={{
                fontSize: '9px',
                fontFamily: T.mono,
                color: T.text4,
                letterSpacing: '0.14em',
                marginBottom: '6px',
              }}>
                MARKET TIME
              </div>
              <div style={{
                fontSize: '11px',
                fontFamily: T.mono,
                color: T.text3,
                lineHeight: 1.55,
                marginBottom: '8px',
              }}>
                {marketTime || '—'}
              </div>
            </>
          )}

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            justifyContent: collapsed ? 'center' : undefined,
          }}
            title={collapsed ? (marketOpen ? 'US Equities Open' : 'US Equities Closed') : undefined}
          >
            <span
              className={styles['sb-pulse']}
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: marketOpen ? T.green : T.red,
                flexShrink: 0,
              }}
            />
            {!collapsed && (
              <span style={{
                fontSize: '10px',
                fontFamily: T.mono,
                color: marketOpen ? T.green : T.red,
                letterSpacing: '0.1em',
              }}>
                US {marketOpen ? 'OPEN' : 'CLOSED'}
              </span>
            )}
          </div>
        </div>

      </aside>
    </>
  )
}

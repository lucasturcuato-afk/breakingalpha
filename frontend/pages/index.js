import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// ── Sector config ──
const SECTORS = [
  { key: 'ALL', label: 'ALL SECTORS', match: null, color: '#f59e0b' },
  { key: 'tech', label: 'TECHNOLOGY', match: 'Technology', color: '#f59e0b' },
  { key: 'vc', label: 'VENTURE', match: 'Venture', color: '#8b5cf6' },
  { key: 'pe', label: 'PRIVATE EQUITY', match: 'Private', color: '#3b82f6' },
  { key: 'public', label: 'PUBLIC MARKETS', match: 'Public', color: '#10b981' },
  { key: 'geo', label: 'GEOPOLITICS', match: 'Geopolit', color: '#ef4444' },
  { key: 're', label: 'REAL ESTATE', match: 'Real Estate', color: '#f97316' },
  { key: 'fin', label: 'FINTECH', match: 'Fintech', color: '#06b6d4' },
  { key: 'health', label: 'HEALTHCARE', match: 'Health', color: '#ec4899' },
  { key: 'energy', label: 'ENERGY', match: 'Energy', color: '#84cc16' },
  { key: 'consumer', label: 'CONSUMER', match: 'Consumer', color: '#a78bfa' },
]

const SECTOR_COLOR_MAP = {
  'Technology': '#f59e0b',
  'Venture': '#8b5cf6',
  'Private': '#3b82f6',
  'Public': '#10b981',
  'Geopolit': '#ef4444',
  'Real Estate': '#f97316',
  'Fintech': '#06b6d4',
  'Health': '#ec4899',
  'Energy': '#84cc16',
  'Consumer': '#a78bfa',
}

function getSectorColor(sector) {
  if (!sector) return '#64748b'
  for (const [key, color] of Object.entries(SECTOR_COLOR_MAP)) {
    if (sector.includes(key)) return color
  }
  return '#64748b'
}

// ── Ticker Bar ──
function TickerBar({ quotes }) {
  if (!quotes || quotes.length === 0) return null
  const items = [...quotes, ...quotes]
  return (
    <div style={{
      background: 'rgba(0,0,0,0.7)',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      overflow: 'hidden',
      height: '32px',
      display: 'flex',
      alignItems: 'center',
      position: 'relative',
    }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '60px', background: 'linear-gradient(to right, #080c18, transparent)', zIndex: 2 }} />
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '60px', background: 'linear-gradient(to left, #080c18, transparent)', zIndex: 2 }} />
      <div style={{ display: 'flex', animation: 'scrollTicker 50s linear infinite', whiteSpace: 'nowrap' }}>
        {items.map((q, i) => (
          <span key={i} style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '0 24px', fontSize: '11px',
            fontFamily: "'DM Mono', monospace",
            color: 'rgba(255,255,255,0.7)',
            borderRight: '1px solid rgba(255,255,255,0.06)',
          }}>
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '10px' }}>{q.symbol}</span>
            <span style={{ color: '#fff', fontWeight: 600 }}>{q.price.toFixed(2)}</span>
            <span style={{ color: q.pct >= 0 ? '#4ade80' : '#f87171', fontSize: '10px' }}>
              {q.pct >= 0 ? '▲' : '▼'} {Math.abs(q.pct).toFixed(2)}%
            </span>
          </span>
        ))}
      </div>
      <style>{`@keyframes scrollTicker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>
    </div>
  )
}

// ── Sector Pill ──
function SectorPill({ sector }) {
  const color = getSectorColor(sector)
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: '4px',
      fontSize: '10px', fontFamily: "'DM Mono', monospace", letterSpacing: '0.05em',
      color, background: color + '18', border: `1px solid ${color}40`,
    }}>
      {sector}
    </span>
  )
}

// ── Article Card ──
function ArticleCard({ article }) {
  const [expanded, setExpanded] = useState(false)
  const companies = Array.isArray(article.companies_mentioned)
    ? article.companies_mentioned
    : (typeof article.companies_mentioned === 'string'
        ? JSON.parse(article.companies_mentioned || '[]')
        : [])

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: '10px', padding: '20px 24px',
        cursor: 'pointer', marginBottom: '12px',
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.055)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.13)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '10px' }}>
        {article.sector && <SectorPill sector={article.sector} />}
        <span style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.3)', flexShrink: 0, marginLeft: 'auto' }}>
          {article.source_name || ''}
        </span>
      </div>

      <h3 style={{
        fontSize: '16px', fontFamily: "'Cormorant Garamond', serif",
        fontWeight: 600, color: '#f1f5f9', lineHeight: 1.4, margin: '0 0 6px 0',
      }}>{article.title}</h3>

      {expanded && (
        <>
          {article.summary && (
            <p style={{ fontSize: '13.5px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.7, margin: '10px 0 14px 0' }}>
              {article.summary}
            </p>
          )}
          {article.ai_signal && (
            <div style={{
              background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)',
              borderRadius: '6px', padding: '10px 14px', marginBottom: '12px',
            }}>
              <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: '#fbbf24', letterSpacing: '0.1em', marginBottom: '5px' }}>SIGNAL</div>
              <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', margin: 0, lineHeight: 1.5 }}>{article.ai_signal}</p>
            </div>
          )}
          {companies.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
              {companies.map((c, i) => (
                <span key={i} style={{
                  padding: '2px 10px', borderRadius: '4px', fontSize: '11px',
                  fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.5)',
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                }}>{c}</span>
              ))}
            </div>
          )}
          {article.url && (
            <a href={article.url} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ display: 'inline-block', fontSize: '11px', fontFamily: "'DM Mono', monospace", color: '#60a5fa', textDecoration: 'none' }}>
              READ SOURCE →
            </a>
          )}
        </>
      )}
      <div style={{ marginTop: '8px', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.2)' }}>
        {expanded ? '↑ collapse' : '↓ expand'}
      </div>
    </div>
  )
}

// ── Brief View ──
function BriefView({ type }) {
  const [briefing, setBriefing] = useState(null)
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [sectorFilter, setSectorFilter] = useState('ALL')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data: bData } = await supabase
        .from('briefings').select('*')
        .eq('briefing_type', type)
        .order('created_at', { ascending: false }).limit(1)
      if (bData?.[0]) setBriefing(bData[0])

      const { data: aData } = await supabase
        .from('articles').select('*')
        .order('created_at', { ascending: false }).limit(80)
      if (aData) setArticles(aData)
      setLoading(false)
    }
    load()
  }, [type])

  const filtered = sectorFilter === 'ALL'
    ? articles
    : articles.filter(a => {
        const match = SECTORS.find(s => s.key === sectorFilter)?.match
        return a.sector && match && a.sector.includes(match)
      })

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: '32px', height: '32px', border: '2px solid rgba(255,255,255,0.1)', borderTopColor: '#f59e0b', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '12px', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>LOADING INTEL...</div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )

  return (
    <div>
      {/* Briefing lead */}
      <div style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.12em' }}>
            {type === 'morning' ? '☀ MORNING BRIEF' : '🌙 EVENING BRIEF'}
          </span>
          {briefing && (
            <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.25)' }}>
              {new Date(briefing.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </span>
          )}
        </div>

        {briefing ? (
          <div style={{
            background: 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(139,92,246,0.04))',
            border: '1px solid rgba(245,158,11,0.2)', borderRadius: '12px', padding: '28px 32px', marginBottom: '28px',
          }}>
            <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.12em', marginBottom: '12px' }}>TODAY'S LEAD</div>
            <h1 style={{
              fontFamily: "'Cormorant Garamond', serif", fontSize: 'clamp(22px, 3vw, 32px)',
              fontWeight: 700, color: '#f8fafc', lineHeight: 1.3, margin: '0 0 16px 0',
            }}>{briefing.headline}</h1>
            <p style={{ fontSize: '14.5px', color: 'rgba(255,255,255,0.65)', lineHeight: 1.75, margin: 0 }}>
              {briefing.summary}
            </p>
            {briefing.sector_breakdown && (() => {
              try {
                const breakdown = typeof briefing.sector_breakdown === 'string'
                  ? JSON.parse(briefing.sector_breakdown) : briefing.sector_breakdown
                return (
                  <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                    <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', marginBottom: '12px' }}>SECTOR BREAKDOWN</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
                      {Object.entries(breakdown).map(([sector, text]) => (
                        <div key={sector} style={{
                          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                          borderRadius: '8px', padding: '10px 14px',
                        }}>
                          <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: getSectorColor(sector), marginBottom: '5px' }}>
                            {sector.split(' ')[0].toUpperCase()}
                          </div>
                          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>{text}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              } catch { return null }
            })()}
          </div>
        ) : (
          <div style={{
            background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)',
            borderRadius: '12px', padding: '40px', textAlign: 'center', marginBottom: '28px',
          }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>{type === 'morning' ? '☀️' : '🌙'}</div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '20px', color: 'rgba(255,255,255,0.4)', marginBottom: '8px' }}>
              No {type} brief yet
            </div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: 'rgba(255,255,255,0.25)' }}>
              {type === 'morning' ? 'Publishes weekdays at 6:00 AM PT' : 'Publishes weekdays at 10:00 PM PT'}
            </div>
          </div>
        )}
      </div>

      {/* Sector filter */}
      <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', marginBottom: '10px' }}>TOP STORIES</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '18px' }}>
        {SECTORS.map(s => (
          <button key={s.key} onClick={() => setSectorFilter(s.key)} style={{
            padding: '4px 12px', borderRadius: '4px', fontSize: '10px',
            fontFamily: "'DM Mono', monospace", cursor: 'pointer', transition: 'all 0.15s',
            letterSpacing: '0.05em',
            border: `1px solid ${sectorFilter === s.key ? s.color : 'rgba(255,255,255,0.08)'}`,
            background: sectorFilter === s.key ? s.color + '18' : 'transparent',
            color: sectorFilter === s.key ? s.color : 'rgba(255,255,255,0.4)',
          }}>{s.label}</button>
        ))}
      </div>

      {/* Article count */}
      <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.2)', marginBottom: '14px' }}>
        {filtered.length} {filtered.length === 1 ? 'STORY' : 'STORIES'}
        {sectorFilter !== 'ALL' ? ` IN ${SECTORS.find(s => s.key === sectorFilter)?.label}` : ' TOTAL'}
      </div>

      {filtered.length > 0
        ? filtered.map(a => <ArticleCard key={a.id} article={a} />)
        : (
          <div style={{
            textAlign: 'center', padding: '60px 0',
            fontFamily: "'DM Mono', monospace", fontSize: '12px', color: 'rgba(255,255,255,0.2)',
          }}>
            NO STORIES IN THIS SECTOR YET — RUN THE PIPELINE TO POPULATE
          </div>
        )
      }
    </div>
  )
}

// ── Thesis Board ──
function ThesisBoard() {
  const THESES = [
    { title: 'AI Infrastructure Supercycle', signal: 'BULLISH', sectors: ['Technology M&A', 'Venture Capital'], thesis: 'Hyperscaler capex commitments ($300B+ in 2025) are creating durable demand for AI chips, data centers, and infrastructure software. NVDA, MSFT Azure, and custom silicon plays remain core positions.' },
    { title: 'Rate-Sensitive PE Dealflow Revival', signal: 'WATCH', sectors: ['Private Equity'], thesis: 'As the Fed signals rate normalization, LBO math improves. Watch for middle-market PE shops to re-activate deal pipelines. Potential multiple compression in growth equity if rates stay elevated.' },
    { title: 'Defense & Industrial Re-shoring', signal: 'BULLISH', sectors: ['Geopolitics', 'Energy'], thesis: 'NATO 2% GDP defense targets + IRA manufacturing credits driving long-term capex into US industrials. LMT, RTX, NOC well-positioned. Watch defense tech VC activity (Anduril, Shield AI).' },
    { title: 'Fintech Consolidation Wave', signal: 'WATCH', sectors: ['Fintech', 'Technology M&A'], thesis: 'Post-ZIRP valuation reset creating M&A opportunities. Legacy banks acquiring fintech distribution. Watch for traditional IB mandates emerging from consolidation activity.' },
    { title: 'Healthcare AI Commercialization', signal: 'BULLISH', sectors: ['Healthcare'], thesis: 'FDA accelerating digital health approvals. Drug discovery AI moving from hype to clinical trials. Vertical SaaS players in EHR/RCM ripe for PE roll-up strategies.' },
  ]
  const SIG = { BULLISH: '#4ade80', BEARISH: '#f87171', WATCH: '#fbbf24', NEUTRAL: '#94a3b8' }
  return (
    <div>
      <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.12em', marginBottom: '20px' }}>📋 THESIS BOARD</div>
      {THESES.map((t, i) => (
        <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', padding: '22px 26px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '19px', fontWeight: 600, color: '#f1f5f9', margin: 0 }}>{t.title}</h3>
            <span style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: SIG[t.signal], background: SIG[t.signal] + '18', border: `1px solid ${SIG[t.signal]}40`, flexShrink: 0, marginLeft: '12px' }}>{t.signal}</span>
          </div>
          <p style={{ fontSize: '13.5px', color: 'rgba(255,255,255,0.55)', lineHeight: 1.65, margin: '0 0 14px 0' }}>{t.thesis}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {t.sectors.map((s, j) => <SectorPill key={j} sector={s} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Company Intel ──
function CompanyIntel() {
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('articles')
        .select('companies_mentioned, sector, title, created_at')
        .not('companies_mentioned', 'is', null)
        .order('created_at', { ascending: false }).limit(200)
      if (data) {
        const map = {}
        data.forEach(a => {
          let companies = a.companies_mentioned
          if (typeof companies === 'string') { try { companies = JSON.parse(companies) } catch { companies = [] } }
          if (!Array.isArray(companies)) return
          companies.forEach(c => {
            if (!c || c.length < 2) return
            if (!map[c]) map[c] = { name: c, mentions: 0, sectors: new Set() }
            map[c].mentions++
            if (a.sector) map[c].sectors.add(a.sector)
          })
        })
        setCompanies(Object.values(map).sort((a, b) => b.mentions - a.mentions).map(c => ({ ...c, sectors: Array.from(c.sectors) })))
      }
      setLoading(false)
    }
    load()
  }, [])

  const filtered = companies.filter(c => search === '' || c.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.12em', marginBottom: '14px' }}>🏢 COMPANY INTEL</div>
      <input type="text" placeholder="Search companies..." value={search} onChange={e => setSearch(e.target.value)} style={{
        width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '10px 16px',
        fontSize: '13px', fontFamily: "'DM Mono', monospace", color: '#fff', outline: 'none', marginBottom: '20px',
      }} />
      {loading ? <div style={{ textAlign: 'center', padding: '60px 0', fontFamily: "'DM Mono', monospace", fontSize: '12px', color: 'rgba(255,255,255,0.2)' }}>LOADING...</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
          {filtered.slice(0, 60).map((c, i) => (
            <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px', padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '15px', fontWeight: 600, color: '#f1f5f9' }}>{c.name}</span>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', padding: '2px 7px', borderRadius: '4px', background: 'rgba(245,158,11,0.12)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.25)' }}>{c.mentions}x</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {c.sectors.slice(0, 2).map((s, j) => (
                  <span key={j} style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: getSectorColor(s), background: getSectorColor(s) + '15', border: `1px solid ${getSectorColor(s)}30`, padding: '1px 6px', borderRadius: '3px' }}>
                    {s?.split(' ')[0]}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Trends ──
function Trends() {
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('articles').select('sector, created_at').order('created_at', { ascending: false }).limit(300)
      if (data) setArticles(data)
      setLoading(false)
    }
    load()
  }, [])
  const counts = {}
  articles.forEach(a => { if (a.sector) counts[a.sector] = (counts[a.sector] || 0) + 1 })
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const max = sorted[0]?.[1] || 1
  return (
    <div>
      <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.12em', marginBottom: '20px' }}>📈 SIGNAL TRENDS</div>
      {loading ? <div style={{ textAlign: 'center', padding: '60px 0', fontFamily: "'DM Mono', monospace", fontSize: '12px', color: 'rgba(255,255,255,0.2)' }}>LOADING...</div> : (
        sorted.map(([sector, count]) => (
          <div key={sector} style={{ marginBottom: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>{sector}</span>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: getSectorColor(sector) }}>{count} stories</span>
            </div>
            <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(count / max) * 100}%`, background: `linear-gradient(to right, ${getSectorColor(sector)}88, ${getSectorColor(sector)})`, borderRadius: '3px' }} />
            </div>
          </div>
        ))
      )}
    </div>
  )
}

// ── Nav ──
const NAV = [
  { id: 'morning', label: 'Morning Brief', icon: '☀️' },
  { id: 'evening', label: 'Evening Brief', icon: '🌙' },
  { id: 'thesis', label: 'Thesis Board', icon: '📋' },
  { id: 'companies', label: 'Company Intel', icon: '🏢' },
  { id: 'trends', label: 'Trends', icon: '📈' },
]

const SIDEBAR_SECTORS = [
  { name: 'Technology M&A', color: '#f59e0b' },
  { name: 'Venture Capital', color: '#8b5cf6' },
  { name: 'Private Equity', color: '#3b82f6' },
  { name: 'Public Markets', color: '#10b981' },
  { name: 'Geopolitics', color: '#ef4444' },
  { name: 'Real Estate', color: '#f97316' },
  { name: 'Fintech', color: '#06b6d4' },
  { name: 'Healthcare', color: '#ec4899' },
  { name: 'Energy', color: '#84cc16' },
  { name: 'Consumer', color: '#a78bfa' },
]

// ── Main ──
export default function Home() {
  const [activeTab, setActiveTab] = useState('morning')
  const [quotes, setQuotes] = useState([])
  const [marketTime, setMarketTime] = useState('')

  // Fetch quotes from our server-side API route
  useEffect(() => {
    async function loadQuotes() {
      try {
        const res = await fetch('/api/quotes')
        const data = await res.json()
        if (data.quotes) setQuotes(data.quotes)
      } catch (e) {
        console.error('Quote fetch error:', e)
      }
    }
    loadQuotes()
    const t = setInterval(loadQuotes, 60000)
    return () => clearInterval(t)
  }, [])

  // Live clock
  useEffect(() => {
    function update() {
      setMarketTime(new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles', weekday: 'long',
        month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
      }).format(new Date()))
    }
    update()
    const t = setInterval(update, 10000)
    return () => clearInterval(t)
  }, [])

  const isMarketOpen = () => {
    const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const d = et.getDay(), t = et.getHours() * 60 + et.getMinutes()
    return d >= 1 && d <= 5 && t >= 570 && t <= 960
  }

  return (
    <div style={{ minHeight: '100vh', background: '#080c18', color: '#f8fafc' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=DM+Mono:wght@300;400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #080c18; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
      `}</style>

      <TickerBar quotes={quotes} />

      <div style={{ display: 'flex', height: 'calc(100vh - 32px)' }}>
        {/* Sidebar */}
        <div style={{
          width: '240px', flexShrink: 0,
          background: '#080c18', borderRight: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', flexDirection: 'column', padding: '24px 0',
          position: 'sticky', top: 0, height: '100%', overflowY: 'auto',
        }}>
          <div style={{ padding: '0 20px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '22px', fontWeight: 700 }}>
              <span style={{ color: '#fff' }}>Breaking</span><span style={{ color: '#f59e0b' }}>Alpha</span>
            </div>
            <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.25)', letterSpacing: '0.2em', marginTop: '3px' }}>MARKET INTELLIGENCE</div>
          </div>

          <nav style={{ padding: '16px 12px', flex: 1 }}>
            {NAV.map(item => (
              <button key={item.id} onClick={() => setActiveTab(item.id)} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                padding: '10px 12px', borderRadius: '7px', border: 'none',
                background: activeTab === item.id ? 'rgba(245,158,11,0.1)' : 'transparent',
                color: activeTab === item.id ? '#f59e0b' : 'rgba(255,255,255,0.5)',
                fontSize: '13px', fontFamily: "'DM Mono', monospace",
                cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s', marginBottom: '2px',
                borderLeft: activeTab === item.id ? '2px solid #f59e0b' : '2px solid transparent',
              }}>
                <span>{item.icon}</span>
                {item.label}
                {activeTab === item.id && <span style={{ marginLeft: 'auto', width: '5px', height: '5px', borderRadius: '50%', background: '#f59e0b' }} />}
              </button>
            ))}
          </nav>

          <div style={{ padding: '16px 20px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.25)', letterSpacing: '0.15em', marginBottom: '10px' }}>SECTORS TRACKED</div>
            {SIDEBAR_SECTORS.map(s => (
              <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px' }}>
                <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                <span style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.35)' }}>{s.name}</span>
              </div>
            ))}
          </div>

          <div style={{ padding: '16px 20px 0', marginTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.25)', letterSpacing: '0.15em', marginBottom: '6px' }}>MARKET TIME</div>
            <div style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>{marketTime || '—'}</div>
            <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: isMarketOpen() ? '#4ade80' : '#f87171', animation: 'pulse 2s infinite' }} />
              <span style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>
                US EQUITIES {isMarketOpen() ? 'OPEN' : 'CLOSED'}
              </span>
            </div>
          </div>
        </div>

        {/* Main */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{
            padding: '14px 32px', borderBottom: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            position: 'sticky', top: 0, background: 'rgba(8,12,24,0.96)',
            backdropFilter: 'blur(12px)', zIndex: 10,
          }}>
            <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.15em' }}>
              {NAV.find(n => n.id === activeTab)?.icon} {NAV.find(n => n.id === activeTab)?.label.toUpperCase()}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <span style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.3)' }}>
                {new Date().toISOString().split('T')[0]}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4ade80', animation: 'pulse 2s infinite' }} />
                <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#4ade80', letterSpacing: '0.1em' }}>LIVE</span>
              </div>
            </div>
          </div>

          <div style={{ padding: '32px', maxWidth: '900px' }}>
            {activeTab === 'morning' && <BriefView type="morning" />}
            {activeTab === 'evening' && <BriefView type="evening" />}
            {activeTab === 'thesis' && <ThesisBoard />}
            {activeTab === 'companies' && <CompanyIntel />}
            {activeTab === 'trends' && <Trends />}
          </div>
        </div>
      </div>
    </div>
  )
}

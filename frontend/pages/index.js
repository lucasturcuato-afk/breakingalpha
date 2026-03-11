import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import Head from 'next/head'

const SECTORS = {
  'Technology M&A & Investment Banking': { color: '#3498db', icon: '💻' },
  'Venture Capital & Startup Funding':   { color: '#2ecc71', icon: '🚀' },
  'Private Equity & Buyouts':            { color: '#9b59b6', icon: '🏦' },
  'Public Markets & Earnings':           { color: '#f39c12', icon: '📈' },
  'Geopolitics & Macro':                 { color: '#e74c3c', icon: '🌍' },
  'Real Estate & Infrastructure':        { color: '#1abc9c', icon: '🏗️' },
  'Fintech & Crypto':                    { color: '#e67e22', icon: '₿' },
  'Healthcare & Biotech':                { color: '#27ae60', icon: '🧬' },
  'Energy & Climate':                    { color: '#16a085', icon: '⚡' },
  'Consumer & Retail':                   { color: '#d35400', icon: '🛍️' },
}

function safeJSON(val) {
  if (!val) return []
  if (typeof val === 'object') return val
  try { return JSON.parse(val) } catch { return [] }
}

function formatBig(n) {
  if (!n) return 'N/A'
  if (n >= 1e12) return (n/1e12).toFixed(1)+'T'
  if (n >= 1e9) return (n/1e9).toFixed(1)+'B'
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M'
  return n.toLocaleString()
}

export default function Home() {
  const [tab, setTab] = useState('morning')
  const [briefing, setBriefing] = useState(null)
  const [allBriefings, setAllBriefings] = useState([])
  const [trends, setTrends] = useState([])
  const [companySearch, setCompanySearch] = useState('')
  const [companyData, setCompanyData] = useState(null)
  const [companyArticles, setCompanyArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [clock, setClock] = useState('')

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
    }))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => { loadData(tab) }, [tab])

  async function loadData(t) {
    setLoading(true)
    setBriefing(null)
    setCompanyData(null)
    if (t === 'morning' || t === 'evening') {
      const { data } = await supabase.from('briefings').select('*')
        .eq('briefing_type', t).order('briefing_date', { ascending: false }).limit(1)
      setBriefing(data?.[0] || null)
    }
    if (t === 'thesis') {
      const { data } = await supabase.from('briefings').select('*')
        .not('thesis', 'is', null).order('briefing_date', { ascending: false }).limit(30)
      setAllBriefings(data || [])
    }
    if (t === 'trends') {
      const { data } = await supabase.from('trends').select('*')
        .order('mention_count', { ascending: false }).limit(40)
      setTrends(data || [])
    }
    setLoading(false)
  }

  async function searchCompany() {
    if (!companySearch.trim()) return
    setLoading(true)
    const { data: companies } = await supabase.from('companies').select('*')
      .ilike('name', `%${companySearch}%`).limit(1)
    const { data: articles } = await supabase.from('articles').select('*')
      .contains('companies', [companySearch]).order('published_at', { ascending: false }).limit(25)
    setCompanyData(companies?.[0] || null)
    setCompanyArticles(articles || [])
    setLoading(false)
  }

  const navItems = [
    { id: 'morning', label: 'Morning Brief', icon: '🌅' },
    { id: 'evening', label: 'Evening Brief', icon: '🌙' },
    { id: 'thesis', label: 'Thesis Board', icon: '📋' },
    { id: 'companies', label: 'Company Intel', icon: '🏢' },
    { id: 'trends', label: 'Trends', icon: '📈' },
  ]

  return (
    <>
      <Head>
        <title>BreakingAlpha — Market Intelligence</title>
        <meta name="description" content="AI-powered market intelligence across all sectors" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={s.shell}>
        {/* Sidebar */}
        <aside style={s.sidebar}>
          <div style={s.logo}>
            <span style={s.logoAlpha}>Breaking</span>
            <span style={s.logoGold}>Alpha</span>
            <div style={s.logoSub}>MARKET INTELLIGENCE</div>
          </div>

          <nav style={s.nav}>
            {navItems.map(item => (
              <button key={item.id} style={{...s.navItem, ...(tab === item.id ? s.navActive : {})}}
                onClick={() => setTab(item.id)}>
                <span style={s.navIcon}>{item.icon}</span>
                <span>{item.label}</span>
                {tab === item.id && <span style={s.navDot} />}
              </button>
            ))}
          </nav>

          <div style={s.sidebarFooter}>
            <div style={s.clockBox}>
              <div style={s.clockLabel}>MARKET TIME</div>
              <div style={s.clockTime}>{clock.split(',').slice(0,2).join(',')}</div>
              <div style={s.clockSub}>{clock.split(',').slice(2).join(',').trim()}</div>
            </div>
            <div style={s.sectorLegend}>
              <div style={s.clockLabel}>SECTORS TRACKED</div>
              {Object.entries(SECTORS).map(([name, {color, icon}]) => (
                <div key={name} style={s.sectorItem}>
                  <span style={{...s.sectorDot, background: color}} />
                  <span style={s.sectorName}>{icon} {name.split('&')[0].trim()}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Main */}
        <main style={s.main}>
          {/* Header bar */}
          <div style={s.topbar}>
            <div style={s.topbarTitle}>
              {navItems.find(n => n.id === tab)?.icon} {navItems.find(n => n.id === tab)?.label}
            </div>
            <div style={s.topbarRight}>
              {briefing?.briefing_date && (tab === 'morning' || tab === 'evening') &&
                <span style={s.dateBadge}>{briefing.briefing_date}</span>}
              <span style={s.liveDot} />
              <span style={s.liveText}>LIVE</span>
            </div>
          </div>

          <div style={s.content}>
            {loading && (
              <div style={s.loadingState}>
                <div style={s.spinner} />
                <div>Loading intelligence...</div>
              </div>
            )}

            {/* Morning / Evening Brief */}
            {!loading && (tab === 'morning' || tab === 'evening') && (
              briefing ? <BriefingView briefing={briefing} /> :
              <EmptyState icon="📭" text={`No ${tab} brief yet. Run the pipeline to generate one.`} />
            )}

            {/* Thesis Board */}
            {!loading && tab === 'thesis' && (
              allBriefings.length ?
              <div>
                {allBriefings.map(b => (
                  <div key={b.id} style={s.thesisCard}>
                    <div style={s.thesisMeta}>
                      <span style={s.thesisDate}>{b.briefing_date}</span>
                      <span style={{...s.typeBadge, ...(b.briefing_type === 'morning' ? s.morningBadge : s.eveningBadge)}}>
                        {b.briefing_type === 'morning' ? '🌅 AM' : '🌙 PM'}
                      </span>
                    </div>
                    <div style={s.thesisHeadline}>{b.headline}</div>
                    <div style={s.thesisText}>{b.thesis}</div>
                  </div>
                ))} </div> :
              <EmptyState icon="📋" text="No theses yet. Run the pipeline first." />
            )}

            {/* Company Intel */}
            {!loading && tab === 'companies' && (
              <div>
                <div style={s.searchRow}>
                  <input style={s.searchInput} value={companySearch}
                    onChange={e => setCompanySearch(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && searchCompany()}
                    placeholder="Search any company (e.g. Nvidia, OpenAI, Blackstone)..." />
                  <button style={s.searchBtn} onClick={searchCompany}>SEARCH</button>
                </div>
                {companyData || companyArticles.length ? (
                  <CompanyView company={companyData} articles={companyArticles} />
                ) : (
                  <EmptyState icon="🔍" text="Search for any company to see its full history and market data." />
                )}
              </div>
            )}

            {/* Trends */}
            {!loading && tab === 'trends' && (
              trends.length ? <TrendsView trends={trends} /> :
              <EmptyState icon="📈" text="No trends tracked yet. Run the pipeline first." />
            )}
          </div>
        </main>
      </div>
    </>
  )
}

function BriefingView({ briefing }) {
  const topStories = safeJSON(briefing.top_stories)
  const sectorBreakdown = safeJSON(briefing.market_themes)
  const tailwinds = safeJSON(briefing.tailwinds)
  const headwinds = safeJSON(briefing.headwinds)

  return (
    <div>
      {/* Headline card */}
      <div style={s.headlineCard}>
        <div style={s.headlineLabel}>TODAY'S LEAD</div>
        <div style={s.headlineText}>{briefing.headline}</div>
        <div style={s.headlineSummary}>{briefing.summary}</div>
      </div>

      {/* Top Stories */}
      {topStories.length > 0 && (
        <Section label="TOP STORIES">
          {topStories.map((story, i) => {
            const sector = SECTORS[story.sector] || { color: '#c8a951', icon: '📰' }
            return (
              <div key={i} style={s.storyCard}>
                <div style={s.storyHeader}>
                  <span style={{...s.sectorBadge, borderColor: sector.color, color: sector.color, background: sector.color+'15'}}>
                    {sector.icon} {story.sector || 'General'}
                  </span>
                  <span style={s.storySource}>{story.source}</span>
                </div>
                <div style={s.storyTitle}>{story.title}</div>
                <div style={s.storyBody}>{story.summary}</div>
                {story.signal && (
                  <div style={s.signalBox}>
                    <span style={s.signalLabel}>SIGNAL</span>
                    {story.signal}
                  </div>
                )}
                {story.companies?.length > 0 && (
                  <div style={s.tagRow}>{story.companies.map(c => <span key={c} style={s.tag}>{c}</span>)}</div>
                )}
              </div>
            )
          })}
        </Section>
      )}

      {/* Sector Breakdown */}
      {sectorBreakdown.length > 0 && (
        <Section label="SECTOR BREAKDOWN">
          <div style={s.sectorGrid}>
            {sectorBreakdown.map((sec, i) => {
              const info = SECTORS[sec.sector] || { color: '#c8a951', icon: '📊' }
              return (
                <div key={i} style={{...s.sectorCard, borderTop: `2px solid ${info.color}`}}>
                  <div style={{...s.sectorCardLabel, color: info.color}}>{info.icon} {sec.sector}</div>
                  <div style={s.sectorCardHead}>{sec.headline}</div>
                  <div style={s.sectorCardBody}>{sec.key_developments}</div>
                  {sec.opportunity && <div style={{...s.signalBox, marginTop: 10}}><span style={s.signalLabel}>OPPORTUNITY</span>{sec.opportunity}</div>}
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* Tailwinds + Headwinds */}
      {(tailwinds.length > 0 || headwinds.length > 0) && (
        <Section label="MARKET FORCES">
          <div style={s.windGrid}>
            <div style={{...s.windCard, borderTop: '2px solid #27ae60'}}>
              <div style={{...s.windTitle, color: '#27ae60'}}>▲ TAILWINDS</div>
              {tailwinds.map((t, i) => (
                <div key={i} style={s.windItem}>
                  <div style={s.windName}>{t.trend}</div>
                  <div style={s.windDesc}>{t.description}</div>
                </div>
              ))}
            </div>
            <div style={{...s.windCard, borderTop: '2px solid #c0392b'}}>
              <div style={{...s.windTitle, color: '#c0392b'}}>▼ HEADWINDS</div>
              {headwinds.map((h, i) => (
                <div key={i} style={s.windItem}>
                  <div style={s.windName}>{h.trend}</div>
                  <div style={s.windDesc}>{h.description}</div>
                </div>
              ))}
            </div>
          </div>
        </Section>
      )}

      {/* Thesis */}
      {briefing.thesis && (
        <Section label="ONE-PAGE THESIS">
          <div style={s.thesisBlock}>
            <div style={s.thesisTextFull}>{briefing.thesis}</div>
          </div>
        </Section>
      )}
    </div>
  )
}

function CompanyView({ company, articles }) {
  return (
    <div>
      {company && (
        <div style={s.headlineCard}>
          <div style={s.headlineLabel}>COMPANY PROFILE</div>
          <div style={s.headlineText}>{company.name} {company.ticker ? `(${company.ticker})` : ''}</div>
          <div style={s.headlineSummary}>{company.description || 'No description available yet.'}</div>
          <div style={s.companyStats}>
            <div style={s.companyStat}><div style={s.companyStatLabel}>TOTAL MENTIONS</div><div style={s.companyStatVal}>{company.mention_count || 0}</div></div>
            <div style={s.companyStat}><div style={s.companyStatLabel}>FIRST SEEN</div><div style={s.companyStatVal}>{company.first_seen?.split('T')[0] || 'N/A'}</div></div>
            <div style={s.companyStat}><div style={s.companyStatLabel}>SENTIMENT</div><div style={s.companyStatVal}>{company.sentiment_trend || 'N/A'}</div></div>
          </div>
          {company.key_themes?.length > 0 && (
            <div style={s.tagRow}>{company.key_themes.map(t => <span key={t} style={s.tag}>{t}</span>)}</div>
          )}
        </div>
      )}

      {articles.length > 0 && (
        <Section label={`ARTICLE HISTORY (${articles.length})`}>
          <div style={s.timeline}>
            {articles.map((a, i) => (
              <div key={i} style={s.timelineItem}>
                <div style={s.timelineDot} />
                <div style={s.timelineContent}>
                  <div style={s.timelineDate}>{a.published_at?.split('T')[0]} · {a.source} · Score: {a.relevance_score}/10</div>
                  <a href={a.url} target="_blank" rel="noopener noreferrer" style={s.timelineTitle}>{a.title}</a>
                  <div style={s.timelineBody}>{a.summary}</div>
                  {a.relevance_reason && <div style={s.timelineReason}>{a.relevance_reason}</div>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

function TrendsView({ trends }) {
  const tailwinds = trends.filter(t => t.category === 'tailwind')
  const headwinds = trends.filter(t => t.category === 'headwind')

  return (
    <div style={s.windGrid}>
      <div>
        <div style={s.sectionLabel}>▲ TAILWINDS</div>
        <div style={s.card}>
          {tailwinds.map((t, i) => (
            <div key={i} style={s.trendRow}>
              <div style={s.trendCount}>{t.mention_count}</div>
              <div style={s.trendInfo}>
                <div style={s.trendName}>{t.name}</div>
                <div style={s.trendDesc}>{t.description}</div>
              </div>
              <span style={{...s.trendBadge, background: '#27ae6015', borderColor: '#27ae6044', color: '#27ae60'}}>TAILWIND</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div style={s.sectionLabel}>▼ HEADWINDS</div>
        <div style={s.card}>
          {headwinds.map((t, i) => (
            <div key={i} style={s.trendRow}>
              <div style={s.trendCount}>{t.mention_count}</div>
              <div style={s.trendInfo}>
                <div style={s.trendName}>{t.name}</div>
                <div style={s.trendDesc}>{t.description}</div>
              </div>
              <span style={{...s.trendBadge, background: '#c0392b15', borderColor: '#c0392b44', color: '#c0392b'}}>HEADWIND</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Section({ label, children }) {
  return (
    <div style={s.section}>
      <div style={s.sectionLabel}>{label}</div>
      {children}
    </div>
  )
}

function EmptyState({ icon, text }) {
  return (
    <div style={s.emptyState}>
      <div style={s.emptyIcon}>{icon}</div>
      <div style={s.emptyText}>{text}</div>
    </div>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────
const s = {
  shell: { display: 'flex', height: '100vh', overflow: 'hidden' },

  sidebar: { width: 220, background: '#0a0a14', borderRight: '1px solid #1c1c2e', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' },
  logo: { padding: '24px 20px 20px', borderBottom: '1px solid #1c1c2e' },
  logoAlpha: { fontFamily: "'Cormorant Garamond', serif", fontSize: 22, fontWeight: 700, color: '#e8e8f2', letterSpacing: -0.5 },
  logoGold: { fontFamily: "'Cormorant Garamond', serif", fontSize: 22, fontWeight: 700, color: '#c8a951', letterSpacing: -0.5 },
  logoSub: { fontFamily: "'DM Mono', monospace", fontSize: 8, letterSpacing: 2, color: '#55556a', marginTop: 4 },

  nav: { padding: '12px 0' },
  navItem: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 20px', background: 'none', border: 'none', color: '#9999b8', fontSize: 13, fontFamily: "'DM Sans', sans-serif", cursor: 'pointer', position: 'relative', transition: 'all 0.15s', textAlign: 'left' },
  navActive: { color: '#c8a951', background: 'rgba(200,169,81,0.06)', borderLeft: '2px solid #c8a951', paddingLeft: 18 },
  navIcon: { fontSize: 14, width: 18, textAlign: 'center' },
  navDot: { width: 4, height: 4, borderRadius: '50%', background: '#c8a951', marginLeft: 'auto' },

  sidebarFooter: { marginTop: 'auto', padding: 16, borderTop: '1px solid #1c1c2e' },
  clockBox: { marginBottom: 16 },
  clockLabel: { fontFamily: "'DM Mono', monospace", fontSize: 8, letterSpacing: 2, color: '#55556a', textTransform: 'uppercase', marginBottom: 4 },
  clockTime: { fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#e8e8f2' },
  clockSub: { fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#55556a', marginTop: 2 },

  sectorLegend: {},
  sectorItem: { display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' },
  sectorDot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  sectorName: { fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#55556a' },

  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  topbar: { padding: '14px 32px', background: '#0a0a14', borderBottom: '1px solid #1c1c2e', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
  topbarTitle: { fontFamily: "'DM Mono', monospace", fontSize: 12, letterSpacing: 1, color: '#9999b8', textTransform: 'uppercase' },
  topbarRight: { display: 'flex', alignItems: 'center', gap: 8 },
  dateBadge: { fontFamily: "'DM Mono', monospace", fontSize: 10, padding: '3px 10px', background: 'rgba(200,169,81,0.1)', border: '1px solid #7a6630', borderRadius: 20, color: '#c8a951' },
  liveDot: { width: 6, height: 6, borderRadius: '50%', background: '#27ae60', boxShadow: '0 0 6px #27ae60' },
  liveText: { fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#27ae60', letterSpacing: 2 },

  content: { flex: 1, overflowY: 'auto', padding: '28px 32px' },

  loadingState: { textAlign: 'center', padding: '80px 20px', color: '#55556a', fontFamily: "'DM Mono', monospace", fontSize: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 },
  spinner: { width: 28, height: 28, border: '2px solid #1c1c2e', borderTopColor: '#c8a951', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },

  headlineCard: { background: 'linear-gradient(135deg, #0d0d1f, #111128)', border: '1px solid #7a6630', borderRadius: 12, padding: '28px 32px', marginBottom: 28, position: 'relative', overflow: 'hidden' },
  headlineLabel: { fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: 3, color: '#c8a951', textTransform: 'uppercase', marginBottom: 12 },
  headlineText: { fontFamily: "'Cormorant Garamond', serif", fontSize: 26, fontWeight: 700, color: '#e8e8f2', lineHeight: 1.3, marginBottom: 14 },
  headlineSummary: { fontSize: 14, color: '#9999b8', lineHeight: 1.7, maxWidth: 700 },
  companyStats: { display: 'flex', gap: 24, marginTop: 20 },
  companyStat: {},
  companyStatLabel: { fontFamily: "'DM Mono', monospace", fontSize: 8, letterSpacing: 1, color: '#55556a', marginBottom: 4 },
  companyStatVal: { fontFamily: "'DM Mono', monospace", fontSize: 16, color: '#c8a951' },

  section: { marginBottom: 28 },
  sectionLabel: { fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: 2, color: '#55556a', textTransform: 'uppercase', marginBottom: 12 },

  storyCard: { background: '#0d0d1a', border: '1px solid #1c1c2e', borderRadius: 10, padding: '18px 22px', marginBottom: 12, transition: 'border-color 0.2s' },
  storyHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
  storySource: { fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#55556a', marginLeft: 'auto' },
  storyTitle: { fontFamily: "'Cormorant Garamond', serif", fontSize: 18, fontWeight: 600, color: '#e8e8f2', lineHeight: 1.3, marginBottom: 8 },
  storyBody: { fontSize: 13, color: '#9999b8', lineHeight: 1.7 },
  signalBox: { marginTop: 12, padding: '10px 14px', background: 'rgba(200,169,81,0.06)', borderLeft: '2px solid #7a6630', borderRadius: 4, fontSize: 12, color: '#9999b8', lineHeight: 1.6 },
  signalLabel: { display: 'block', fontFamily: "'DM Mono', monospace", fontSize: 8, letterSpacing: 2, color: '#c8a951', marginBottom: 4 },

  sectorGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 },
  sectorCard: { background: '#0d0d1a', border: '1px solid #1c1c2e', borderRadius: 10, padding: '16px 18px' },
  sectorCardLabel: { fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: 1, marginBottom: 8 },
  sectorCardHead: { fontFamily: "'Cormorant Garamond', serif", fontSize: 15, fontWeight: 600, color: '#e8e8f2', marginBottom: 6 },
  sectorCardBody: { fontSize: 12, color: '#9999b8', lineHeight: 1.6 },

  sectorBadge: { fontFamily: "'DM Mono', monospace", fontSize: 9, padding: '3px 8px', borderRadius: 20, border: '1px solid', letterSpacing: 0.5 },

  windGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  windCard: { background: '#0d0d1a', border: '1px solid #1c1c2e', borderRadius: 10, padding: '18px 20px' },
  windTitle: { fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 },
  windItem: { padding: '8px 0', borderBottom: '1px solid #1c1c2e' },
  windName: { fontSize: 13, color: '#e8e8f2', fontWeight: 500, marginBottom: 3 },
  windDesc: { fontSize: 11, color: '#55556a', lineHeight: 1.5 },

  thesisBlock: { background: '#0d0d1a', border: '1px solid #1c1c2e', borderLeft: '3px solid #c8a951', borderRadius: 10, padding: '24px 28px' },
  thesisTextFull: { fontSize: 13.5, color: '#9999b8', lineHeight: 1.85, whiteSpace: 'pre-wrap', fontFamily: "'DM Sans', sans-serif" },

  thesisCard: { background: '#0d0d1a', border: '1px solid #1c1c2e', borderRadius: 10, padding: '22px 26px', marginBottom: 18 },
  thesisMeta: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  thesisDate: { fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#55556a' },
  typeBadge: { fontFamily: "'DM Mono', monospace", fontSize: 9, padding: '2px 8px', borderRadius: 20, border: '1px solid' },
  morningBadge: { background: '#f39c1215', borderColor: '#f39c1244', color: '#f39c12' },
  eveningBadge: { background: '#9b59b615', borderColor: '#9b59b644', color: '#9b59b6' },
  thesisHeadline: { fontFamily: "'Cormorant Garamond', serif", fontSize: 18, fontWeight: 600, color: '#e8e8f2', marginBottom: 14 },
  thesisText: { fontSize: 13, color: '#9999b8', lineHeight: 1.8, whiteSpace: 'pre-wrap' },

  searchRow: { display: 'flex', gap: 12, marginBottom: 24 },
  searchInput: { flex: 1, background: '#0d0d1a', border: '1px solid #1c1c2e', borderRadius: 8, padding: '11px 18px', color: '#e8e8f2', fontFamily: "'DM Sans', sans-serif", fontSize: 14, outline: 'none' },
  searchBtn: { padding: '11px 22px', background: '#c8a951', color: '#000', border: 'none', borderRadius: 8, fontFamily: "'DM Mono', monospace", fontSize: 11, fontWeight: 500, cursor: 'pointer', letterSpacing: 1 },

  card: { background: '#0d0d1a', border: '1px solid #1c1c2e', borderRadius: 10, padding: '4px 20px' },
  trendRow: { display: 'flex', alignItems: 'flex-start', gap: 14, padding: '12px 0', borderBottom: '1px solid #1c1c2e' },
  trendCount: { fontFamily: "'DM Mono', monospace", fontSize: 20, color: '#c8a951', minWidth: 32, lineHeight: 1 },
  trendInfo: { flex: 1 },
  trendName: { fontSize: 13, color: '#e8e8f2', fontWeight: 500, marginBottom: 3 },
  trendDesc: { fontSize: 11, color: '#55556a', lineHeight: 1.5 },
  trendBadge: { fontFamily: "'DM Mono', monospace", fontSize: 8, padding: '3px 8px', borderRadius: 20, border: '1px solid', letterSpacing: 1, whiteSpace: 'nowrap', marginTop: 2 },

  timeline: { paddingLeft: 20, position: 'relative' },
  timelineItem: { display: 'flex', gap: 16, paddingBottom: 20, position: 'relative' },
  timelineDot: { width: 8, height: 8, borderRadius: '50%', background: '#c8a951', flexShrink: 0, marginTop: 6, border: '2px solid #07070d' },
  timelineContent: { flex: 1, paddingBottom: 16, borderBottom: '1px solid #1c1c2e' },
  timelineDate: { fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#55556a', marginBottom: 5 },
  timelineTitle: { fontSize: 14, color: '#e8e8f2', fontWeight: 500, display: 'block', marginBottom: 5, lineHeight: 1.4 },
  timelineBody: { fontSize: 12, color: '#9999b8', lineHeight: 1.6, marginBottom: 4 },
  timelineReason: { fontSize: 11, color: '#7a6630', fontStyle: 'italic' },

  tagRow: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tag: { fontFamily: "'DM Mono', monospace", fontSize: 10, padding: '3px 10px', borderRadius: 20, border: '1px solid #1c1c2e', color: '#55556a', background: '#13131f' },

  emptyState: { textAlign: 'center', padding: '80px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  emptyIcon: { fontSize: 36, opacity: 0.3 },
  emptyText: { fontSize: 13, color: '#55556a', maxWidth: 300 },
}

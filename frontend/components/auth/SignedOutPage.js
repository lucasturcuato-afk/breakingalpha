import { useState, useEffect } from 'react'
import clsx from 'clsx'
import { Activity, Zap, Eye, FileText } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import Badge from '../primitives/Badge'

const TONE_VARIANT = {
  'RISK-ON': 'signal',
  'RISK-OFF': 'live',
  'MIXED': 'draft',
  'NEUTRAL': 'default',
}

const SECTION_LABELS = {
  deals_and_ma: 'DEALS & M&A',
  public_markets: 'PUBLIC MARKETS',
  macro_and_rates: 'MACRO & RATES',
  geopolitics: 'GEOPOLITICS',
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

const FEATURES = [
  { icon: Activity, label: 'Live Feed', desc: 'Real-time M&A, PE, and macro signals' },
  { icon: Zap, label: 'AI Theses', desc: 'Auto-generated investment theses' },
  { icon: Eye, label: 'Watchlist', desc: 'Track companies and tickers' },
  { icon: FileText, label: 'Deal Memos', desc: 'AI-drafted memo generation' },
]

export default function SignedOutPage() {
  const [briefing, setBriefing] = useState(null)
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [{ data: bData }, { data: aData }] = await Promise.all([
          supabase
            .from('briefings')
            .select('headline, market_tone, sections, created_at')
            .eq('briefing_type', 'morning')
            .order('created_at', { ascending: false })
            .limit(1),
          supabase
            .from('articles')
            .select('id, title, sector, source, published_at, ingested_at')
            .order('ingested_at', { ascending: false })
            .limit(5),
        ])
        if (bData?.[0]) setBriefing(bData[0])
        if (aData) setArticles(aData)
      } catch {
        // Graceful degradation
      }
      setLoading(false)
    }
    load()
  }, [])

  const handleSignIn = () => {
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  }

  let sections = {}
  try {
    sections = briefing?.sections
      ? (typeof briefing.sections === 'string' ? JSON.parse(briefing.sections) : briefing.sections)
      : {}
  } catch {}

  const visibleSectionKeys = Object.keys(sections).filter(k => SECTION_LABELS[k]).slice(0, 2)

  return (
    <div className="min-h-screen bg-base text-content-primary">
      {/* Nav */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-signal-500" />
          <span className="text-16 font-semibold tracking-tight">Signalera</span>
        </div>
        <button
          onClick={handleSignIn}
          className="text-12 px-3 py-1.5 rounded-md border border-border-subtle text-content-muted hover:text-content-primary hover:border-border sig-transition font-mono"
        >
          Sign in
        </button>
      </div>

      <div className="max-w-[860px] mx-auto px-8 py-16">
        {/* Hero */}
        <div className="mb-14">
          <div className="text-11 font-mono text-signal-400 tracking-widest uppercase mb-4">
            Market Intelligence
          </div>
          <h1 className="text-[clamp(28px,4vw,44px)] font-semibold leading-[1.1] text-content-primary mb-4">
            AI-native market intelligence
            <br />
            <span className="text-content-muted">for what actually matters.</span>
          </h1>
          <p className="text-13 text-content-muted leading-relaxed max-w-[460px] mb-7 font-mono">
            Morning briefings, live tracking, and watchlist-driven relevance — for investors and operators who move on signal, not noise.
          </p>
          <button
            onClick={handleSignIn}
            className={clsx(
              'inline-flex items-center gap-2.5 px-5 py-2.5 rounded-md',
              'border border-signal-500 bg-signal-muted',
              'text-13 font-medium text-signal-400',
              'hover:bg-signal-500/20 sig-transition',
            )}
          >
            <GoogleIcon />
            Sign in with Google — it&apos;s free
          </button>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-14">
          {FEATURES.map(f => (
            <div key={f.label} className="px-4 py-3 rounded-md bg-base-elevated border border-border-subtle">
              <f.icon size={15} className="text-signal-400 mb-2" />
              <div className="text-12 font-semibold text-content-primary mb-0.5">{f.label}</div>
              <div className="text-11 text-content-muted">{f.desc}</div>
            </div>
          ))}
        </div>

        {/* Briefing preview */}
        <div className="mb-14">
          <div className="flex items-center justify-between mb-4">
            <div className="text-11 font-mono text-signal-400 tracking-widest uppercase">
              This Morning&apos;s Brief
            </div>
            <button
              onClick={handleSignIn}
              className="text-11 font-mono text-content-muted hover:text-content-primary sig-transition underline"
            >
              Sign in to read full brief
            </button>
          </div>

          {loading ? (
            <div className="h-[120px] rounded-md bg-base-elevated border border-border-subtle flex items-center justify-center">
              <span className="text-11 font-mono text-content-muted tracking-widest animate-pulse">
                LOADING INTEL...
              </span>
            </div>
          ) : briefing ? (
            <div className="space-y-2">
              <div className="rounded-md bg-base-elevated border border-signal-500/20 p-6">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-11 font-mono text-signal-400 tracking-wider">TODAY&apos;S LEAD</span>
                  {briefing.market_tone && (
                    <Badge variant={TONE_VARIANT[briefing.market_tone] || 'default'} size="sm">
                      {briefing.market_tone}
                    </Badge>
                  )}
                </div>
                <h2 className="text-[clamp(16px,2vw,22px)] font-semibold text-content-primary leading-snug">
                  {briefing.headline}
                </h2>
              </div>

              {visibleSectionKeys.length > 0 && (
                <div className="rounded-md bg-base-elevated border border-border-subtle p-5">
                  {visibleSectionKeys.map((key, i) => (
                    <div key={key} className={i < visibleSectionKeys.length - 1 ? 'mb-4' : ''}>
                      <div className="text-11 font-mono text-content-muted tracking-wider mb-1.5">
                        {SECTION_LABELS[key]}
                      </div>
                      <p className="text-13 text-content-secondary leading-relaxed">
                        {typeof sections[key] === 'string'
                          ? sections[key].slice(0, 220) + (sections[key].length > 220 ? '...' : '')
                          : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Blur gate */}
              <div className="relative overflow-hidden rounded-md">
                <div className="blur-[4px] pointer-events-none select-none opacity-50">
                  <div className="rounded-md bg-base-elevated border border-border-subtle p-5">
                    <div className="text-11 font-mono text-content-muted tracking-wider mb-1.5">SECTOR SPOTLIGHT</div>
                    <p className="text-13 text-content-secondary leading-relaxed">
                      Deeper analysis of sector-specific implications, deal flow signals, and what to watch in the coming sessions...
                    </p>
                  </div>
                </div>
                <div className="absolute inset-0 flex items-center justify-center bg-base/60 rounded-md">
                  <button
                    onClick={handleSignIn}
                    className="px-4 py-2 rounded-md border border-signal-500/30 bg-signal-muted text-signal-400 text-12 font-mono hover:bg-signal-500/20 sig-transition"
                  >
                    Sign in to read the full brief
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-md bg-base-elevated border border-border-subtle p-6">
              <div className="text-11 font-mono text-signal-400 tracking-wider mb-2.5">TODAY&apos;S LEAD</div>
              <p className="text-14 text-content-secondary leading-relaxed mb-4">
                Sign in to read this morning&apos;s full market brief — M&amp;A signals, sector moves, and deal flow, synthesized before market open.
              </p>
              <button
                onClick={handleSignIn}
                className="text-12 px-4 py-2 rounded-md border border-signal-500/30 bg-signal-muted text-signal-400 font-mono hover:bg-signal-500/20 sig-transition"
              >
                Sign in to read
              </button>
            </div>
          )}
        </div>

        {/* Live tracker preview */}
        <div className="mb-14">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-signal-500 animate-pulse" />
              <span className="text-11 font-mono text-signal-400 tracking-widest uppercase">
                Live Tracker
              </span>
            </div>
            <button
              onClick={handleSignIn}
              className="text-11 font-mono text-content-muted hover:text-content-primary sig-transition underline"
            >
              Sign in for full feed
            </button>
          </div>

          {loading ? (
            <div className="h-[180px] flex items-center justify-center">
              <span className="text-11 font-mono text-content-muted tracking-widest animate-pulse">LOADING...</span>
            </div>
          ) : articles.length > 0 ? (
            <div className="space-y-2">
              {articles.slice(0, 3).map(a => (
                <div
                  key={a.id}
                  onClick={handleSignIn}
                  className="rounded-md bg-base-elevated border border-border-subtle p-4 cursor-pointer hover:border-border sig-transition"
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      {a.sector && (
                        <Badge variant="default" size="sm">{a.sector}</Badge>
                      )}
                      {a.source && (
                        <span className="text-11 font-mono text-content-muted">{a.source}</span>
                      )}
                    </div>
                    <span className="text-11 font-mono text-content-muted shrink-0">
                      {timeAgo(a.published_at || a.ingested_at)}
                    </span>
                  </div>
                  <h3 className="text-14 font-semibold text-content-primary leading-snug">
                    {a.title}
                  </h3>
                  <div className="mt-1.5 text-11 font-mono text-content-muted">
                    Sign in to expand
                  </div>
                </div>
              ))}

              {articles.length > 3 && (
                <div className="relative overflow-hidden rounded-md">
                  <div className="blur-sm pointer-events-none opacity-40 space-y-2">
                    {articles.slice(3).map(a => (
                      <div key={a.id} className="rounded-md bg-base-elevated border border-border-subtle p-4">
                        {a.sector && <Badge variant="default" size="sm">{a.sector}</Badge>}
                        <h3 className="text-14 font-semibold text-content-primary leading-snug mt-2">{a.title}</h3>
                      </div>
                    ))}
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center bg-base/50 rounded-md">
                    <button
                      onClick={handleSignIn}
                      className="px-4 py-2 rounded-md border border-border-subtle bg-base-elevated text-content-secondary text-12 font-mono hover:border-border hover:text-content-primary sig-transition"
                    >
                      Sign in to see all stories
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {['Tech M&A', 'Venture', 'Private Eq', 'Geo & Macro'].map(label => (
                <div
                  key={label}
                  onClick={handleSignIn}
                  className="rounded-md bg-base-elevated border border-border-subtle p-4 cursor-pointer hover:border-border sig-transition"
                >
                  <div className="text-11 font-mono text-content-muted tracking-wider uppercase mb-2">{label}</div>
                  <div className="text-12 font-mono text-content-muted">
                    Sign in to read the latest {label.toLowerCase()} stories
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bottom CTA */}
        <div className="text-center border-t border-border-subtle pt-10">
          <p className="text-12 font-mono text-content-muted mb-4">
            Watchlist, company intel, deal flow tracking, and personalized alerts — behind sign-in.
          </p>
          <button
            onClick={handleSignIn}
            className="text-12 px-5 py-2.5 rounded-md border border-border-subtle text-content-muted hover:border-signal-500/50 hover:text-signal-400 sig-transition font-mono"
          >
            Get full access — sign in with Google
          </button>
          <div className="mt-2.5 text-11 text-content-muted font-mono">
            Free. No credit card required.
          </div>
        </div>
      </div>
    </div>
  )
}

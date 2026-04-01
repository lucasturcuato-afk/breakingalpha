# Signed-Out Preview Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full hard gate (`LandingPage`) with a limited signed-out preview that shows real Morning Review and Live Feed data, while keeping all personalization and deeper features behind sign-in.

**Architecture:** Add a `SignedOutHomepage` component that fetches and displays a limited subset of real data (briefing headline + top 5 articles). The routing in `index.js` switches from `LandingPage` to `SignedOutHomepage` when no user is present. The signed-in experience is completely untouched.

**Tech Stack:** Next.js (Pages Router), Supabase anon client, React hooks, inline styles matching the existing codebase

---

## Signed-Out vs Signed-In Behavior Summary

| Feature | Signed-out | Signed-in |
|---|---|---|
| Morning Review headline + tone | ✅ Preview | ✅ Full |
| Morning Review full sections | ❌ Blur + CTA | ✅ Full |
| Top 3 articles (title + sector + time) | ✅ Visible, click triggers sign-in | ✅ Expandable inline |
| Articles 4–5 | ❌ Blurred overlay | ✅ Full |
| Watchlist | ❌ Not shown | ✅ Full |
| Deal Flow Tracker | ❌ Not shown | ✅ Full |
| Thesis Board | ❌ Not shown | ✅ Full |
| Company Intel | ❌ Not shown | ✅ Full |
| Evening Wrap | ❌ Not shown | ✅ Full |
| Sidebar + ticker bar | ❌ No sidebar | ✅ Live |

---

## File Structure

### Created
- `frontend/components/SignedOutHomepage.js` — Self-contained signed-out preview. Fetches briefing headline and top 5 articles from Supabase. Renders hero + limited Morning Review + limited Live Feed + sign-in CTAs throughout.

### Modified
- `frontend/pages/index.js` — Add 1 import line; change 1 routing line (line 1395). Zero other changes.

### Unchanged
- `frontend/components/LandingPage.js` — No changes (becomes unreferenced; can be cleaned up later)
- `frontend/components/AuthButton.js` — No changes
- `frontend/components/OnboardingModal.js` — No changes
- All API routes — No changes
- All backend logic — No changes

---

## Pre-Flight: Verify Supabase RLS

Before implementing, check whether the `articles` and `briefings` tables allow anonymous reads. Run this in the Supabase SQL editor:

```sql
SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE tablename IN ('articles', 'briefings');
```

If `anon` is not in the SELECT policies, add:

```sql
CREATE POLICY "Public read on articles" ON articles
  FOR SELECT TO anon USING (true);

CREATE POLICY "Public read on briefings" ON briefings
  FOR SELECT TO anon USING (true);
```

If you skip this check, the component will degrade gracefully to empty states — not a broken wall. You can validate after shipping.

---

## Task 1: Create SignedOutHomepage Component

**Files:**
- Create: `frontend/components/SignedOutHomepage.js`

- [ ] **Step 1: Create the component file**

Create `frontend/components/SignedOutHomepage.js` with the following content:

```js
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'

const SECTOR_COLORS = {
  'Technology M&A & Investment Banking': '#f59e0b',
  'Venture Capital & Startup Funding':   '#8b5cf6',
  'Private Equity & Buyouts':            '#3b82f6',
  'Public Markets & Earnings':           '#10b981',
  'Geopolitics & Macro':                 '#ef4444',
  'Real Estate & REITs':                 '#f97316',
  'Fintech & Crypto':                    '#06b6d4',
  'Healthcare & Biotech':                '#ec4899',
  'Energy & Climate':                    '#84cc16',
  'Consumer & Retail':                   '#a78bfa',
}

function getSectorColor(sector) {
  if (!sector) return '#64748b'
  const match = Object.keys(SECTOR_COLORS).find(k => sector.includes(k.split(' ')[0]))
  return match ? SECTOR_COLORS[match] : '#64748b'
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const TONE_COLORS = {
  'RISK-ON':  '#4ade80',
  'RISK-OFF': '#f87171',
  'MIXED':    '#fbbf24',
  'NEUTRAL':  '#94a3b8',
}

const SECTION_LABELS = {
  deals_and_ma:    'DEALS & M&A',
  public_markets:  'PUBLIC MARKETS',
  macro_and_rates: 'MACRO & RATES',
  geopolitics:     'GEOPOLITICS',
}

export default function SignedOutHomepage() {
  const [briefing, setBriefing] = useState(null)
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
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
      setLoading(false)
    }
    load()
  }, [])

  const handleSignIn = () =>
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })

  const toneColor = TONE_COLORS[briefing?.market_tone] || '#94a3b8'

  let sections = {}
  try {
    sections = briefing?.sections
      ? (typeof briefing.sections === 'string' ? JSON.parse(briefing.sections) : briefing.sections)
      : {}
  } catch {}

  const visibleSectionKeys = Object.keys(sections).filter(k => SECTION_LABELS[k]).slice(0, 2)

  return (
    <div style={{ minHeight: '100vh', background: '#080c18', color: '#f8fafc' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=DM+Mono:wght@300;400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #080c18; }
        .soh-signin-nav:hover { border-color: #f59e0b !important; color: #f59e0b !important; }
        .soh-article:hover { background: rgba(255,255,255,0.052) !important; border-color: rgba(255,255,255,0.12) !important; }
      `}</style>

      {/* Nav */}
      <div style={{ padding: '20px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '22px', fontWeight: 700 }}>
          <span style={{ color: '#fff' }}>Breaking</span><span style={{ color: '#f59e0b' }}>Alpha</span>
        </div>
        <button
          onClick={handleSignIn}
          className="soh-signin-nav"
          style={{ fontSize: '11px', padding: '6px 14px', borderRadius: '4px', border: '1px solid #374151', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontFamily: "'DM Mono', monospace", transition: 'all 0.15s ease' }}
        >
          Sign in
        </button>
      </div>

      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '60px 40px 80px' }}>

        {/* Hero */}
        <div style={{ marginBottom: '56px' }}>
          <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.2em', marginBottom: '16px' }}>
            MARKET INTELLIGENCE
          </div>
          <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 'clamp(32px, 4.5vw, 52px)', fontWeight: 700, lineHeight: 1.1, color: '#f9fafb', marginBottom: '16px' }}>
            AI-native market intelligence<br />for what actually matters.
          </h1>
          <p style={{ fontSize: '13px', color: '#6b7280', lineHeight: 1.7, maxWidth: '500px', marginBottom: '28px', fontFamily: "'DM Mono', monospace" }}>
            Morning briefings, live tracking, and watchlist-driven relevance — for investors and operators who move on signal, not noise.
          </p>
          <button
            onClick={handleSignIn}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', padding: '11px 22px', borderRadius: '6px', border: '1px solid #f59e0b', background: 'rgba(245,158,11,0.08)', color: '#f59e0b', fontSize: '13px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', transition: 'all 0.15s ease' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.14)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.08)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Sign in with Google — it&apos;s free
          </button>
        </div>

        {/* Morning Review Preview */}
        <div style={{ marginBottom: '48px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.16em' }}>
              ☀ THIS MORNING&apos;S BRIEF
            </div>
            <button
              onClick={handleSignIn}
              style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#6b7280', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Sign in to read full brief →
            </button>
          </div>

          {loading ? (
            <div style={{ background: '#0d1221', border: '1px solid #1a2235', borderRadius: '10px', padding: '28px 32px', height: '140px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: 'rgba(255,255,255,0.18)', letterSpacing: '0.12em' }}>LOADING INTEL...</span>
            </div>
          ) : briefing ? (
            <div>
              {/* Headline card — fully visible */}
              <div style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(139,92,246,0.04))', border: '1px solid rgba(245,158,11,0.18)', borderRadius: '10px', padding: '24px 28px', marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.14em' }}>TODAY&apos;S LEAD</span>
                  {briefing.market_tone && (
                    <span style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: toneColor, background: toneColor + '18', border: `1px solid ${toneColor}40` }}>
                      {briefing.market_tone}
                    </span>
                  )}
                </div>
                <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 'clamp(18px, 2.4vw, 24px)', fontWeight: 700, color: '#f8fafc', lineHeight: 1.3, margin: 0 }}>
                  {briefing.headline}
                </h2>
              </div>

              {/* Two section previews — visible */}
              {visibleSectionKeys.length > 0 && (
                <div style={{ background: '#0d1221', border: '1px solid #1a2235', borderRadius: '10px', padding: '20px 24px', marginBottom: '8px' }}>
                  {visibleSectionKeys.map(key => (
                    <div key={key} style={{ marginBottom: '14px' }}>
                      <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: '#4b5563', letterSpacing: '0.14em', marginBottom: '6px' }}>
                        {SECTION_LABELS[key]}
                      </div>
                      <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, margin: 0 }}>
                        {typeof sections[key] === 'string'
                          ? sections[key].slice(0, 220) + (sections[key].length > 220 ? '…' : '')
                          : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Blur gate */}
              <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '10px' }}>
                <div style={{ filter: 'blur(4px)', pointerEvents: 'none', userSelect: 'none', opacity: 0.5 }}>
                  <div style={{ background: '#0d1221', border: '1px solid #1a2235', borderRadius: '10px', padding: '20px 24px' }}>
                    <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: '#4b5563', letterSpacing: '0.14em', marginBottom: '6px' }}>SECTOR SPOTLIGHT</div>
                    <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', lineHeight: 1.6, margin: 0 }}>
                      Deeper analysis of sector-specific implications, deal flow signals, and what to watch in the coming sessions...
                    </p>
                  </div>
                </div>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(8,12,24,0.6)', borderRadius: '10px' }}>
                  <button
                    onClick={handleSignIn}
                    style={{ padding: '9px 20px', borderRadius: '6px', border: '1px solid #f59e0b', background: 'rgba(245,158,11,0.1)', color: '#f59e0b', fontSize: '12px', fontFamily: "'DM Mono', monospace", cursor: 'pointer' }}
                  >
                    Sign in to read the full brief
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ background: '#0d1221', border: '1px solid #1a2235', borderRadius: '10px', padding: '28px 32px' }}>
              <p style={{ fontFamily: "'DM Mono', monospace", fontSize: '12px', color: 'rgba(255,255,255,0.28)', margin: 0 }}>
                Morning brief not yet available. Sign in to be notified when it drops.
              </p>
            </div>
          )}
        </div>

        {/* Top Stories Preview */}
        <div style={{ marginBottom: '56px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#4ade80' }} />
              <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#4ade80', letterSpacing: '0.16em' }}>LIVE TRACKER</span>
            </div>
            <button
              onClick={handleSignIn}
              style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#6b7280', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Sign in for full feed →
            </button>
          </div>

          {loading ? (
            <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: 'rgba(255,255,255,0.18)', letterSpacing: '0.12em' }}>LOADING...</span>
            </div>
          ) : (
            <>
              {articles.slice(0, 3).map(a => {
                const color = getSectorColor(a.sector)
                const ts = a.published_at || a.ingested_at
                return (
                  <div
                    key={a.id}
                    className="soh-article"
                    onClick={handleSignIn}
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', padding: '16px 20px', marginBottom: '8px', cursor: 'pointer', transition: 'all 0.15s' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        {a.sector && (
                          <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", color, background: color + '18', border: `1px solid ${color}38` }}>
                            {a.sector}
                          </span>
                        )}
                        {a.source && (
                          <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.28)' }}>{a.source}</span>
                        )}
                      </div>
                      {ts && <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.22)', flexShrink: 0 }}>{timeAgo(ts)}</span>}
                    </div>
                    <h3 style={{ fontSize: '15.5px', fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, color: '#f1f5f9', lineHeight: 1.4, margin: 0 }}>
                      {a.title}
                    </h3>
                    <div style={{ marginTop: '7px', fontSize: '10px', fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.18)' }}>
                      Sign in to expand →
                    </div>
                  </div>
                )
              })}

              {articles.length > 3 && (
                <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '10px' }}>
                  {articles.slice(3).map(a => {
                    const color = getSectorColor(a.sector)
                    return (
                      <div
                        key={a.id}
                        style={{ filter: 'blur(3px)', opacity: 0.4, pointerEvents: 'none', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', padding: '16px 20px', marginBottom: '8px' }}
                      >
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                          {a.sector && (
                            <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '4px', fontSize: '10px', fontFamily: "'DM Mono', monospace", color, background: color + '18', border: `1px solid ${color}38` }}>
                              {a.sector}
                            </span>
                          )}
                        </div>
                        <h3 style={{ fontSize: '15.5px', fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, color: '#f1f5f9', lineHeight: 1.4, margin: 0 }}>
                          {a.title}
                        </h3>
                      </div>
                    )
                  })}
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(8,12,24,0.5)', borderRadius: '10px' }}>
                    <button
                      onClick={handleSignIn}
                      style={{ padding: '9px 20px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#e5e7eb', fontSize: '12px', fontFamily: "'DM Mono', monospace", cursor: 'pointer' }}
                    >
                      Sign in to see all stories →
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Bottom CTA */}
        <div style={{ textAlign: 'center', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '40px' }}>
          <p style={{ fontSize: '12px', fontFamily: "'DM Mono', monospace", color: '#4b5563', marginBottom: '16px' }}>
            Watchlist, company intel, deal flow tracking, and personalized alerts — behind sign-in.
          </p>
          <button
            onClick={handleSignIn}
            style={{ fontSize: '12px', padding: '10px 22px', borderRadius: '4px', border: '1px solid #374151', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontFamily: "'DM Mono', monospace", transition: 'all 0.15s ease' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#f59e0b'; e.currentTarget.style.color = '#f59e0b' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#374151'; e.currentTarget.style.color = '#9ca3af' }}
          >
            Get full access — sign in with Google
          </button>
          <div style={{ marginTop: '10px', fontSize: '10px', color: '#374151', fontFamily: "'DM Mono', monospace" }}>
            Free. No credit card required.
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify the file was created**

```bash
head -5 frontend/components/SignedOutHomepage.js
```

Expected output: first 5 lines of the import block.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/SignedOutHomepage.js
git commit -m "feat: add SignedOutHomepage with Morning Review and Live Feed preview"
```

---

## Task 2: Wire SignedOutHomepage in pages/index.js

**Files:**
- Modify: `frontend/pages/index.js` (line 5 for import, line 1395 for routing)

- [ ] **Step 1: Add the import (line 5 area)**

In `frontend/pages/index.js`, the current imports are:

```js
import { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'
import AuthButton from '../components/AuthButton'
import OnboardingModal from '../components/OnboardingModal'
import LandingPage from '../components/LandingPage'
import { supabase } from '../lib/supabaseClient'
```

Add one line after the `LandingPage` import:

```js
import { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'
import AuthButton from '../components/AuthButton'
import OnboardingModal from '../components/OnboardingModal'
import LandingPage from '../components/LandingPage'
import SignedOutHomepage from '../components/SignedOutHomepage'
import { supabase } from '../lib/supabaseClient'
```

- [ ] **Step 2: Change the routing at line 1395**

Change:

```js
  if (!user) return <LandingPage />
```

to:

```js
  if (!user) return <SignedOutHomepage />
```

- [ ] **Step 3: Run local dev server and verify signed-out behavior**

```bash
cd frontend && npm run dev
```

Open `http://localhost:3000` in an incognito window (not signed in). Expected:
- Breaking Alpha nav with "Sign in" button top-right
- Hero headline and Google sign-in CTA button
- "THIS MORNING'S BRIEF" section with real briefing headline and market tone badge
- Two section previews (Deals & M&A, Public Markets), then a blurred section with "Sign in to read the full brief" CTA
- "LIVE TRACKER" section with 3 visible article cards, 2 blurred with "Sign in to see all stories" overlay
- Bottom CTA row

If Morning Review and articles show empty/loading states but no real data, Supabase RLS is blocking anonymous reads — see the Pre-Flight section above.

- [ ] **Step 4: Verify signed-in behavior is unchanged**

Sign in via the sign-in button. Expected:
- Redirects back to `http://localhost:3000`
- Full app renders exactly as before: sidebar, ticker bar, all tabs (Morning, Live, Evening, Watchlist, Deal Flow, etc.)
- OnboardingModal shows if first sign-in

- [ ] **Step 5: Commit**

```bash
git add frontend/pages/index.js
git commit -m "feat: route signed-out users to limited preview homepage"
```

---

## Edge Cases / Risks

### 1. Supabase RLS blocking anonymous reads (HIGH RISK)
If `articles` or `briefings` tables do not grant SELECT to the `anon` role, `SignedOutHomepage` will return empty data. The component handles this gracefully (shows empty state text), but the preview will show no real stories. **Check RLS before or immediately after shipping.** See Pre-Flight section above.

### 2. Auth loading flash (LOW RISK)
The current behavior at `if (authLoading) return null` shows a blank page for ~200–500ms while Supabase checks the session. This is unchanged and affects both signed-in and signed-out users. It's acceptable for v1. If it becomes an issue, replace `return null` with a minimal skeleton or the `SignedOutHomepage` itself.

### 3. `LandingPage.js` becomes unreferenced (NO RISK)
After this change, `LandingPage.js` is imported but never rendered (the import remains but the JSX is replaced). It can be safely removed in a follow-up PR. The import line itself causes no runtime effect.

### 4. `sections` JSON shape
The `sections` field in the briefings table is serialized JSON. The component parses it safely in a try/catch and falls back to `{}`. If the shape changes, `visibleSectionKeys` will be empty and the preview will just show the headline with the blur gate — no crash.

### 5. Signed-out users triggering OAuth via article click
Clicking any article card calls `handleSignIn` (Google OAuth redirect). The user will be redirected away from the page and back after auth — which is the intended flow. No state is lost (they just sign in).

---

## Recommendation: Smallest Version to Ship First

**Ship Task 1 + Task 2 as written.**

This is already the minimum. Two file changes: one new component (~200 lines), one 2-line edit to `index.js`. No redesign, no backend changes, no API routes modified. If Supabase RLS blocks anonymous reads, the preview degrades gracefully — not a broken wall. Validate RLS in Supabase dashboard after shipping to production.

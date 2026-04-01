import { supabase } from '../lib/supabaseClient'

export default function LandingPage() {
  const handleSignIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  }

  return (
    <div style={{ minHeight: '100vh', background: '#080c18', color: '#f8fafc' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=DM+Mono:wght@300;400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #080c18; }
        .lp-signin-nav:hover { border-color: #f59e0b !important; color: #f59e0b !important; }
        .lp-signin-bottom:hover { border-color: #f59e0b !important; color: #f59e0b !important; }
      `}</style>

      {/* Nav */}
      <div style={{ padding: '20px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '22px', fontWeight: 700 }}>
          <span style={{ color: '#fff' }}>Breaking</span><span style={{ color: '#f59e0b' }}>Alpha</span>
        </div>
        <button
          onClick={handleSignIn}
          className="lp-signin-nav"
          style={{ fontSize: '11px', padding: '6px 14px', borderRadius: '4px', border: '1px solid #374151', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontFamily: "'DM Mono', monospace", transition: 'all 0.15s ease' }}
        >
          Sign in
        </button>
      </div>

      {/* Hero */}
      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '80px 40px 60px' }}>
        <div style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", color: '#f59e0b', letterSpacing: '0.2em', marginBottom: '24px' }}>
          MARKET INTELLIGENCE
        </div>
        <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 'clamp(36px, 5vw, 60px)', fontWeight: 700, lineHeight: 1.1, color: '#f9fafb', marginBottom: '20px' }}>
          AI-native market intelligence<br />for what actually matters.
        </h1>
        <p style={{ fontSize: '14px', color: '#6b7280', lineHeight: 1.7, maxWidth: '540px', marginBottom: '36px', fontFamily: "'DM Mono', monospace" }}>
          Breaking Alpha surfaces the highest-signal stories, market moves, and company intelligence
          in real time — with morning briefings, live tracking, and watchlist-driven relevance.
        </p>

        {/* Primary CTA */}
        <button
          onClick={handleSignIn}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', padding: '12px 24px', borderRadius: '6px', border: '1px solid #f59e0b', background: 'rgba(245,158,11,0.08)', color: '#f59e0b', fontSize: '13px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', transition: 'all 0.15s ease' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.14)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.08)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Sign in with Google — it&apos;s free
        </button>
      </div>

      {/* Preview Section */}
      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '0 40px 80px' }}>
        <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: '#374151', letterSpacing: '0.16em', marginBottom: '20px' }}>
          WHAT YOU GET
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>

          {/* Morning Review */}
          <div style={{ background: '#0d1221', border: '1px solid #1a2235', borderRadius: '8px', padding: '20px' }}>
            <div style={{ fontSize: '9px', color: '#f59e0b', letterSpacing: '0.16em', marginBottom: '10px', fontFamily: "'DM Mono', monospace" }}>MORNING REVIEW</div>
            <div style={{ fontSize: '13px', color: '#e5e7eb', lineHeight: 1.5, marginBottom: '12px', fontFamily: "'DM Mono', monospace" }}>
              Daily AI briefing — top M&amp;A signals, sector moves, and deal flow, synthesized before market open.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {['Tech M&A acceleration', 'Private equity deployment', 'Macro headwinds'].map(s => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '3px', height: '3px', borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />
                  <span style={{ fontSize: '11px', color: '#6b7280', fontFamily: "'DM Mono', monospace" }}>{s}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Live Tracker */}
          <div style={{ background: '#0d1221', border: '1px solid #1a2235', borderRadius: '8px', padding: '20px' }}>
            <div style={{ fontSize: '9px', color: '#4ade80', letterSpacing: '0.16em', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px', fontFamily: "'DM Mono', monospace" }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#4ade80', display: 'inline-block', flexShrink: 0 }} />
              LIVE TRACKER
            </div>
            <div style={{ fontSize: '13px', color: '#e5e7eb', lineHeight: 1.5, marginBottom: '12px', fontFamily: "'DM Mono', monospace" }}>
              150+ articles from premium sources, filtered by sector, auto-refreshed every 60 seconds.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {['TECH M&A', 'VENTURE', 'PRIVATE EQ', 'GEO & MACRO'].map(s => (
                <span key={s} style={{ fontSize: '9px', padding: '2px 7px', borderRadius: '3px', border: '1px solid #1f2937', color: '#6b7280', fontFamily: "'DM Mono', monospace" }}>{s}</span>
              ))}
            </div>
          </div>

          {/* Why It Matters */}
          <div style={{ background: '#0d1221', border: '1px solid #1a2235', borderRadius: '8px', padding: '20px' }}>
            <div style={{ fontSize: '9px', color: '#8b5cf6', letterSpacing: '0.16em', marginBottom: '10px', fontFamily: "'DM Mono', monospace" }}>WHY IT MATTERS</div>
            <div style={{ fontSize: '13px', color: '#e5e7eb', lineHeight: 1.5, marginBottom: '12px', fontFamily: "'DM Mono', monospace" }}>
              Every article tagged with a market implication signal. See the deal angle, not just the headline.
            </div>
            <div style={{ padding: '10px', background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)', borderRadius: '4px', fontSize: '11px', color: '#9ca3af', lineHeight: 1.6, fontStyle: 'italic', fontFamily: "'DM Mono', monospace" }}>
              &ldquo;Signals valuation compression in late-stage SaaS — watch for secondary market activity.&rdquo;
            </div>
          </div>

        </div>

        {/* Bottom CTA */}
        <div style={{ marginTop: '48px', textAlign: 'center' }}>
          <button
            onClick={handleSignIn}
            className="lp-signin-bottom"
            style={{ fontSize: '12px', padding: '10px 22px', borderRadius: '4px', border: '1px solid #374151', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontFamily: "'DM Mono', monospace", transition: 'all 0.15s ease' }}
          >
            Get access — sign in with Google
          </button>
          <div style={{ marginTop: '12px', fontSize: '10px', color: '#374151', fontFamily: "'DM Mono', monospace" }}>Free. No credit card required.</div>
        </div>
      </div>
    </div>
  )
}

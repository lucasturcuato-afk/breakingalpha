"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { X, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { AISignalBar } from "@/components/dashboard/ai-signal-bar";
import { LeadStoryCard, CompactStoryCard } from "@/components/dashboard/story-card";
import { TickerPreviewCard } from "./ticker-preview-card";
import type { StoryData } from "@/components/dashboard/story-card";

// ── Mock data (same shape as the real dashboard) ──────────────────────────────

const previewStories: StoryData[] = [
  {
    id: "1",
    title: "NVIDIA Export Restrictions Tighten as US-China Chip War Escalates",
    source: "Reuters",
    timestamp: "12m ago",
    sentiment: "risk-off",
    sector: "Technology M&A",
    summary:
      "New Commerce Department rules will further restrict NVIDIA's ability to sell advanced AI chips to China, potentially impacting $5B+ in annual revenue. The restrictions expand beyond H100s to include custom variants designed for the Chinese market.",
    tags: ["NVDA", "Semiconductors", "Geopolitics"],
    read: false,
    saved: false,
  },
  {
    id: "2",
    title: "Fed Minutes Signal Patience on Rate Cuts Despite Cooling Inflation",
    source: "Bloomberg",
    timestamp: "1h ago",
    sentiment: "bearish",
    sector: "Public Markets",
    read: false,
    saved: false,
  },
  {
    id: "3",
    title: "Stripe Acquisition of Lemon Squeezy Signals Fintech Consolidation",
    source: "TechCrunch",
    timestamp: "2h ago",
    sentiment: "bullish",
    sector: "Fintech & Crypto",
    read: false,
    saved: false,
  },
  {
    id: "4",
    title: "OpenAI Closes $6.6B Round at $157B Valuation",
    source: "The Information",
    timestamp: "3h ago",
    sentiment: "bullish",
    sector: "Venture Capital",
    read: false,
    saved: false,
  },
];

// Static decorative spark arrays — visual texture only, not live data
const sparkSP = [4380, 4395, 4370, 4410, 4425, 4415, 4440, 4455, 4460, 4472, 4468, 4480];
const sparkVIX = [18.5, 17.2, 16.8, 15.9, 15.2, 14.8, 14.5, 14.1, 14.3, 14.6, 14.2, 14.2];
const sparkYield = [4.52, 4.48, 4.45, 4.42, 4.40, 4.38, 4.35, 4.33, 4.30, 4.28, 4.25, 4.22];
const sparkSignals = [3, 5, 2, 7, 4, 8, 6, 9, 5, 11, 8, 14];

const features = [
  "AI-generated morning briefings, rebuilt daily",
  "Live deal flow and M&A signal tracking",
  "Investment thesis board updated as markets move",
];

// ── Initial sign-in prompt ────────────────────────────────────────────────────

function SignInPrompt({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-espresso/40 backdrop-blur-sm"
        onClick={onDismiss}
        aria-hidden
      />

      {/* Card */}
      <div className="relative z-10 w-full max-w-[440px] bg-cream border border-border-base rounded-2xl shadow-[0_24px_48px_rgba(26,18,8,0.16)] overflow-hidden">
        {/* Close */}
        <button
          type="button"
          onClick={onDismiss}
          className="absolute top-4 right-4 p-1 rounded-md text-text-faint hover:text-text-secondary hover:bg-parchment-mid transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X size={15} />
        </button>

        <div className="px-8 py-8">
          {/* Logo */}
          <div className="mb-5">
            <span className="font-display text-[24px] font-extrabold text-espresso leading-none">
              Signal<span style={{ color: "var(--gold)" }}>era</span>
            </span>
            <p className="font-sans text-[11px] text-text-faint mt-1 uppercase tracking-widest">
              Where Markets Make Sense
            </p>
          </div>

          <h2 className="font-display text-[22px] font-extrabold text-espresso leading-snug mb-2">
            Unlock your personalized<br />market intelligence feed.
          </h2>
          <p className="font-sans text-[13px] text-text-secondary leading-relaxed mb-6">
            Join analysts who never miss a signal. Sign in to get briefings, deal flow, and theses personalized to your sectors and watchlist.
          </p>

          <div className="space-y-2 mb-6">
            {features.map((f) => (
              <div key={f} className="flex items-center gap-2.5">
                <div className="w-4 h-4 rounded-full bg-gold-muted border border-gold-border flex items-center justify-center flex-shrink-0">
                  <Check size={9} className="text-gold" />
                </div>
                <span className="font-sans text-[12px] text-text-secondary">{f}</span>
              </div>
            ))}
          </div>

          {/* Google CTA */}
          <button
            type="button"
            onClick={() => { window.location.href = "/auth"; }}
            className="w-full flex items-center justify-center gap-2 h-11 rounded-xl font-sans text-[13px] font-semibold cursor-pointer transition-all"
            style={{
              backgroundColor: "var(--espresso)",
              color: "var(--cream)",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Sign in with Google
          </button>

          <div className="flex items-center gap-3 mt-3">
            <div className="flex-1 h-px bg-border-subtle" />
            <span className="font-sans text-[10px] text-text-faint uppercase tracking-widest">or</span>
            <div className="flex-1 h-px bg-border-subtle" />
          </div>

          <button
            type="button"
            onClick={() => { window.location.href = "/auth"; }}
            className="w-full h-10 rounded-xl border border-border-base bg-parchment-mid font-sans text-[13px] font-medium text-text-secondary hover:border-border-hover hover:text-text-primary transition-all cursor-pointer mt-3"
          >
            Sign in with email
          </button>

          <button
            type="button"
            onClick={onDismiss}
            className="block w-full text-center mt-4 font-sans text-[12px] text-text-faint hover:text-text-muted transition-colors cursor-pointer"
          >
            Explore the preview first →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main landing page ─────────────────────────────────────────────────────────

export function LandingPage() {
  const [showPrompt, setShowPrompt] = useState(false);

  const [marketData, setMarketData] = useState<{
    sp500?: { price: string; pct: number } | null;
    vix?: { price: string; pct: number } | null;
    yield10y?: { price: string; pct: number } | null;
    signalsToday?: { count: number } | null;
  } | null>(null);

  const [tickerQuotes, setTickerQuotes] = useState<Record<string, { price: string; pct: number }>>({});

  useEffect(() => {
    const dismissed = sessionStorage.getItem("signalera_prompt_dismissed");
    if (!dismissed) {
      const timer = setTimeout(() => setShowPrompt(true), 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    fetch("/api/market-snapshot")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setMarketData(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/watchlist-quotes?symbols=META,NVDA,GOOGL,AMZN")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.quotes) setTickerQuotes(d.quotes); })
      .catch(() => {});
  }, []);

  function handleDismiss() {
    sessionStorage.setItem("signalera_prompt_dismissed", "1");
    setShowPrompt(false);
  }

  return (
    <div className="min-h-screen bg-parchment">
      {/* Initial sign-in prompt */}
      {showPrompt && <SignInPrompt onDismiss={handleDismiss} />}

      {/* ── Top navigation bar ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-cream/90 backdrop-blur-sm border-b border-border-base">
        <div className="max-w-[1200px] mx-auto px-6 h-14 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <img
              src="/logo-icon.png"
              alt="Signalera"
              style={{ height: "28px", width: "auto", objectFit: "contain" }}
            />
            <span className="font-display text-[20px] font-extrabold text-espresso leading-none">
              Signal<span style={{ color: "var(--gold)" }}>era</span>
            </span>
          </div>

          {/* Nav + CTA */}
          <div className="flex items-center gap-4">
            <span className="hidden sm:block font-sans text-[11px] text-text-faint uppercase tracking-widest">
              Where Markets Make Sense
            </span>
            <Button
              variant="gold"
              size="sm"
              onClick={() => { window.location.href = "/auth"; }}
            >
              Sign In
            </Button>
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="max-w-[1200px] mx-auto px-6 pt-16 pb-12">
        <div className="max-w-[680px]">
          {/* Badge */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gold-muted border border-gold-border mb-5">
            <Sparkles size={11} className="text-gold" />
            <span className="font-sans text-[11px] font-semibold text-gold-dark">
              AI-Native Market Intelligence
            </span>
          </div>

          {/* Headline */}
          <h1 className="font-display text-[52px] font-extrabold text-espresso leading-[1.05] tracking-tight mb-4">
            Stop piecing together
            <br />
            your morning
            <br />
            from 12 tabs.
          </h1>

          {/* Subhead */}
          <p className="font-sans text-[17px] text-text-secondary leading-relaxed mb-8 max-w-[540px]">
            Signalera synthesizes market-moving news, deal flow, and investment signals into one analyst-grade brief — built around what you actually track.
          </p>

          {/* CTAs */}
          <div className="flex items-center gap-3">
            <Button
              variant="gold"
              size="lg"
              onClick={() => { window.location.href = "/auth"; }}
            >
              Get Started — It&apos;s Free
            </Button>
            <button
              type="button"
              onClick={() => {
                document
                  .getElementById("preview-section")
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
              className="font-sans text-[13px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            >
              See a preview ↓
            </button>
          </div>

          {/* Social proof */}
          <p className="mt-4 font-sans text-[12px] text-text-faint">
            25 sectors tracked · 14 signals scored daily · Updated 6am and 8pm PST
          </p>
        </div>
      </section>

      {/* ── Dashboard Preview ──────────────────────────────────────────── */}
      <section id="preview-section" className="max-w-[1200px] mx-auto px-6 pb-16">
        {/* Section label */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center gap-1.5">
            <p className="font-sans text-[10px] font-semibold uppercase tracking-widest text-text-faint">
              Live Dashboard Preview
            </p>
            {marketData && (
              <div className="flex items-center gap-1">
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)' }} />
                <span className="font-data text-[10px] text-gold">Live</span>
              </div>
            )}
          </div>
          <div className="flex-1 h-px bg-border-subtle" />
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
          <StatCard
            label="S&P 500"
            value={marketData?.sp500?.price ?? "—"}
            change={marketData?.sp500?.pct ?? 0}
            accentGold
            sparkData={sparkSP}
            detailRows={[{ label: "Day range", value: "—" }]}
          />
          <StatCard
            label="VIX Fear Index"
            value={marketData?.vix?.price ?? "—"}
            change={marketData?.vix?.pct ?? 0}
            sparkData={sparkVIX}
            detailRows={[{ label: "5d avg", value: "—" }]}
          />
          <StatCard
            label="10Y Yield"
            value={marketData?.yield10y?.price ?? "—"}
            change={marketData?.yield10y?.pct ?? 0}
            sparkData={sparkYield}
            detailRows={[{ label: "Real rate", value: "—" }]}
          />
          <StatCard
            label="Signals Today"
            value={marketData?.signalsToday?.count?.toString() ?? "—"}
            change={0}
            accentGold
            sparkData={sparkSignals}
            detailRows={[{ label: "Bullish", value: "—" }, { label: "Bearish", value: "—" }]}
          />
        </div>

        {/* AI signal bar */}
        <div className="mb-4">
          <AISignalBar
            text="Fed language shift detected across 3 FOMC transcripts — dovish pivot probability rising. Bond markets already pricing in."
            boldParts={["Fed language shift", "dovish pivot probability rising"]}
            ctaHref="/auth"
          />
        </div>

        {/* Stories */}
        <div className="mb-6">
          {/* Stories label row */}
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-sans text-[11px] font-semibold uppercase tracking-widest text-text-muted">
              Top Stories — Today
            </h2>
            <a
              href="/morning-brief"
              className="font-sans text-[10px] font-semibold text-gold hover:text-gold-dark transition-colors cursor-pointer"
            >
              Full live feed →
            </a>
          </div>

          {/* 3 stories — all clickable, route to /auth on click */}
          <div
            onClickCapture={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.location.href = "/auth";
            }}
          >
            <LeadStoryCard story={previewStories[0]} />
            <div className="mt-2 space-y-0">
              <CompactStoryCard story={previewStories[1]} number={2} />
              <CompactStoryCard story={previewStories[2]} number={3} />
            </div>
          </div>

          {/* Gradient fade gate — partial 4th story */}
          <div className="relative mt-2">
            {/* Partially visible 4th story — clipped */}
            <div style={{ maxHeight: '48px', overflow: 'hidden', pointerEvents: 'none', userSelect: 'none', opacity: 0.7 }}>
              <CompactStoryCard story={previewStories[3]} number={4} />
            </div>
            {/* Gradient overlay */}
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '40px', background: 'linear-gradient(to bottom, transparent, var(--parchment))' }} />
          </div>

          {/* Inline sign-in row */}
          <div className="flex items-center justify-between px-3 py-2.5 mt-1 bg-gold-muted border border-gold-border rounded-xl">
            <div className="flex items-center gap-2">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gold" aria-hidden><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <span className="font-sans text-[12px] text-gold">
                {marketData?.signalsToday?.count != null && marketData.signalsToday.count > 3
                  ? `${marketData.signalsToday.count - 3} more signals today`
                  : "More signals today"} — Sign in to read all
              </span>
            </div>
            <button
              type="button"
              onClick={() => { window.location.href = "/auth"; }}
              className="font-sans text-[11px] font-semibold text-gold hover:text-gold-dark transition-colors cursor-pointer"
              style={{ background: 'none', border: 'none', padding: 0 }}
            >
              Sign in →
            </button>
          </div>
        </div>

        {/* Company Intelligence section */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <p className="font-sans text-[10px] font-semibold uppercase tracking-widest text-text-faint">
              Live Company Intelligence
            </p>
            <div className="flex-1 h-px bg-border-subtle" />
          </div>
          <div className="grid grid-cols-2 gap-2.5" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            {([
              { ticker: "META", name: "Meta Platforms", href: "/watchlist/META" },
              { ticker: "NVDA", name: "NVIDIA Corp.", href: "/watchlist/NVDA" },
              { ticker: "GOOGL", name: "Alphabet Inc.", href: "/watchlist/GOOGL" },
              { ticker: "AMZN", name: "Amazon.com", href: "/watchlist/AMZN" },
            ] as const).map(({ ticker, name, href }) => (
              <TickerPreviewCard
                key={ticker}
                ticker={ticker}
                name={name}
                price={tickerQuotes[ticker]?.price}
                pct={tickerQuotes[ticker]?.pct}
                articleCount={20}
                href={href}
              />
            ))}
          </div>
          <p className="mt-3 text-center font-sans text-[12px] text-text-faint">
            <a href="/morning-brief" className="hover:text-text-muted transition-colors">
              Explore company coverage →
            </a>
          </p>
        </div>
      </section>

      {/* ── Dark bottom CTA ────────────────────────────────────────────── */}
      <section style={{ background: 'var(--espresso)' }} className="py-16">
        <div className="max-w-[480px] mx-auto px-6 text-center">
          <p className="font-sans text-[11px] uppercase tracking-widest mb-4" style={{ color: 'var(--gold)' }}>
            Built for finance professionals
          </p>
          <h2 className="font-display text-[36px] font-extrabold leading-tight mb-4" style={{ color: 'var(--cream)' }}>
            Your edge starts here.
          </h2>
          <p className="font-sans text-[14px] leading-relaxed mb-8" style={{ color: 'rgba(255,255,255,0.65)' }}>
            Morning briefs, live deal flow, investment theses — personalized to your sectors and watchlist. Free to start, 90 seconds to set up.
          </p>
          <Button
            variant="gold"
            size="lg"
            onClick={() => { window.location.href = "/auth"; }}
          >
            Sign in with Google — Free Access
          </Button>
          <div className="mt-4">
            <Link
              href="/auth"
              className="font-sans text-[13px] transition-colors"
              style={{ color: 'rgba(255,255,255,0.65)' }}
            >
              Or sign in with email →
            </Link>
          </div>
          <p className="mt-6 font-sans text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
            No credit card. No paywall. Personalization unlocks when you sign in.
          </p>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="border-t border-border-subtle bg-parchment">
        <div className="max-w-[1200px] mx-auto px-6 py-6 flex items-center justify-between">
          <span className="font-display text-[16px] font-bold text-espresso">
            Signal<span style={{ color: "var(--gold)" }}>era</span>
          </span>
          <p className="font-sans text-[11px] text-text-faint">
            © {new Date().getFullYear()} Signalera. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

"use client";

import { useState, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { X, Check, Sparkles, LayoutGrid, Clock, FileText, Briefcase, Star, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { AISignalBar } from "@/components/dashboard/ai-signal-bar";
import { LeadStoryCard, CompactStoryCard } from "@/components/dashboard/story-card";
import { AuthGate } from "./auth-gate";
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

// ── Module teaser cards (gated) ───────────────────────────────────────────────

function ModuleTeaser({
  icon,
  label,
  description,
}: {
  icon: ReactNode;
  label: string;
  description: string;
}) {
  return (
    <div className="bg-white border border-border-base rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg bg-parchment-mid border border-border-base flex items-center justify-center text-text-faint">
          {icon}
        </div>
        <span className="font-sans text-[12px] font-semibold text-text-primary">{label}</span>
      </div>
      <p className="font-sans text-[11px] text-text-muted leading-snug">{description}</p>
      <div className="mt-3 space-y-1.5">
        {[60, 80, 45].map((w, i) => (
          <div
            key={i}
            className="h-2 rounded-full bg-border-subtle"
            style={{ width: `${w}%` }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main landing page ─────────────────────────────────────────────────────────

export function LandingPage() {
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const dismissed = sessionStorage.getItem("signalera_prompt_dismissed");
    if (!dismissed) {
      const timer = setTimeout(() => setShowPrompt(true), 700);
      return () => clearTimeout(timer);
    }
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
            Where Markets
            <br />
            Make Sense.
          </h1>

          {/* Subhead */}
          <p className="font-sans text-[17px] text-text-secondary leading-relaxed mb-8 max-w-[520px]">
            Analyst-grade briefings, live deal flow, and investment theses — personalized to your sectors, your watchlist, and how you invest.
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
        </div>
      </section>

      {/* ── Dashboard Preview ──────────────────────────────────────────── */}
      <section id="preview-section" className="max-w-[1200px] mx-auto px-6 pb-16">
        {/* Section label */}
        <div className="flex items-center gap-3 mb-4">
          <p className="font-sans text-[10px] font-semibold uppercase tracking-widest text-text-faint">
            Live Dashboard Preview
          </p>
          <div className="flex-1 h-px bg-border-subtle" />
          <span className="font-sans text-[10px] text-text-faint">
            Sign in to see your personalized feed
          </span>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
          <StatCard
            label="S&P 500"
            value="4,480.22"
            change={0.38}
            accentGold
            sparkData={sparkSP}
            detailRows={[{ label: "Day range", value: "4,370 – 4,482" }]}
          />
          <StatCard
            label="VIX Fear Index"
            value="14.22"
            change={-3.12}
            sparkData={sparkVIX}
            detailRows={[{ label: "5d avg", value: "15.1" }]}
          />
          <StatCard
            label="10Y Yield"
            value="4.22%"
            change={-0.08}
            sparkData={sparkYield}
            detailRows={[{ label: "Real rate", value: "1.85%" }]}
          />
          <StatCard
            label="Signals Today"
            value="14"
            change={16.67}
            accentGold
            sparkData={sparkSignals}
            detailRows={[{ label: "Bullish", value: "8" }, { label: "Bearish", value: "6" }]}
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
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-sans text-[11px] font-semibold uppercase tracking-widest text-text-muted">
              Top Stories — Today
            </h2>
            <button
              type="button"
              onClick={() => { window.location.href = "/auth"; }}
              className="font-sans text-[10px] font-semibold text-gold hover:text-gold-dark transition-colors cursor-pointer"
            >
              Sign in to see all →
            </button>
          </div>

          {/* Lead story — fully visible */}
          <LeadStoryCard story={previewStories[0]} />

          {/* Compact stories — 2 visible */}
          <div className="mt-2 space-y-0">
            <CompactStoryCard story={previewStories[1]} number={2} />
            <CompactStoryCard story={previewStories[2]} number={3} />
          </div>

          {/* Gated stories */}
          <div className="mt-2">
            <AuthGate message="Sign in to access all 14 stories in your personalized feed">
              <div className="space-y-0">
                <CompactStoryCard story={previewStories[3]} number={4} />
                <CompactStoryCard story={{ ...previewStories[0], id: "5", title: "Apollo Weighs $3B Bid for Global Infrastructure Assets", sector: "Private Equity", timestamp: "4h ago" }} number={5} />
              </div>
            </AuthGate>
          </div>
        </div>

        {/* Gated modules grid */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <p className="font-sans text-[10px] font-semibold uppercase tracking-widest text-text-faint">
              Research Modules
            </p>
            <div className="flex-1 h-px bg-border-subtle" />
          </div>
          <AuthGate message="Sign in to access your Thesis Board, Deal Flow tracker, and Watchlist">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <ModuleTeaser
                icon={<FileText size={14} />}
                label="Thesis Board"
                description="AI-generated investment theses updated as new signals arrive"
              />
              <ModuleTeaser
                icon={<Briefcase size={14} />}
                label="Deal Flow"
                description="Live M&A pipeline with stage tracking and AI memos"
              />
              <ModuleTeaser
                icon={<Star size={14} />}
                label="Watchlist"
                description="Personalized coverage for your tickers and sectors"
              />
            </div>
          </AuthGate>
        </div>

        {/* Nav preview (gated) */}
        <AuthGate message="Morning Brief, Evening Wrap, Company Intel, and Trends — all personalized">
          <div className="bg-white border border-border-base rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <p className="font-sans text-[10px] font-semibold uppercase tracking-widest text-text-faint">
                Full Navigation
              </p>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { icon: <Clock size={13} />, label: "Morning Brief" },
                { icon: <LayoutGrid size={13} />, label: "Dashboard" },
                { icon: <TrendingUp size={13} />, label: "Trends" },
                { icon: <Briefcase size={13} />, label: "Deal Flow" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-parchment-mid border border-border-subtle"
                >
                  <span className="text-text-faint">{item.icon}</span>
                  <span className="font-sans text-[12px] font-medium text-text-muted">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </AuthGate>
      </section>

      {/* ── Bottom CTA ─────────────────────────────────────────────────── */}
      <section className="border-t border-border-base bg-cream">
        <div className="max-w-[1200px] mx-auto px-6 py-16 text-center">
          <p className="font-sans text-[11px] font-semibold uppercase tracking-widest text-gold mb-4">
            Personalized to your portfolio
          </p>
          <h2 className="font-display text-[40px] font-extrabold text-espresso leading-tight mb-4">
            Markets move fast.
            <br />
            Your intelligence should too.
          </h2>
          <p className="font-sans text-[15px] text-text-secondary leading-relaxed max-w-[520px] mx-auto mb-8">
            Signalera learns your sectors, tracks your watchlist, and delivers briefings built for how you actually invest. Set up takes 90 seconds.
          </p>

          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Button
              variant="gold"
              size="lg"
              onClick={() => { window.location.href = "/auth"; }}
            >
              Sign in with Google — Free Access
            </Button>
            <Link
              href="/auth"
              className="font-sans text-[13px] text-text-secondary hover:text-text-primary transition-colors"
            >
              Or sign in with email →
            </Link>
          </div>

          <p className="mt-6 font-sans text-[11px] text-text-faint">
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

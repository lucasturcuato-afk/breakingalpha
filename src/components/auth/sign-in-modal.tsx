"use client";

import { X, Check } from "lucide-react";

interface SignInModalProps {
  isOpen: boolean;
  onClose: () => void;
  headline?: string;
  message?: string;
}

const DEFAULT_FEATURES = [
  "AI-generated morning briefings, rebuilt daily",
  "Live deal flow and M&A signal tracking",
  "Investment thesis board updated as markets move",
];

export function SignInModal({
  isOpen,
  onClose,
  headline = "Sign in to continue",
  message = "Create a free account to unlock full access.",
}: SignInModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-espresso/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      {/* Card */}
      <div className="relative z-10 w-full max-w-[440px] bg-cream border border-border-base rounded-2xl shadow-[0_24px_48px_rgba(26,18,8,0.16)] overflow-hidden">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-md text-text-faint hover:text-text-secondary hover:bg-parchment-mid transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X size={15} />
        </button>
        <div className="px-8 py-8">
          <div className="mb-5">
            <span className="font-display text-[24px] font-extrabold text-espresso leading-none">
              Signal<span style={{ color: "var(--gold)" }}>era</span>
            </span>
            <p className="font-sans text-[11px] text-text-faint mt-1 uppercase tracking-widest">
              Where Markets Make Sense
            </p>
          </div>
          <h2 className="font-display text-[22px] font-extrabold text-espresso leading-snug mb-2">
            {headline}
          </h2>
          <p className="font-sans text-[13px] text-text-secondary leading-relaxed mb-6">
            {message}
          </p>
          <div className="space-y-2 mb-6">
            {DEFAULT_FEATURES.map((f) => (
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
            style={{ backgroundColor: "var(--espresso)", color: "var(--cream)" }}
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
            onClick={onClose}
            className="block w-full text-center mt-4 font-sans text-[12px] text-text-faint hover:text-text-muted transition-colors cursor-pointer"
          >
            Explore the preview first →
          </button>
        </div>
      </div>
    </div>
  );
}

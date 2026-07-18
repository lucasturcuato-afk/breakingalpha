"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { cn } from "@/lib/utils";
import { Mail, Lock, Eye, EyeOff, Check, X } from "lucide-react";

// Auth modal for the signed-out landing. It reuses the same Supabase client
// calls as /auth (Google OAuth + email/password), but does NOT implement any
// allowlist logic itself. The beta gate is enforced downstream in
// /auth/callback (OAuth + email-confirmation redirect). This component only
// builds the UI and fires the existing auth primitives.

type AuthMode = "signin" | "signup";

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export function WaitlistModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<AuthMode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupSuccess, setSignupSuccess] = useState(false);

  // Close on Escape and lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = getSupabase();

    if (mode === "signin") {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        setError(signInError.message);
        setLoading(false);
      } else {
        window.location.href = "/dashboard";
      }
    } else {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (signUpError) {
        setError(signUpError.message);
        setLoading(false);
      } else {
        setSignupSuccess(true);
        setLoading(false);
      }
    }
  }

  async function handleGoogle() {
    const supabase = getSupabase();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          access_type: "offline",
          prompt: "select_account",
        },
      },
    });
    if (oauthError) setError(oauthError.message);
  }

  return (
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-label="Join the waitlist"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-espresso/70 backdrop-blur-sm cursor-default"
      />

      {/* Card */}
      <div className="relative w-full max-w-[420px] rounded-2xl border border-gold-border bg-cream-hi shadow-2xl p-8 sm:p-10">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-text-muted hover:text-text-primary hover:bg-gold-muted transition-colors cursor-pointer"
        >
          <X size={16} />
        </button>

        {/* Wordmark */}
        <div className="mb-6 text-center">
          <span className="font-display text-[26px] font-bold leading-none tracking-tight">
            <span className="text-espresso">Signal</span>
            <span className="text-gold">era</span>
          </span>
        </div>

        {signupSuccess ? (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gold-muted">
              <Check size={22} className="text-gold" />
            </div>
            <p className="font-display text-[20px] text-text-primary">
              Check your email
            </p>
            <p className="mt-3 font-sans text-[13.5px] text-text-muted leading-relaxed">
              Confirm your email to finish. Access opens in small waves during
              private beta.
            </p>
            <button
              type="button"
              onClick={() => {
                setSignupSuccess(false);
                setMode("signin");
              }}
              className="mt-5 font-sans text-[13px] text-gold hover:text-gold-dark cursor-pointer transition-colors"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <>
            {/* Mode toggle */}
            <div className="mb-6 flex items-center gap-1 rounded-lg border border-border-base bg-surface p-0.5">
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
                className={cn(
                  "flex-1 rounded-md py-2.5 font-sans text-[13px] font-semibold transition-all cursor-pointer",
                  mode === "signup"
                    ? "bg-gold text-cream"
                    : "bg-transparent text-text-muted hover:text-text-primary",
                )}
              >
                Join waitlist
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setError(null);
                }}
                className={cn(
                  "flex-1 rounded-md py-2.5 font-sans text-[13px] font-semibold transition-all cursor-pointer",
                  mode === "signin"
                    ? "bg-gold text-cream"
                    : "bg-transparent text-text-muted hover:text-text-primary",
                )}
              >
                Sign in
              </button>
            </div>

            {/* Google */}
            <button
              type="button"
              onClick={handleGoogle}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border-base bg-surface font-sans text-[13px] font-medium text-text-primary hover:border-gold-border hover:bg-gold-muted transition-all cursor-pointer"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Continue with Google
            </button>

            {/* Divider */}
            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-border-base" />
              <span className="font-sans text-[10px] uppercase tracking-widest text-text-faint">
                or
              </span>
              <div className="h-px flex-1 bg-border-base" />
            </div>

            {error && (
              <div className="mb-4 rounded-lg border border-signal-dn/30 bg-signal-dn/10 px-3 py-2.5">
                <p className="font-sans text-[12px] text-signal-dn">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="relative">
                <Mail
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint"
                />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  required
                  className="h-11 w-full rounded-lg border border-border-base bg-surface pl-10 pr-3 font-sans text-[13px] text-text-primary placeholder:text-text-faint focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold-border"
                />
              </div>
              <div className="relative">
                <Lock
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint"
                />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  required
                  className="h-11 w-full rounded-lg border border-border-base bg-surface pl-10 pr-10 font-sans text-[13px] text-text-primary placeholder:text-text-faint focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold-border"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-faint hover:text-text-muted cursor-pointer transition-colors"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="h-11 w-full rounded-lg bg-gold font-sans text-[13px] font-semibold text-cream hover:bg-gold-light active:bg-gold-dark transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading
                  ? "Please wait..."
                  : mode === "signup"
                    ? "Join the waitlist"
                    : "Sign in"}
              </button>
            </form>

            <p className="mt-5 text-center font-sans text-[11px] leading-relaxed text-text-faint">
              Private beta. Access opens in small waves. Informational only,
              never advice.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

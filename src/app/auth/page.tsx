"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { isAllowlisted } from "@/lib/allowlist";
import { postWaitlistRegister } from "@/lib/waitlist-register-client";
import { cn } from "@/lib/utils";
import { Mail, Lock, Eye, EyeOff, Check } from "lucide-react";
import Link from "next/link";

type AuthMode = "signin" | "signup";

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export default function AuthPage() {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotToast, setForgotToast] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = getSupabase();

    if (mode === "signin") {
      const { error: signInError } =
        await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
        setLoading(false);
      } else {
        // Enforce the beta allowlist on the direct password sign-in path too.
        // signInWithPassword mints a session without ever touching the OAuth
        // callback gate, so a provisioned-but-non-approved account would
        // otherwise walk straight into /dashboard. Mirror the callback: if not
        // approved, sign out and route to /waitlist. Fails closed (isAllowlisted
        // returns false on any query error). RLS allowlist_read_self lets this
        // authenticated browser client read its own row.
        const approved = await isAllowlisted(supabase, email);
        if (!approved) {
          await supabase.auth.signOut();
          // Additionally register so the non-approved sign-in produces a
          // waitlist row + our email (idempotent, so no double email). A
          // duplicate routes to the already-on-the-list variant.
          const reg = await postWaitlistRegister(email, "auth_signin");
          window.location.href = reg?.duplicate
            ? "/waitlist?existing=1"
            : "/waitlist";
        } else {
          window.location.href = "/dashboard";
        }
      }
    } else {
      const { error: signUpError } =
        await supabase.auth.signUp({
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
        // Register immediately so a non-approved signup gets a waitlist row +
        // our email regardless of whether Supabase ever delivers its
        // confirmation link. If approved, let the normal confirm flow proceed;
        // if not, route straight to /waitlist.
        const reg = await postWaitlistRegister(email, "auth_signup");
        if (reg && !reg.approved) {
          window.location.href = reg.duplicate
            ? "/waitlist?existing=1"
            : "/waitlist";
        } else {
          setSignupSuccess(true);
          setLoading(false);
        }
      }
    }
  }

  async function handleGoogleSSO() {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          access_type: "offline",
          prompt: "select_account",
        },
      },
    });
    if (error) console.error("OAuth error:", error.message);
  }

  const features = [
    "Live AI-generated market signals",
    "Real-time deal flow and M&A tracking",
    "AI thesis board updated as markets move",
  ];

  return (
    <div className="min-h-screen flex bg-parchment">
      {/* ── Left panel: Brand + Features (55%) ── */}
      <div className="hidden lg:flex lg:w-[55%] relative flex-col justify-between p-12 bg-sidebar-bg border-r border-border-base">
        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <img
            src="/logo-icon.png"
            alt=""
            className="h-9 w-auto object-contain"
          />
          <span className="font-display text-[32px] font-bold leading-none tracking-[-0.02em]">
            <span className="text-espresso">Signal</span>
            <span className="text-gold">era</span>
          </span>
        </div>

        {/* Center content */}
        <div className="relative z-10 max-w-lg">
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold mb-5">
            AI-Native Market Intelligence
          </div>
          <h1 className="font-display text-[44px] text-espresso leading-[1.1] tracking-tight">
            Institutional-grade
            <br />
            market intelligence.
          </h1>
          <p className="mt-5 font-sans text-[16px] text-text-muted leading-relaxed">
            Join analysts tracking signals that move markets.
          </p>

          <div className="mt-10 space-y-4">
            {features.map((text) => (
              <div key={text} className="flex items-center gap-3">
                <div className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center bg-gold-muted">
                  <Check size={12} className="text-gold" />
                </div>
                <span className="font-sans text-[15px] text-text-secondary">
                  {text}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom */}
        <div className="relative z-10">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-faint">
            Trusted by analysts at top-tier firms
          </p>
        </div>
      </div>

      {/* ── Right panel: Auth card (45%) ── */}
      <div className="relative flex-1 flex items-center justify-center px-6 py-12 lg:w-[45%] bg-parchment">
        <BackToHomeLink />
        <div className="w-full max-w-[420px]">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center gap-2 mb-10">
            <img
              src="/logo-icon.png"
              alt=""
              className="h-7 w-auto object-contain"
            />
            <span className="font-display text-[24px] font-bold leading-none">
              <span className="text-espresso">Signal</span>
              <span className="text-gold">era</span>
            </span>
          </div>

          {/* Signup success */}
          {signupSuccess ? (
            <div className="rounded-2xl p-10 text-center bg-elevated border border-border-base shadow-sm">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 bg-gold-muted">
                <Check size={24} className="text-gold" />
              </div>
              <p className="font-display text-[22px] text-espresso">
                Check your email
              </p>
              <p className="mt-3 font-sans text-[14px] text-text-muted leading-relaxed">
                Check your email to confirm your account.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSignupSuccess(false);
                  setMode("signin");
                }}
                className="mt-5 font-sans text-[13px] text-gold cursor-pointer transition-colors hover:text-gold-dark"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <div className="rounded-2xl p-10 bg-elevated border border-border-base shadow-sm">
              {/* Mode toggle */}
              <div className="flex items-center gap-1 rounded-lg p-0.5 mb-7 bg-surface border border-border-base">
                <button
                  type="button"
                  onClick={() => {
                    setMode("signin");
                    setError(null);
                  }}
                  className={cn(
                    "flex-1 py-2.5 rounded-md font-sans text-[13px] font-semibold transition-all cursor-pointer",
                    mode === "signin"
                      ? "bg-gold text-cream"
                      : "bg-transparent text-text-muted hover:text-espresso",
                  )}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("signup");
                    setError(null);
                  }}
                  className={cn(
                    "flex-1 py-2.5 rounded-md font-sans text-[13px] font-semibold transition-all cursor-pointer",
                    mode === "signup"
                      ? "bg-gold text-cream"
                      : "bg-transparent text-text-muted hover:text-espresso",
                  )}
                >
                  Create Account
                </button>
              </div>

              {/* Google SSO */}
              <button
                type="button"
                onClick={handleGoogleSSO}
                className="w-full flex items-center justify-center gap-2 h-11 rounded-lg font-sans text-[13px] font-medium text-espresso transition-all cursor-pointer border border-border-base bg-surface hover:border-gold-border"
              >
                <svg width="16" height="16" viewBox="0 0 24 24">
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
              <div className="flex items-center gap-3 my-6">
                <div className="flex-1 h-px bg-border-base" />
                <span className="font-mono text-[10px] text-text-faint uppercase tracking-widest">
                  or
                </span>
                <div className="flex-1 h-px bg-border-base" />
              </div>

              {/* Error */}
              {error && (
                <div className="mb-4 rounded-lg px-3 py-2.5 bg-signal-dn/[0.08] border border-signal-dn/20">
                  <p className="font-sans text-[12px] text-signal-dn">{error}</p>
                </div>
              )}

              {/* Form */}
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
                    className="w-full h-11 pl-10 pr-3 rounded-lg font-sans text-[13px] text-espresso bg-surface border border-border-base transition-colors focus:outline-none focus:border-gold placeholder:text-text-muted"
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
                    className="w-full h-11 pl-10 pr-10 rounded-lg font-sans text-[13px] text-espresso bg-surface border border-border-base transition-colors focus:outline-none focus:border-gold placeholder:text-text-muted"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-faint cursor-pointer transition-colors hover:text-espresso"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>

                {mode === "signin" && (
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setForgotToast(true);
                        setTimeout(() => setForgotToast(false), 3000);
                      }}
                      className="font-sans text-[12px] text-gold cursor-pointer transition-colors hover:text-gold-dark"
                    >
                      Forgot password?
                    </button>
                    {forgotToast && (
                      <p className="mt-1 font-sans text-[11px] text-gold animate-pulse">
                        Password reset coming soon.
                      </p>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 rounded-lg font-sans text-[13px] font-semibold bg-gold text-cream transition-all cursor-pointer hover:bg-gold-dark disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading
                    ? "Please wait..."
                    : mode === "signin"
                      ? "Sign In"
                      : "Create Account"}
                </button>
              </form>
            </div>
          )}

          {/* Footer */}
          <p className="text-center mt-6 font-sans text-[11px] text-text-faint">
            By continuing, you agree to Signalera&apos;s Terms of Service and
            Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}

function BackToHomeLink() {
  return (
    <Link
      href="/"
      className="absolute top-4 left-5 flex items-center gap-1 font-sans text-[12px] text-text-muted no-underline transition-colors hover:text-espresso"
    >
      ← Back to home
    </Link>
  );
}

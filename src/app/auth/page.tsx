"use client";

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  Zap,
  BarChart3,
  Target,
  CheckCircle2,
} from "lucide-react";

type AuthMode = "signin" | "signup";

function getSupabase() {
  return createClient(
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
  const [signupSuccess, setSignupSuccess] = useState(false);

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

  async function handleGoogleSSO() {
    const supabase = getSupabase();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + "/auth/callback",
      },
    });
  }

  const features = [
    {
      icon: Zap,
      title: "AI Market Intelligence",
      desc: "Real-time signals powered by advanced language models",
    },
    {
      icon: BarChart3,
      title: "Live Signal Feed",
      desc: "Institutional-grade alerts before they hit the wire",
    },
    {
      icon: Target,
      title: "Deal Flow Tracking",
      desc: "Track opportunities from thesis to execution",
    },
  ];

  return (
    <div className="min-h-screen flex bg-[#0a0a0b]">
      {/* ── Left panel: Brand + Features ── */}
      <div className="hidden lg:flex lg:w-[60%] relative flex-col justify-between p-12 overflow-hidden">
        {/* Background texture */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#0f0c07] via-[#0a0a0b] to-[#1a1208]" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, #c9922a 1px, transparent 0)",
            backgroundSize: "32px 32px",
          }}
        />

        {/* Dashboard blur preview */}
        <div className="absolute top-1/2 left-1/2 -translate-x-[40%] -translate-y-1/2 w-[700px] h-[500px] rounded-2xl border border-[#c9922a22] bg-[#1a120811] backdrop-blur-sm overflow-hidden opacity-20">
          <div className="p-6 space-y-4">
            <div className="flex gap-3">
              <div className="h-3 w-24 rounded bg-[#c9922a33]" />
              <div className="h-3 w-16 rounded bg-[#c9922a1a]" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className="h-20 rounded-lg bg-[#c9922a0a] border border-[#c9922a11]"
                />
              ))}
            </div>
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="h-8 rounded bg-[#c9922a08] border border-[#c9922a0a]"
                />
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="relative z-10">
          <img
            src="/logo.png"
            alt="Signalera"
            className="brightness-110 contrast-95"
            style={{
              height: "48px",
              width: "auto",
              objectFit: "contain",
            }}
          />
        </div>

        <div className="relative z-10 max-w-md">
          <p className="font-display text-[40px] leading-[1.15] tracking-tight text-[#f5f0e8]">
            Where Markets
            <br />
            <span className="text-[#c9922a]">Make Sense</span>
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-[#8a7a60]">
            Signalera synthesizes thousands of market signals into
            institutional-grade intelligence — so you see the story before the
            street does.
          </p>

          <div className="mt-10 space-y-5">
            {features.map((f) => (
              <div key={f.title} className="flex items-start gap-4">
                <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-[#c9922a14] border border-[#c9922a22] flex items-center justify-center">
                  <f.icon size={16} className="text-[#c9922a]" />
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-[#f5f0e8]">
                    {f.title}
                  </p>
                  <p className="text-[12px] text-[#8a7a60] mt-0.5">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-[11px] text-[#5a4a2a]">
            &copy; {new Date().getFullYear()} Signalera. All rights reserved.
          </p>
        </div>
      </div>

      {/* ── Right panel: Auth card ── */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 lg:w-[40%]">
        <div className="w-full max-w-[400px]">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <img
              src="/logo.png"
              alt="Signalera"
              className="brightness-110 contrast-95"
              style={{
                height: "40px",
                width: "auto",
                objectFit: "contain",
                margin: "0 auto",
                display: "block",
              }}
            />
          </div>

          {/* Headlines */}
          <div className="mb-8">
            <h1 className="font-display text-[24px] leading-tight tracking-tight text-[#f5f0e8]">
              Institutional-grade market intelligence.
            </h1>
            <p className="mt-2 text-[13px] text-[#8a7a60]">
              Join analysts tracking signals that move markets.
            </p>
          </div>

          {/* Signup success state */}
          {signupSuccess ? (
            <div className="rounded-2xl border border-[#c9922a33] bg-[#c9922a0a] p-6 text-center">
              <CheckCircle2
                size={32}
                className="text-[#c9922a] mx-auto mb-3"
              />
              <p className="text-[15px] font-semibold text-[#f5f0e8]">
                Check your email
              </p>
              <p className="mt-2 text-[13px] text-[#8a7a60] leading-relaxed">
                We sent a confirmation link to{" "}
                <span className="text-[#c9922a]">{email}</span>. Click it to
                activate your account.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSignupSuccess(false);
                  setMode("signin");
                }}
                className="mt-4 text-[12px] text-[#c9922a] hover:text-[#e8b84b] transition-colors cursor-pointer"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            /* Auth card */
            <div className="rounded-2xl border border-[#2a2010] bg-[#0f0c07]/80 backdrop-blur-xl p-6">
              {/* Mode toggle */}
              <div className="flex items-center gap-1 bg-[#1a1208] border border-[#2a2010] rounded-lg p-0.5 mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setMode("signin");
                    setError(null);
                  }}
                  className={cn(
                    "flex-1 py-2 rounded-md font-sans text-[12px] font-semibold transition-all cursor-pointer",
                    mode === "signin"
                      ? "bg-[#c9922a] text-[#0a0a0b]"
                      : "text-[#8a7a60] hover:text-[#f5f0e8]",
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
                    "flex-1 py-2 rounded-md font-sans text-[12px] font-semibold transition-all cursor-pointer",
                    mode === "signup"
                      ? "bg-[#c9922a] text-[#0a0a0b]"
                      : "text-[#8a7a60] hover:text-[#f5f0e8]",
                  )}
                >
                  Create Account
                </button>
              </div>

              {/* Google SSO */}
              <button
                type="button"
                onClick={handleGoogleSSO}
                className={cn(
                  "w-full flex items-center justify-center gap-2 h-10 rounded-lg",
                  "border border-[#2a2010] bg-[#1a1208]",
                  "font-sans text-[13px] font-medium text-[#f5f0e8]",
                  "hover:border-[#c9922a44] hover:bg-[#1a120899] transition-all",
                  "cursor-pointer",
                )}
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
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-[#2a2010]" />
                <span className="font-sans text-[10px] text-[#5a4a2a] uppercase tracking-widest">
                  or
                </span>
                <div className="flex-1 h-px bg-[#2a2010]" />
              </div>

              {/* Error */}
              {error && (
                <div className="mb-4 rounded-lg bg-[#dc262611] border border-[#dc262633] px-3 py-2">
                  <p className="text-[12px] text-[#dc2626]">{error}</p>
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="relative">
                  <Mail
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5a4a2a]"
                  />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email address"
                    required
                    className="w-full h-10 pl-9 pr-3 rounded-lg border border-[#2a2010] bg-[#1a1208] text-[13px] text-[#f5f0e8] placeholder:text-[#5a4a2a] focus:outline-none focus:border-[#c9922a44] transition-colors"
                  />
                </div>
                <div className="relative">
                  <Lock
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5a4a2a]"
                  />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    required
                    className="w-full h-10 pl-9 pr-9 rounded-lg border border-[#2a2010] bg-[#1a1208] text-[13px] text-[#f5f0e8] placeholder:text-[#5a4a2a] focus:outline-none focus:border-[#c9922a44] transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5a4a2a] hover:text-[#8a7a60] cursor-pointer"
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>

                {mode === "signin" && (
                  <div className="text-right">
                    <button
                      type="button"
                      className="font-sans text-[11px] text-[#c9922a] hover:text-[#e8b84b] transition-colors cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className={cn(
                    "w-full h-10 rounded-lg font-sans text-[13px] font-semibold transition-all cursor-pointer",
                    "bg-[#c9922a] text-[#0a0a0b] hover:bg-[#e8b84b]",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                  )}
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
          <p className="text-center mt-5 font-sans text-[11px] text-[#5a4a2a]">
            By continuing, you agree to Signalera&apos;s Terms of Service and
            Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { cn } from "@/lib/utils";
import { Mail, Lock, Eye, EyeOff, Check } from "lucide-react";

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
        window.location.href = "/dashboard";
      }
    } else {
      const { error: signUpError } =
        await supabase.auth.signUp({ email, password });
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
    <div className="min-h-screen flex">
      {/* ── Left panel: Brand + Features (55%) ── */}
      <div
        className="hidden lg:flex lg:w-[55%] relative flex-col justify-between p-12"
        style={{ backgroundColor: "#0d0d0d" }}
      >
        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <img
            src="/logo-icon.png"
            alt=""
            style={{ height: "36px", width: "auto", objectFit: "contain" }}
          />
          <span
            className="font-display text-[32px] font-bold leading-none"
            style={{ letterSpacing: "-0.02em" }}
          >
            <span style={{ color: "#ffffff" }}>Signal</span>
            <span style={{ color: "#F5A623" }}>era</span>
          </span>
        </div>

        {/* Center content */}
        <div className="relative z-10 max-w-lg">
          <h1
            className="font-display leading-[1.1] tracking-tight"
            style={{ fontSize: "44px", color: "#ffffff" }}
          >
            Institutional-grade
            <br />
            market intelligence.
          </h1>
          <p
            className="mt-5 leading-relaxed"
            style={{ fontSize: "16px", color: "#9ca3af", fontFamily: "var(--font-inter, Inter, sans-serif)" }}
          >
            Join analysts tracking signals that move markets.
          </p>

          <div className="mt-10 space-y-4">
            {features.map((text) => (
              <div key={text} className="flex items-center gap-3">
                <div
                  className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: "rgba(245, 166, 35, 0.15)" }}
                >
                  <Check size={12} style={{ color: "#F5A623" }} />
                </div>
                <span
                  style={{
                    fontSize: "15px",
                    color: "#d1d5db",
                    fontFamily: "var(--font-inter, Inter, sans-serif)",
                  }}
                >
                  {text}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom */}
        <div className="relative z-10">
          <p style={{ fontSize: "12px", color: "#4b5563" }}>
            Trusted by analysts at top-tier firms
          </p>
        </div>
      </div>

      {/* ── Right panel: Auth card (45%) ── */}
      <div
        className="flex-1 flex items-center justify-center px-6 py-12 lg:w-[45%]"
        style={{ backgroundColor: "#111111" }}
      >
        <div className="w-full max-w-[420px]">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center gap-2 mb-10">
            <img
              src="/logo-icon.png"
              alt=""
              style={{ height: "28px", width: "auto", objectFit: "contain" }}
            />
            <span
              className="font-display text-[24px] font-bold leading-none"
            >
              <span style={{ color: "#ffffff" }}>Signal</span>
              <span style={{ color: "#F5A623" }}>era</span>
            </span>
          </div>

          {/* Signup success */}
          {signupSuccess ? (
            <div
              className="rounded-2xl p-10 text-center"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(245,167,35,0.2)",
              }}
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: "rgba(245, 166, 35, 0.15)" }}
              >
                <Check size={24} style={{ color: "#F5A623" }} />
              </div>
              <p
                className="font-display"
                style={{ fontSize: "20px", color: "#ffffff" }}
              >
                Check your email
              </p>
              <p
                className="mt-3 leading-relaxed"
                style={{ fontSize: "14px", color: "#9ca3af" }}
              >
                Check your email to confirm your account.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSignupSuccess(false);
                  setMode("signin");
                }}
                className="mt-5 cursor-pointer transition-colors"
                style={{ fontSize: "13px", color: "#F5A623" }}
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <div
              className="rounded-2xl"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(245,167,35,0.2)",
                borderRadius: "16px",
                padding: "40px",
              }}
            >
              {/* Mode toggle */}
              <div
                className="flex items-center gap-1 rounded-lg p-0.5 mb-7"
                style={{
                  backgroundColor: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setMode("signin");
                    setError(null);
                  }}
                  className={cn(
                    "flex-1 py-2.5 rounded-md text-[13px] font-semibold transition-all cursor-pointer",
                  )}
                  style={{
                    fontFamily: "var(--font-inter, Inter, sans-serif)",
                    backgroundColor:
                      mode === "signin" ? "#F5A623" : "transparent",
                    color: mode === "signin" ? "#0d0d0d" : "#6b7280",
                  }}
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
                    "flex-1 py-2.5 rounded-md text-[13px] font-semibold transition-all cursor-pointer",
                  )}
                  style={{
                    fontFamily: "var(--font-inter, Inter, sans-serif)",
                    backgroundColor:
                      mode === "signup" ? "#F5A623" : "transparent",
                    color: mode === "signup" ? "#0d0d0d" : "#6b7280",
                  }}
                >
                  Create Account
                </button>
              </div>

              {/* Google SSO */}
              <button
                type="button"
                onClick={handleGoogleSSO}
                className="w-full flex items-center justify-center gap-2 h-11 rounded-lg transition-all cursor-pointer"
                style={{
                  border: "1px solid rgba(255,255,255,0.1)",
                  backgroundColor: "rgba(255,255,255,0.04)",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "#e5e7eb",
                  fontFamily: "var(--font-inter, Inter, sans-serif)",
                }}
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
                <div
                  className="flex-1 h-px"
                  style={{ backgroundColor: "rgba(255,255,255,0.08)" }}
                />
                <span
                  className="uppercase tracking-widest"
                  style={{
                    fontSize: "10px",
                    color: "#4b5563",
                    fontFamily: "var(--font-inter, Inter, sans-serif)",
                  }}
                >
                  or
                </span>
                <div
                  className="flex-1 h-px"
                  style={{ backgroundColor: "rgba(255,255,255,0.08)" }}
                />
              </div>

              {/* Error */}
              {error && (
                <div
                  className="mb-4 rounded-lg px-3 py-2.5"
                  style={{
                    backgroundColor: "rgba(220, 38, 38, 0.08)",
                    border: "1px solid rgba(220, 38, 38, 0.2)",
                  }}
                >
                  <p style={{ fontSize: "12px", color: "#ef4444" }}>{error}</p>
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="relative">
                  <Mail
                    size={15}
                    className="absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: "#4b5563" }}
                  />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email address"
                    required
                    className="w-full h-11 pl-10 pr-3 rounded-lg transition-colors focus:outline-none"
                    style={{
                      border: "1px solid rgba(255,255,255,0.1)",
                      backgroundColor: "rgba(255,255,255,0.04)",
                      fontSize: "13px",
                      color: "#f3f4f6",
                      fontFamily: "var(--font-inter, Inter, sans-serif)",
                    }}
                  />
                </div>
                <div className="relative">
                  <Lock
                    size={15}
                    className="absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: "#4b5563" }}
                  />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    required
                    className="w-full h-11 pl-10 pr-10 rounded-lg transition-colors focus:outline-none"
                    style={{
                      border: "1px solid rgba(255,255,255,0.1)",
                      backgroundColor: "rgba(255,255,255,0.04)",
                      fontSize: "13px",
                      color: "#f3f4f6",
                      fontFamily: "var(--font-inter, Inter, sans-serif)",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer transition-colors"
                    style={{ color: "#4b5563" }}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>

                {mode === "signin" && (
                  <div className="text-right">
                    <button
                      type="button"
                      className="cursor-pointer transition-colors"
                      style={{
                        fontSize: "12px",
                        color: "#F5A623",
                        fontFamily: "var(--font-inter, Inter, sans-serif)",
                      }}
                    >
                      Forgot password?
                    </button>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 rounded-lg font-semibold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    fontSize: "13px",
                    backgroundColor: "#F5A623",
                    color: "#0d0d0d",
                    fontFamily: "var(--font-inter, Inter, sans-serif)",
                  }}
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
          <p
            className="text-center mt-6"
            style={{
              fontSize: "11px",
              color: "#4b5563",
              fontFamily: "var(--font-inter, Inter, sans-serif)",
            }}
          >
            By continuing, you agree to Signalera&apos;s Terms of Service and
            Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}

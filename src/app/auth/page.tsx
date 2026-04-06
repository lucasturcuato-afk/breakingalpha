"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";

type AuthMode = "signin" | "signup";

export default function AuthPage() {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    // Will be wired to Supabase auth
    setTimeout(() => setLoading(false), 1500);
  }

  async function handleGoogleSSO() {
    // Will be wired to Supabase Google OAuth
  }

  return (
    <div className="min-h-screen bg-parchment flex items-center justify-center px-4">
      <div className="w-full max-w-[380px]">
        {/* Logo */}
        <div className="text-center mb-8">
          <img
            src="/logo.png"
            alt="Signalera"
            className="dark:brightness-110 dark:contrast-95"
            style={{ height: '64px', width: 'auto', objectFit: 'contain', margin: '0 auto', display: 'block' }}
          />
        </div>

        {/* Card */}
        <div className="bg-white border border-border-base rounded-2xl p-6">
          {/* Mode toggle */}
          <div className="flex items-center gap-1 bg-parchment-mid border border-border-base rounded-lg p-0.5 mb-6">
            <button
              type="button"
              onClick={() => setMode("signin")}
              className={cn(
                "flex-1 py-2 rounded-md font-sans text-[12px] font-semibold transition-all duration-[var(--duration-base)]",
                "cursor-pointer",
                mode === "signin"
                  ? "bg-espresso text-cream"
                  : "text-text-muted hover:text-text-primary",
              )}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={cn(
                "flex-1 py-2 rounded-md font-sans text-[12px] font-semibold transition-all duration-[var(--duration-base)]",
                "cursor-pointer",
                mode === "signup"
                  ? "bg-espresso text-cream"
                  : "text-text-muted hover:text-text-primary",
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
              "border border-border-base bg-parchment-mid",
              "font-sans text-[13px] font-medium text-text-primary",
              "hover:border-border-hover transition-colors",
              "cursor-pointer",
            )}
          >
            <svg width="16" height="16" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Continue with Google
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-border-base" />
            <span className="font-sans text-[10px] text-text-faint uppercase tracking-widest">or</span>
            <div className="flex-1 h-px bg-border-base" />
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint" />
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                required
                className="pl-9"
              />
            </div>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint" />
              <Input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
                className="pl-9 pr-9"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-faint hover:text-text-muted cursor-pointer"
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>

            {mode === "signin" && (
              <div className="text-right">
                <button
                  type="button"
                  className="font-sans text-[11px] text-gold hover:text-gold-dark transition-colors cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              disabled={loading}
            >
              {loading
                ? "Please wait..."
                : mode === "signin"
                  ? "Sign In"
                  : "Create Account"}
            </Button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center mt-5 font-sans text-[11px] text-text-faint">
          By continuing, you agree to Signalera&apos;s Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}

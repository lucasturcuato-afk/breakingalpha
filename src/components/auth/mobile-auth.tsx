"use client";

import { useEffect, useState } from "react";
import { POST_AUTH_DEFAULT, postAuthDestination } from "@/lib/auth-redirect";
import styles from "@/components/mobile/mobile.module.css";
import {
  CheckSeal,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_SANS,
  GoogleMark,
  Wordmark,
} from "@/components/mobile/primitives";

/* ══════════════════════════════════════════════════════════════════════
   Sign in, mobile. Prototype flag `isSignin`.
   ══════════════════════════════════════════════════════════════════════
   Built at 390px from Signalera Mobile v3.dc.html lines 1804 to 1886.
   Keeps no state and owns no Supabase call: every handler and every
   flag is the page's, so the two layouts cannot drift into two
   behaviours.

   Two states the design does not draw, both of which exist in the live
   page and are therefore built here rather than dropped:
     - in flight. The CTA takes the locked treatment and its label
       becomes "Please wait...".
     - failed. One shared block above the form carrying the message the
       server returned, which is how the desktop page already reports it.
   ══════════════════════════════════════════════════════════════════════ */

const FIELD = {
  position: "relative" as const,
  minHeight: 48,
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "0 14px",
  border: "1px solid var(--c-border)",
  borderRadius: 9,
  backgroundColor: "var(--c-surface)",
};

const FIELD_INPUT = {
  flex: 1,
  minWidth: 0,
  border: 0,
  outline: "none",
  background: "transparent",
  fontFamily: FONT_SANS,
  fontSize: 13,
  fontWeight: 400,
  lineHeight: 1,
  color: "var(--c-ink)",
};

function MonoLabel({ children }: { children: string }) {
  return (
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: 10,
        fontWeight: 400,
        lineHeight: 1,
        letterSpacing: "0.07em",
        color: "var(--c-muted)",
      }}
    >
      {children}
    </div>
  );
}

function OutcomePanel({
  eyebrow,
  seal,
  title,
  body,
  onBack,
}: {
  eyebrow?: string;
  seal?: boolean;
  title: string;
  body: string;
  onBack: () => void;
}) {
  return (
    <div
      className={styles.in}
      style={{
        padding: "30px 24px",
        border: "1px solid var(--c-border)",
        borderRadius: 14,
        backgroundColor: "var(--c-card)",
        textAlign: "center",
      }}
    >
      {seal && <CheckSeal />}
      {eyebrow && <MonoLabel>{eyebrow}</MonoLabel>}
      <p
        style={{
          margin: eyebrow ? "12px 0 0" : 0,
          fontFamily: FONT_DISPLAY,
          fontSize: 21,
          fontWeight: 700,
          lineHeight: 1.25,
          color: "var(--c-ink)",
        }}
      >
        {title}
      </p>
      <p
        style={{
          margin: "12px 0 0",
          fontFamily: FONT_SANS,
          fontSize: 13.5,
          fontWeight: 400,
          lineHeight: 1.6,
          color: "var(--c-secondary)",
          textWrap: "pretty",
        }}
      >
        {body}
      </p>
      <button
        type="button"
        onClick={onBack}
        className={styles.reset}
        style={{
          marginTop: 18,
          width: "100%",
          minHeight: 44,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FONT_SANS,
          fontSize: 13,
          fontWeight: 400,
          lineHeight: 1,
          color: "var(--c-goldink)",
        }}
      >
        Back to sign in
      </button>
    </div>
  );
}

export function MobileAuth({
  mode,
  onMode,
  email,
  onEmail,
  password,
  onPassword,
  showPassword,
  onTogglePassword,
  loading,
  error,
  forgotToast,
  onForgot,
  signupSuccess,
  onBackToSignin,
  onSubmit,
  onGoogle,
  features,
}: {
  mode: "signin" | "signup";
  onMode: (m: "signin" | "signup") => void;
  email: string;
  onEmail: (v: string) => void;
  password: string;
  onPassword: (v: string) => void;
  showPassword: boolean;
  onTogglePassword: () => void;
  loading: boolean;
  error: string | null;
  forgotToast: boolean;
  onForgot: () => void;
  signupSuccess: boolean;
  onBackToSignin: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onGoogle: () => void;
  features: string[];
}) {
  /* The adopt well states where signing in lands. The condition is
   * derivable rather than invented: postAuthDestination already computes
   * it from the live query, and it differs from the default exactly when
   * an ?adopt= or ?next= arrived. Read in an effect because the server
   * render has no query to read and a mismatch would hydrate wrong. */
  const [adoptFlow, setAdoptFlow] = useState(false);
  useEffect(() => {
    setAdoptFlow(postAuthDestination(window.location.search) !== POST_AUTH_DEFAULT);
  }, []);

  const tab = (on: boolean) => ({
    flex: 1,
    minHeight: 44,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    fontFamily: FONT_SANS,
    fontSize: 13,
    fontWeight: 600,
    lineHeight: 1,
    backgroundColor: on ? "var(--c-gold)" : "transparent",
    color: on ? "var(--c-ongold)" : "var(--c-secondary)",
  });

  return (
    <div className="md:hidden">
      <div
        data-parity="signin"
        className={`${styles.screen} ${styles.in}`}
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          padding:
            "8px var(--v3-pad) calc(20px + env(safe-area-inset-bottom, 0px))",
          backgroundColor: "var(--c-bg)",
        }}
      >
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "14px 0 22px",
          }}
        >
          <Wordmark size={24} stop={false} />
        </div>

        {signupSuccess ? (
          <OutcomePanel
            seal
            title="Check your email"
            body="Check your email to confirm your account."
            onBack={onBackToSignin}
          />
        ) : (
          <div className={styles.in}>
            {adoptFlow && (
              <div
                style={{
                  marginBottom: 16,
                  padding: "13px 14px",
                  border: "1px solid var(--c-border)",
                  borderRadius: 12,
                  backgroundColor: "var(--c-well)",
                }}
              >
                <MonoLabel>CONTINUING TO A CALL</MonoLabel>
                <p
                  style={{
                    margin: "8px 0 0",
                    fontFamily: FONT_SANS,
                    fontSize: 12.5,
                    fontWeight: 400,
                    lineHeight: 1.55,
                    color: "var(--c-body)",
                    textWrap: "pretty",
                  }}
                >
                  Signing in lands you on the call you followed in from, not on the
                  dashboard.
                </p>
              </div>
            )}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: 3,
                border: "1px solid var(--c-border)",
                borderRadius: 9,
                backgroundColor: "var(--c-surface)",
              }}
            >
              <button
                type="button"
                onClick={() => onMode("signin")}
                className={styles.reset}
                aria-pressed={mode === "signin"}
                style={tab(mode === "signin")}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => onMode("signup")}
                className={styles.reset}
                aria-pressed={mode === "signup"}
                style={tab(mode === "signup")}
              >
                Create Account
              </button>
            </div>

            <button
              type="button"
              onClick={onGoogle}
              className={styles.reset}
              style={{
                marginTop: 20,
                width: "100%",
                minHeight: 48,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 9,
                border: "1px solid var(--c-border)",
                borderRadius: 9,
                backgroundColor: "var(--c-surface)",
                fontFamily: FONT_SANS,
                fontSize: 13,
                fontWeight: 500,
                lineHeight: 1,
                color: "var(--c-ink)",
              }}
            >
              <GoogleMark />
              Continue with Google
            </button>

            <div
              style={{
                margin: "18px 0",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span style={{ flex: 1, height: 1, backgroundColor: "var(--c-border)" }} />
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  fontWeight: 400,
                  lineHeight: 1,
                  letterSpacing: "0.14em",
                  color: "var(--c-muted)",
                }}
              >
                OR
              </span>
              <span style={{ flex: 1, height: 1, backgroundColor: "var(--c-border)" }} />
            </div>

            {error && (
              <div
                role="alert"
                style={{
                  marginBottom: 12,
                  padding: "11px 13px",
                  border: "1px solid var(--c-red-edge)",
                  borderRadius: 12,
                  backgroundColor: "var(--c-red-well)",
                  fontFamily: FONT_SANS,
                  fontSize: 12.5,
                  fontWeight: 400,
                  lineHeight: 1.55,
                  color: "var(--c-redink)",
                }}
              >
                {error}
              </div>
            )}

            <form onSubmit={onSubmit}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={FIELD}>
                  <svg
                    style={{ flex: "none" }}
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--c-muted)"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path d="M3 7l9 6 9-6" />
                  </svg>
                  <span className="sr-only">Email address</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => onEmail(e.target.value)}
                    placeholder="Email address"
                    required
                    autoComplete="email"
                    className={styles.field}
                    style={FIELD_INPUT}
                  />
                </label>

                <div style={FIELD}>
                  <svg
                    style={{ flex: "none" }}
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--c-muted)"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <rect x="4" y="10" width="16" height="10" rx="2" />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                  </svg>
                  <label style={{ flex: 1, minWidth: 0, display: "flex" }}>
                    <span className="sr-only">Password</span>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => onPassword(e.target.value)}
                      placeholder="Password"
                      required
                      autoComplete={
                        mode === "signin" ? "current-password" : "new-password"
                      }
                      className={styles.field}
                      style={FIELD_INPUT}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={onTogglePassword}
                    className={styles.reset}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    style={{
                      flex: "none",
                      minWidth: 44,
                      minHeight: 44,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                    }}
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--c-muted)"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      {showPassword ? (
                        <path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.8 2.8M9.4 5.3A9.9 9.9 0 0 1 12 5c5 0 9 4.5 9 7a12 12 0 0 1-2.3 3.2M6.2 6.6C4 8.1 3 10.5 3 12c0 2.5 4 7 9 7a9.6 9.6 0 0 0 3.7-.7" />
                      ) : (
                        <>
                          <path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7z" />
                          <circle cx="12" cy="12" r="2.6" />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
              </div>

              {mode === "signin" && (
                <div
                  style={{
                    marginTop: 8,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                  }}
                >
                  <button
                    type="button"
                    onClick={onForgot}
                    className={styles.reset}
                    style={{
                      minHeight: 44,
                      display: "flex",
                      alignItems: "center",
                      fontFamily: FONT_SANS,
                      fontSize: 12,
                      fontWeight: 400,
                      lineHeight: 1,
                      color: "var(--c-goldink)",
                    }}
                  >
                    Forgot password?
                  </button>
                  {forgotToast && (
                    <p
                      role="status"
                      style={{
                        margin: "0 0 6px",
                        fontFamily: FONT_SANS,
                        fontSize: 11,
                        fontWeight: 400,
                        lineHeight: 1.4,
                        color: "var(--c-goldink)",
                      }}
                    >
                      Password reset coming soon.
                    </p>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className={styles.reset}
                style={{
                  marginTop: 10,
                  width: "100%",
                  minHeight: 48,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 9,
                  fontFamily: FONT_SANS,
                  fontSize: 13,
                  fontWeight: 600,
                  lineHeight: 1,
                  backgroundColor: loading ? "var(--c-locked-bg)" : "var(--c-gold)",
                  color: loading ? "var(--c-locked-ink)" : "var(--c-ongold)",
                  cursor: loading ? "default" : "pointer",
                }}
              >
                {loading
                  ? "Please wait..."
                  : mode === "signin"
                    ? "Sign In"
                    : "Create Account"}
              </button>
            </form>

            <p
              style={{
                margin: "18px 0 0",
                fontFamily: FONT_SANS,
                fontSize: 11,
                fontWeight: 400,
                lineHeight: 1.6,
                textAlign: "center",
                color: "var(--c-muted)",
                textWrap: "pretty",
              }}
            >
              By continuing, you agree to Signalera{"’"}s Terms of Service and Privacy
              Policy.
            </p>

            <div
              style={{
                marginTop: 24,
                paddingTop: 20,
                borderTop: "1px solid var(--c-border)",
                display: "flex",
                flexDirection: "column",
                gap: 11,
              }}
            >
              <MonoLabel>AI-NATIVE MARKET INTELLIGENCE</MonoLabel>
              {features.map((line) => (
                <div
                  key={line}
                  style={{ display: "flex", gap: 10, alignItems: "flex-start" }}
                >
                  <span
                    style={{
                      flex: "none",
                      marginTop: 4,
                      display: "inline-block",
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      backgroundColor: "var(--c-gold)",
                    }}
                  />
                  <span
                    style={{
                      fontFamily: FONT_SANS,
                      fontSize: 13,
                      fontWeight: 400,
                      lineHeight: 1.55,
                      color: "var(--c-secondary)",
                    }}
                  >
                    {line}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

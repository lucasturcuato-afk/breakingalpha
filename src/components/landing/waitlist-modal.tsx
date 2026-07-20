"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createBrowserClient } from "@supabase/ssr";
import { cn } from "@/lib/utils";
import { isAllowlisted } from "@/lib/allowlist";
import { postWaitlistRegister } from "@/lib/waitlist-register-client";
import { Mail, Lock, Eye, EyeOff, Check, X } from "lucide-react";
import styles from "./landing.module.css";

// Auth modal for the signed-out landing. It reuses the same Supabase client
// calls as /auth (Google OAuth + email/password). The beta gate is still
// enforced downstream in /auth/callback (OAuth + email-confirmation redirect)
// and in the proxy, but the email/password paths additionally call the shared
// register endpoint so a non-approved user gets a waitlist row + our email
// immediately, mirroring the /auth fallback page. It never admits anyone: the
// isAllowlisted check here only decides the redirect, matching /auth.
//
// It is styled entirely from landing.module.css so it reads as part of this
// landing: opaque panel on the landing card surface, a solid low-opacity scrim
// with no blur, serif heading, and the landing brass primary button. Motion is
// one orchestrated idea on a single ease-out curve; prefers-reduced-motion
// collapses to the final state via the module's global reduce block.

type AuthMode = "signin" | "signup";
type FieldErrors = { email?: string; password?: string; confirmPassword?: string };

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Route a Supabase auth error to the most relevant field so it renders inline
// under that field rather than in a browser alert.
function routeError(message: string): FieldErrors {
  return /password/i.test(message)
    ? { password: message }
    : { email: message };
}

export function WaitlistModal({
  open,
  onClose,
  initialMode = "signup",
}: {
  open: boolean;
  onClose: () => void;
  initialMode?: AuthMode;
}) {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [signupSuccess, setSignupSuccess] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const reducedRef = useRef(false);

  // Keep the latest onClose in a ref so the focus/scroll effect below does not
  // re-run (and thrash focus) when the parent passes a new inline callback.
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedRef.current = mq.matches;
    const on = () => {
      reducedRef.current = mq.matches;
    };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Reset to a clean form whenever the modal is (re)opened, honoring the
  // requested tab.
  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirmPassword(false);
    setLoading(false);
    setErrors({});
    setSignupSuccess(false);
  }, [open, initialMode]);

  // Mount immediately on open; keep mounted through the exit transition.
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // Drive the entrance/exit. Entrance flips to the shown state on the next
  // frame so the transition runs. Exit clears shown, then unmounts after the
  // (slightly faster) exit duration.
  useEffect(() => {
    if (!mounted) return;
    if (open) {
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const ms = reducedRef.current ? 0 : 200;
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [open, mounted]);

  // While mounted: lock body scroll, trap focus, move focus to the first
  // field, handle Escape, and restore focus to the trigger on close.
  useEffect(() => {
    if (!mounted) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const trigger = document.activeElement as HTMLElement | null;

    const raf = requestAnimationFrame(() => firstFieldRef.current?.focus());

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !panel.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
      trigger?.focus?.();
    };
  }, [mounted]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const next: FieldErrors = {};
      if (!EMAIL_RE.test(email.trim())) next.email = "Enter a valid email address.";
      if (!password) next.password = "Enter your password.";
      // Confirm password only exists on Create Account. Block the submit (no auth
      // call) when it does not match.
      if (mode === "signup" && password && confirmPassword !== password) {
        next.confirmPassword = "Passwords do not match.";
      }
      if (next.email || next.password || next.confirmPassword) {
        setErrors(next);
        return;
      }

      setErrors({});
      setLoading(true);
      const supabase = getSupabase();

      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) {
          setErrors(routeError(error.message));
          setLoading(false);
        } else {
          // Password sign-in mints a session without ever hitting the OAuth
          // callback gate. The approval DECISION comes from the authenticated
          // user's OWN read (RLS allowlist_read_self lets this session read its
          // own beta_allowlist row), NOT from the register endpoint body. If not
          // approved: register (fire the endpoint to ensure a waitlist row + our
          // email, idempotent, body ignored), sign out, and route to /waitlist.
          const approved = await isAllowlisted(supabase, email);
          if (!approved) {
            await postWaitlistRegister(email, "landing_signin");
            await supabase.auth.signOut();
            window.location.href = "/waitlist";
          } else {
            window.location.href = "/dashboard";
          }
        }
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) {
          setErrors(routeError(error.message));
          setLoading(false);
        } else {
          // Register so a non-approved signup gets a waitlist row + our email
          // regardless of whether Supabase ever delivers its confirmation link.
          // IGNORE the endpoint body (it never reveals approval) and ALWAYS show
          // "check your email". A non-approved user is routed to /waitlist later,
          // in /auth/callback, after they click the Supabase confirmation link.
          await postWaitlistRegister(email, "landing_signup");
          setSignupSuccess(true);
          setLoading(false);
        }
      }
    },
    [email, password, confirmPassword, mode],
  );

  const handleGoogle = useCallback(async () => {
    const supabase = getSupabase();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { access_type: "offline", prompt: "select_account" },
      },
    });
    if (error) setErrors(routeError(error.message));
  }, []);

  if (!mounted) return null;

  const isSignin = mode === "signin";
  const heading = isSignin ? "Welcome back." : "Join the waitlist.";
  const subline = isSignin
    ? "Access is invite-only during early access. If you are already in the beta, sign in below."
    : "We open access in small waves. Create an account and we will reach out when yours is ready.";
  const submitLabel = loading
    ? isSignin
      ? "Signing in..."
      : "Joining..."
    : isSignin
      ? "Sign in"
      : "Join the waitlist";

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setErrors({});
  };

  return (
    <div
      className={cn(styles.modalRoot, !open && styles.modalRootClosing)}
      role="dialog"
      aria-modal="true"
      aria-label={isSignin ? "Sign in" : "Join the waitlist"}
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={() => onCloseRef.current()}
        className={cn(styles.modalScrim, shown && styles.modalScrimIn)}
      />

      <div
        ref={panelRef}
        className={cn(styles.modalPanel, shown && styles.modalPanelIn)}
      >
        <button
          type="button"
          onClick={() => onCloseRef.current()}
          aria-label="Close"
          className={styles.modalClose}
        >
          <X size={16} />
        </button>

        <div className={styles.modalWordmark}>
          Signal<span className={styles.brassSpan}>era.</span>
        </div>

        {signupSuccess ? (
          <div className={styles.modalSuccess}>
            <div className={styles.modalSuccessBadge}>
              <Check size={22} />
            </div>
            <p className={styles.modalSuccessTitle}>Check your email.</p>
            <p className={styles.modalSuccessText}>
              Confirm your email to finish. We open access in small waves during
              early access.
            </p>
            <button
              type="button"
              onClick={() => {
                setSignupSuccess(false);
                switchMode("signin");
              }}
              className={styles.modalSuccessBack}
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <>
            <div className={styles.modalTabs}>
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className={cn(styles.modalTab, isSignin && styles.modalTabActive)}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => switchMode("signup")}
                className={cn(styles.modalTab, !isSignin && styles.modalTabActive)}
              >
                Create Account
              </button>
            </div>

            {/* keyed on mode so the fields crossfade on tab switch */}
            <div key={mode} className={styles.modalContent}>
              <h2 className={styles.modalHeading}>{heading}</h2>
              <p className={styles.modalSubline}>{subline}</p>

              <button
                type="button"
                onClick={handleGoogle}
                className={styles.modalGoogleBtn}
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

              <div className={styles.modalDivider}>
                <span className={styles.modalDividerRule} />
                <span className={styles.modalDividerText}>OR</span>
                <span className={styles.modalDividerRule} />
              </div>

              <form onSubmit={handleSubmit} className={styles.modalForm} noValidate>
                <div className={styles.modalField}>
                  <label className={styles.modalLabel} htmlFor="modal-email">
                    EMAIL
                  </label>
                  <div className={styles.modalInputWrap}>
                    <Mail size={15} className={styles.modalInputIcon} aria-hidden="true" />
                    <input
                      id="modal-email"
                      ref={firstFieldRef}
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (errors.email) setErrors((p) => ({ ...p, email: undefined }));
                      }}
                      placeholder="you@email.com"
                      autoComplete="email"
                      aria-invalid={errors.email ? true : undefined}
                      className={cn(styles.modalInput, errors.email && styles.modalInputErr)}
                    />
                  </div>
                  {errors.email && (
                    <span className={styles.modalFieldErr}>{errors.email}</span>
                  )}
                </div>

                <div className={styles.modalField}>
                  <label className={styles.modalLabel} htmlFor="modal-password">
                    PASSWORD
                  </label>
                  <div className={styles.modalInputWrap}>
                    <Lock size={15} className={styles.modalInputIcon} aria-hidden="true" />
                    <input
                      id="modal-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (errors.password) setErrors((p) => ({ ...p, password: undefined }));
                      }}
                      placeholder="Password"
                      autoComplete={isSignin ? "current-password" : "new-password"}
                      aria-invalid={errors.password ? true : undefined}
                      className={cn(styles.modalInput, errors.password && styles.modalInputErr)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className={styles.modalReveal}
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {errors.password && (
                    <span className={styles.modalFieldErr}>{errors.password}</span>
                  )}
                </div>

                {/* Confirm password: Create Account only, never on Sign In. Own
                    independent show/hide toggle. Renders between Password and the
                    submit button so tab order is Password, Confirm, submit. */}
                {!isSignin && (
                  <div className={styles.modalField}>
                    <label className={styles.modalLabel} htmlFor="modal-confirm-password">
                      CONFIRM PASSWORD
                    </label>
                    <div className={styles.modalInputWrap}>
                      <Lock size={15} className={styles.modalInputIcon} aria-hidden="true" />
                      <input
                        id="modal-confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => {
                          setConfirmPassword(e.target.value);
                          if (errors.confirmPassword)
                            setErrors((p) => ({ ...p, confirmPassword: undefined }));
                        }}
                        placeholder="Confirm password"
                        autoComplete="new-password"
                        aria-invalid={errors.confirmPassword ? true : undefined}
                        className={cn(
                          styles.modalInput,
                          errors.confirmPassword && styles.modalInputErr,
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((v) => !v)}
                        aria-label={
                          showConfirmPassword ? "Hide password" : "Show password"
                        }
                        className={styles.modalReveal}
                      >
                        {showConfirmPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                    {errors.confirmPassword && (
                      <span className={styles.modalFieldErr}>
                        {errors.confirmPassword}
                      </span>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className={styles.modalPrimaryBtn}
                >
                  {submitLabel}
                </button>
              </form>

              <p className={styles.modalFinePrint}>
                Private beta. Access opens in small waves. Informational only,
                never advice.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

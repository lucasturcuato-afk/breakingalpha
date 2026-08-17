"use client";

import { useEffect, useState } from "react";
import { MobileAuth } from "@/components/auth/mobile-auth";

type State = "form" | "adopt" | "loading" | "error" | "email";

/**
 * Fixture driver for the mobile sign-in screen. Nothing here authenticates
 * and nothing reaches Supabase: every flag is set directly.
 *
 * The three feature lines are repeated here rather than imported because
 * `src/lib/auth-copy.test.ts` asserts them against the raw text of
 * `src/app/auth/page.tsx`, and that file stays their home. If the two ever
 * disagree the test still guards the one that ships.
 */
const FEATURES = [
  "Falsifiable market calls, published before the outcome is known",
  "Every call scored against the close with benchmark attribution",
  "The misses stay on the record, next to the hits",
];

export function SigninMobileHarness() {
  const [state, setState] = useState<State>("form");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [forgotToast, setForgotToast] = useState(false);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("state");
    if (s === "adopt") {
      // The adopt well is derived from the live query, so the harness puts
      // a real adopt id there rather than forcing the flag.
      const u = new URL(window.location.href);
      if (!u.searchParams.has("adopt")) {
        u.searchParams.set("adopt", "CALL-0413");
        window.history.replaceState(null, "", u.toString());
      }
      setState("form");
      return;
    }
    if (s === "loading" || s === "error" || s === "email" || s === "form") setState(s);
  }, []);

  return (
    <MobileAuth
      mode={mode}
      onMode={setMode}
      email={email}
      onEmail={setEmail}
      password={password}
      onPassword={setPassword}
      showPassword={showPassword}
      onTogglePassword={() => setShowPassword((v) => !v)}
      loading={state === "loading"}
      error={
        state === "error"
          ? "Invalid login credentials"
          : null
      }
      forgotToast={forgotToast}
      onForgot={() => {
        setForgotToast(true);
        setTimeout(() => setForgotToast(false), 3000);
      }}
      signupSuccess={state === "email"}
      onBackToSignin={() => setState("form")}
      onSubmit={(e) => e.preventDefault()}
      onGoogle={() => {}}
      features={FEATURES}
    />
  );
}

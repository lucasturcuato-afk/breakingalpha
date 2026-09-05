import { redirect } from "next/navigation";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { readUserProfile, DEFAULT_PROFILE } from "@/lib/user-profile";
import { WatchNotice } from "@/components/watch/watch-notice";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export const dynamic = "force-dynamic";

/**
 * /onboarding — full-page 7-step setup flow on a dark split layout.
 *
 * Driven by proxy.ts: new users (onboarding_completed = false) are redirected
 * here from any gated route. Completed users are bounced to /dashboard. The
 * wizard component owns its own full-viewport chrome — no outer wrapper.
 */
export default async function OnboardingPage() {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) redirect("/auth");

  /* THE SECOND CALLER THAT MUST NOT DEFAULT, and the one that reads as a
   * redirect gate until you follow what the gate lets through.
   *
   * `getUserProfile` yielded `DEFAULT_PROFILE` on a failed read, and that
   * default carries `onboarding_completed: false`. So a failed read did not
   * just skip a redirect: it sent a reader who had ALREADY finished setup
   * into a blank seven-step wizard, and `handleFinish` at
   * `OnboardingWizard.tsx:572` PATCHes every field it holds plus
   * `onboarding_completed: true`. The blanks land on top of the real profile.
   * Identical damage to `/settings/profile`, reached by a different door.
   *
   * `missing` keeps its old behaviour, because for a genuinely new user a row
   * that is not there is the correct reason to run onboarding. */
  const profileRead = await readUserProfile(supabase, user.id);

  if (profileRead.state === "failed") {
    return (
      <main
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          backgroundColor: "var(--c-bg)",
        }}
      >
        <div style={{ width: "100%", maxWidth: "440px" }}>
          {/* Same block and same register as `/settings/preferences`. The
              wizard is not mounted, so there is no Finish control to press
              and nothing can be written from a read that did not happen. */}
          <WatchNotice
            heading="Could not load your profile."
            body="Setup cannot start until it loads. Continuing now would write an empty form over anything already there."
            action={{ href: "/onboarding", label: "Try again" }}
          />
        </div>
      </main>
    );
  }

  const profile =
    profileRead.state === "ok" ? profileRead.row : DEFAULT_PROFILE(user.id);
  if (profile.onboarding_completed) redirect("/dashboard");

  return (
    <OnboardingWizard
      initialProfile={{
        first_name: profile.first_name ?? "",
        role: profile.role,
        sectors: profile.sectors,
        risk_appetite: profile.risk_appetite,
        strategy_type: profile.strategy_type,
        investment_horizon: profile.investment_horizon,
        workflow_style: profile.workflow_style,
        firm_or_school: profile.firm_or_school ?? "",
        watchlist_tickers: profile.watchlist_tickers,
      }}
    />
  );
}

import { redirect } from "next/navigation";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { getUserProfile } from "@/lib/user-profile";
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

  const profile = await getUserProfile(supabase, user.id);
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

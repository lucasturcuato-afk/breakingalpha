import { redirect } from "next/navigation";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { getUserProfile } from "@/lib/user-profile";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export const dynamic = "force-dynamic";

/**
 * /onboarding — full-page 6-step setup flow.
 *
 * Driven by proxy.ts: new users (onboarding_completed = false) are redirected
 * here from any gated route. Completed users are bounced to /dashboard.
 */
export default async function OnboardingPage() {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) redirect("/auth");

  const profile = await getUserProfile(supabase, user.id);
  if (profile.onboarding_completed) redirect("/dashboard");

  return (
    <main className="min-h-screen bg-cream flex items-center justify-center px-4 py-12">
      <OnboardingWizard
        initialProfile={{
          full_name: profile.full_name ?? "",
          role: profile.role,
          sectors: profile.sectors,
          risk_appetite: profile.risk_appetite,
          firm: profile.firm ?? "",
          watchlist_tickers: profile.watchlist_tickers,
        }}
      />
    </main>
  );
}

import { redirect } from "next/navigation";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { getUserProfile, updateInferredWeights } from "@/lib/user-profile";
import { AppShell } from "@/components/shell";
import { ResetLearnedPrefsButton } from "@/components/settings/ResetLearnedPrefsButton";
import { BehavioralInsights } from "@/components/profile/BehavioralInsights";
import { PreferencesForm } from "@/components/settings/PreferencesForm";

export const dynamic = "force-dynamic";

export default async function PreferencesPage() {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) redirect("/auth");

  const profile = await getUserProfile(supabase, user.id);

  // Refresh inferred weights on every visit so the display reflects the last
  // 30 days of activity. If this fails (table missing), soft-fail to {}.
  const { weights, eventCount } = await updateInferredWeights(supabase, user.id).catch(
    () => ({ weights: profile.inferred_sector_weights, eventCount: 0 }),
  );

  const sortedWeights = Object.entries(weights).sort((a, b) => b[1] - a[1]);
  /* THE THIRD CALLER, and the one the mobile screen links straight at.
   *
   * It rendered "N events considered - last updated not yet computed" in one
   * sentence, from the same literal fallback the mobile screen used. Fixing the
   * mobile caller and leaving this one moves the contradiction one tap away:
   * the mobile Learned screen's own desktop half says "on a wider screen the
   * learned weights sit inside your preferences" and points here.
   *
   * Same reading as `/settings/learned`, and the same reasons, set out in full
   * there: the two `user_profiles` columns do not exist in production, both
   * answering Postgres `42703`, so a stored timestamp is the observable proof
   * that anything was kept, and null renders nothing rather than a phrase
   * standing in for a date. Making the refresh report its own write is a
   * shared-library change and is split into its own PR. */
  const storedAt = profile.inferred_weights_updated_at;
  /* `typeof === "string"`, not `!== null`, and the difference is the whole
     honesty of the screen. `stored` is false today only because
     `DEFAULT_PROFILE` happens to set this key to null at `user-profile.ts:109`
     and `getUserProfile` spreads `{...defaults, ...data}` over a `select("*")`
     row that simply lacks it. Drop that default and `storedAt` becomes
     `undefined`, `!== null` becomes true, and the ranking claim comes back
     silently on both surfaces. A positive test cannot fail that way. */
  const stored = typeof storedAt === "string";
  const updatedAt = storedAt ? new Date(storedAt).toLocaleString() : null;

  return (
    <AppShell pageTitle="Preferences">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <header className="mb-8">
          <p className="font-sans text-[11px] font-semibold text-text-muted mb-1">
            Settings
          </p>
          <h1 className="font-display text-[28px] font-extrabold text-espresso">
            Your preferences
          </h1>
          <p className="font-sans text-[13px] text-text-secondary mt-2">
            Manage every dimension of how Signalera personalizes your
            intelligence feed. Changes take effect immediately.
          </p>
        </header>

        {/* Editable sections 1–5 */}
        <PreferencesForm
          initialFirstName={profile.first_name ?? ""}
          initialFirmOrSchool={profile.firm_or_school ?? ""}
          initialRole={profile.role}
          initialStrategy={profile.strategy_type}
          initialSectors={profile.sectors}
          initialHorizon={profile.investment_horizon}
          initialWorkflow={profile.workflow_style}
          initialRisk={profile.risk_appetite}
          initialWatchlist={profile.watchlist_tickers}
          initialMarketCards={profile.market_cards ?? undefined}
        />

        {/* Divider */}
        <div className="border-t border-border-base my-8" />

        {/* SECTION 6 — What Signalera has learned (read-only) */}
        <section className="bg-parchment border border-border-base rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-display text-[16px] font-bold text-espresso">
              What Signalera has learned
            </h2>
            <ResetLearnedPrefsButton stored={stored} />
          </div>
          <p className="font-sans text-[12px] text-text-secondary mb-4">
            {/* "Higher = boosted in ranking" is gated on the weights actually
                being stored, for the reason set out on the mobile screen: the
                column does not exist in production, so nothing reads these and
                nothing is ordered by them. */}
            These are inferred from your activity and blend with your declared
            preferences above. 1.0 = neutral.
            {stored ? " Higher = boosted in ranking." : ""} {eventCount} events
            considered{updatedAt === null ? "." : <> &middot; last updated {updatedAt}.</>}
          </p>

          {stored ? null : (
            <p className="font-sans text-[11px] text-text-muted mb-4" role="status">
              These numbers were worked out from your recorded activity when this
              page loaded, and they were not saved. Signalera has nowhere to keep
              them yet, so nothing reads them and nothing is ordered by them.
            </p>
          )}

          {sortedWeights.length === 0 ? (
            <p className="font-sans text-[12px] text-text-muted italic">
              Not enough data yet — interact with a few theses and come back.
            </p>
          ) : (
            <ul className="space-y-2">
              {sortedWeights.map(([sector, weight]) => {
                const pct = Math.min(100, Math.max(0, ((weight - 0.3) / (2.5 - 0.3)) * 100));
                const boosted = weight > 1.05;
                const suppressed = weight < 0.95;
                return (
                  <li key={sector} className="flex items-center gap-3">
                    <div className="w-48 font-sans text-[12px] text-text-primary truncate">
                      {sector}
                    </div>
                    <div className="flex-1 h-2 rounded-full bg-parchment-mid relative overflow-hidden">
                      <div
                        className={
                          boosted
                            ? "absolute inset-y-0 left-0 bg-gold rounded-full"
                            : suppressed
                              ? "absolute inset-y-0 left-0 bg-signal-dn rounded-full"
                              : "absolute inset-y-0 left-0 bg-text-muted rounded-full"
                        }
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="w-12 font-data text-[11px] text-text-muted text-right">
                      {weight.toFixed(2)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Behavioral insights */}
        <div className="mb-6">
          <BehavioralInsights />
        </div>

        {/* Removed, same reason as the mobile screen: the recompute runs on a page
              visit rather than per reading session, and with no column to write to
              the result is discarded either way. */}
      </div>
    </AppShell>
  );
}

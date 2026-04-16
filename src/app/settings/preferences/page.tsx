import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { getUserProfile, updateInferredWeights } from "@/lib/user-profile";
import { AppShell } from "@/components/shell";
import { ResetLearnedPrefsButton } from "@/components/settings/ResetLearnedPrefsButton";
import { BehavioralInsights } from "@/components/profile/BehavioralInsights";

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
  const updatedAt = profile.inferred_weights_updated_at
    ? new Date(profile.inferred_weights_updated_at).toLocaleString()
    : "not yet computed";

  return (
    <AppShell pageTitle="Preferences">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <header className="mb-8">
          <p className="font-sans text-[11px] font-semibold uppercase tracking-wide text-gold-dark mb-1">
            Settings
          </p>
          <h1 className="font-display text-[28px] font-extrabold text-espresso">
            Your preferences
          </h1>
          <p className="font-sans text-[13px] text-text-secondary mt-2">
            Signalera learns from how you read and react to signals. Here&apos;s what it
            thinks about you right now.
          </p>
        </header>

        {/* Profile snapshot */}
        <section className="bg-parchment border border-border-base rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-[16px] font-bold text-espresso">
              Profile snapshot
            </h2>
            <Link
              href="/settings/profile"
              className="font-sans text-[11px] font-semibold text-gold hover:text-gold-dark"
            >
              Edit &rarr;
            </Link>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 font-sans text-[12px]">
            <div>
              <dt className="text-text-faint uppercase text-[10px] tracking-wide mb-0.5">
                Name
              </dt>
              <dd className="text-text-primary">
                {profile.full_name ?? <span className="text-text-muted italic">unset</span>}
              </dd>
            </div>
            <div>
              <dt className="text-text-faint uppercase text-[10px] tracking-wide mb-0.5">
                Role
              </dt>
              <dd className="text-text-primary">
                {profile.role ?? (
                  <span className="text-text-muted italic">unset</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-text-faint uppercase text-[10px] tracking-wide mb-0.5">
                Firm or school
              </dt>
              <dd className="text-text-primary">
                {profile.firm_or_school ?? <span className="text-text-muted italic">unset</span>}
              </dd>
            </div>
            <div>
              <dt className="text-text-faint uppercase text-[10px] tracking-wide mb-0.5">
                Risk appetite
              </dt>
              <dd className="text-text-primary capitalize">{profile.risk_appetite}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-text-faint uppercase text-[10px] tracking-wide mb-0.5">
                Focus sectors ({profile.sectors.length})
              </dt>
              <dd className="flex flex-wrap gap-1.5 mt-1">
                {profile.sectors.length === 0 ? (
                  <span className="text-text-muted italic">None selected</span>
                ) : (
                  profile.sectors.map((s) => (
                    <span
                      key={s}
                      className="px-2 py-0.5 rounded bg-gold-muted text-gold-dark font-sans text-[10px] font-semibold"
                    >
                      {s}
                    </span>
                  ))
                )}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-text-faint uppercase text-[10px] tracking-wide mb-0.5">
                Watchlist ({profile.watchlist_tickers.length})
              </dt>
              <dd className="flex flex-wrap gap-1.5 mt-1">
                {profile.watchlist_tickers.length === 0 ? (
                  <span className="text-text-muted italic">No tickers</span>
                ) : (
                  profile.watchlist_tickers.map((t) => (
                    <span
                      key={t}
                      className="px-2 py-0.5 rounded bg-parchment-mid border border-border-base font-data text-[10px] font-semibold text-text-primary"
                    >
                      {t}
                    </span>
                  ))
                )}
              </dd>
            </div>
          </dl>
        </section>

        {/* Inferred weights */}
        <section className="bg-parchment border border-border-base rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-display text-[16px] font-bold text-espresso">
              Learned sector interests
            </h2>
            <ResetLearnedPrefsButton />
          </div>
          <p className="font-sans text-[12px] text-text-secondary mb-4">
            Derived from the last 30 days of activity. 1.0 = neutral. Higher = boosted in
            ranking. {eventCount} events considered · last updated {updatedAt}.
          </p>

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

        {/* Behavioral insights — how Signalera is learning from activity */}
        <div className="mb-6">
          <BehavioralInsights />
        </div>

        <p className="font-sans text-[11px] text-text-muted text-center">
          Learned preferences update automatically after each reading session.
        </p>
      </div>
    </AppShell>
  );
}

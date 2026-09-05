import { redirect } from "next/navigation";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { readUserProfile, updateInferredWeights, DEFAULT_PROFILE } from "@/lib/user-profile";
import { WatchNotice } from "@/components/watch/watch-notice";
import { AppShell } from "@/components/shell";
import { ResetLearnedPrefsButton } from "@/components/settings/ResetLearnedPrefsButton";
import { BehavioralInsights } from "@/components/profile/BehavioralInsights";
import { PreferencesForm } from "@/components/settings/PreferencesForm";

export const dynamic = "force-dynamic";

export default async function PreferencesPage() {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) redirect("/auth");

  /* THIS CALLER MUST NOT DEFAULT, and it is one of only two that must not.
   *
   * Every field below seeds `PreferencesForm`, whose Save button PATCHes all
   * of them back at `PreferencesForm.tsx:142`. `getUserProfile` yields
   * `DEFAULT_PROFILE` on a failed read, so a reader whose profile did not load
   * saw an empty name, no role, no sectors and an empty watchlist rendered as
   * their stored values, and one press of Save wrote those blanks over what
   * was there. That is destruction, not a misreport, which is why this call
   * site takes the three-state read and the four indifferent ones do not. */
  const profileRead = await readUserProfile(supabase, user.id);

  if (profileRead.state === "failed") {
    /* THE FORM IS NOT DRAWN AT ALL, which is the point rather than a shortcut.
       The Save control lives inside `PreferencesForm`, so not mounting the
       form is what makes Save unavailable; there is no disabled button to
       mis-enable and no seeded field to press it over. Reuses `WatchNotice`,
       the block this repo already draws for every failed read, and its
       "Could not load your X." register. Retry is a real anchor, not a
       button with a push: this is a server component and a fresh navigation
       is exactly the retry. */
    return (
      <AppShell pageTitle="Preferences" mobileFullBleed>
        <div className="mx-auto max-w-none px-4 py-6 md:max-w-3xl md:px-6 md:py-10">
          <h1 className="font-display text-[22px] font-extrabold text-espresso md:text-[28px]">
            Your preferences
          </h1>
          <WatchNotice
            heading="Could not load your preferences."
            body="Nothing on this screen can be saved until they load. Saving now would write an empty form over what is already there."
            action={{ href: "/settings/preferences", label: "Try again" }}
          />
        </div>
      </AppShell>
    );
  }

  /* A missing row is a genuinely different answer and keeps its old
     behaviour: a reader with no profile row yet gets an empty form to fill
     in, and Save creates the row. Only `failed` blocks. */
  const profile =
    profileRead.state === "ok" ? profileRead.row : DEFAULT_PROFILE(user.id);

  /* Refresh inferred weights on every visit so the display reflects the last
     30 days of activity. `failed` is carried, not swallowed: this page renders
     "Not enough data yet" on an empty weight map, and that sentence must not
     stand for a read that did not happen. Same flag, same reason, as
     `/settings/learned`. */
  const { weights, eventCount, failed: refreshFailed } = await updateInferredWeights(
    supabase,
    user.id,
  ).catch(() => ({
    weights: profile.inferred_sector_weights,
    eventCount: 0,
    failed: true,
  }));

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
     `DEFAULT_PROFILE` happens to set this key to null at `user-profile.ts:119`
     and `getUserProfile` spreads `{...defaults, ...data}` over a `select("*")`
     row that simply lacks it. Drop that default and `storedAt` becomes
     `undefined`, `!== null` becomes true, and the ranking claim comes back
     silently on both surfaces. A positive test cannot fail that way. */
  const stored = typeof storedAt === "string";
  const updatedAt = storedAt ? new Date(storedAt).toLocaleString() : null;

  return (
    /* `mobileFullBleed` gates the desk's mood bar, topbar and footer out below
       `md` and leaves the tab bar mounted, which is most of this port.
       Measured on this route at 390 before it was set: `#main-content` had a
       634px window onto 3297px of content, the footer was drawn inside that
       window, and its last line ran under a tab bar whose top edge is 785 on an
       844 viewport. The flag is the same one `/settings/profile`, `/ledger`,
       `/saved` and twenty other screens already set; desktop is untouched at
       every width. */
    <AppShell pageTitle="Preferences" mobileFullBleed>
      {/* THE WRAPPER'S PADDING IS DESK PADDING, so it is gated in classes with
          the rest of the desk layout rather than removed. At `md` and above
          every one of these resolves to exactly what it was: max-w-3xl,
          mx-auto, px-6, py-10. Below `md` the wrapper generates a plain block
          and the mobile screen inside `PreferencesForm` draws full bleed, with
          its own `var(--v3-pad)` gutter. */}
      <div className="mx-auto max-w-none px-0 py-0 md:max-w-3xl md:px-6 md:py-10">
        <header className="mb-8 hidden md:block">
          <p className="font-sans text-[11px] font-semibold text-text-muted mb-1">
            Settings
          </p>
          <h1 className="font-display text-[28px] font-extrabold text-espresso">
            Your preferences
          </h1>
          {/* "Changes take effect immediately." dropped. `PreferencesForm`
              carries an explicit "Save preferences" button wired to a PATCH at
              `PreferencesForm.tsx:142`, so nothing takes effect until it is
              pressed. Identical defect to "Changes save instantly" on
              /settings/profile, which was corrected on both halves.

              The first sentence STAYS, unlike on the mobile Learned route where
              the whole deck went. That route's only control was Reset, so
              "manage every dimension" was false there; this page really does
              carry the form. Only the false clause goes. */}
          <p className="font-sans text-[13px] text-text-secondary mt-2">
            Manage every dimension of how Signalera personalizes your
            intelligence feed.
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

        {/* The read-only half of the page is DESK ONLY, and that is a
            deliberate deletion rather than an omission.

            `/settings/learned` already exists as a full mobile screen. It
            renders these same weights, and it carries the honest reading of
            whether anything is stored at all, which this section only
            half-carries. Drawing them a second time here would put one truth
            in two renderings, and the two would disagree the first time either
            moved. The mobile screen links at that route by the same label and
            the same sub the hub already uses. */}
        <div className="hidden md:block">
        {/* Divider */}
        <div className="border-t border-border-base my-8" />

        {/* SECTION 6. What Signalera has learned (read-only) */}
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
            {stored ? " Higher = boosted in ranking." : ""}
            {refreshFailed ? null : (
              <>
                {" "}
                {eventCount} events considered
                {updatedAt === null ? "." : <> &middot; last updated {updatedAt}.</>}
              </>
            )}
          </p>

          {stored ? null : (
            <p className="font-sans text-[11px] text-text-muted mb-4" role="status">
              These numbers were worked out from your recorded activity when this
              page loaded, and they were not saved. Signalera has nowhere to keep
              them yet, so nothing reads them and nothing is ordered by them.
            </p>
          )}

          {refreshFailed ? (
            /* Word for word the sentence `/settings/learned` already draws for
               this state, at `mobile-learned-screen.tsx:164`. One register,
               one claim, and the two surfaces cannot disagree about it. */
            <p className="font-sans text-[12px] text-text-muted" role="status">
              These weights could not be worked out just now, so the numbers
              above are incomplete. Nothing was changed.
            </p>
          ) : sortedWeights.length === 0 ? (
            <p className="font-sans text-[12px] text-text-muted italic">
              Not enough data yet. Interact with a few theses and come back.
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
        </div>

        {/* Removed, same reason as the mobile screen: the recompute runs on a page
              visit rather than per reading session, and with no column to write to
              the result is discarded either way. */}
      </div>
    </AppShell>
  );
}

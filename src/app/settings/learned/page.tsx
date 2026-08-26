import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { getUserProfile, updateInferredWeights } from "@/lib/user-profile";
import { MobileLearnedScreen } from "@/components/settings/mobile-learned-screen";
import { FONT_DISPLAY, FONT_SANS } from "@/components/mobile/fonts";

/**
 * What Signalera has learned. A new route: the content exists today only as
 * two sections inside `/settings/preferences`, and nothing renders it on its
 * own. The mobile design reaches it through the Settings row of the same name.
 *
 * The data path is `/settings/preferences`' own, with one change. That page
 * catches a failed weight refresh and falls back with `eventCount: 0`, which
 * renders identically to a genuine zero. The failure is carried through here
 * instead, so the screen can say the numbers are stale rather than imply the
 * user has done nothing.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "What Signalera has learned",
};

export default async function LearnedPage() {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) redirect("/auth");

  const profile = await getUserProfile(supabase, user.id);

  const refreshed = await updateInferredWeights(supabase, user.id).then(
    (r) => ({ ...r, failed: false }),
    () => ({ weights: profile.inferred_sector_weights, eventCount: 0, failed: true }),
  );
  const { weights, eventCount, failed: refreshFailed } = refreshed;

  const sorted = Object.entries(weights)
    .sort((a, b) => b[1] - a[1])
    .map(([sector, weight]) => ({ sector, weight }));

  /* WHETHER THESE WEIGHTS ARE STORED AT ALL, which is the question the screen
   * has to answer before it says anything about them.
   *
   * `user_profiles.inferred_sector_weights` and
   * `user_profiles.inferred_weights_updated_at` DO NOT EXIST in production.
   * Verified read-only against the production REST API: both answer HTTP 400
   * with Postgres `42703`, "column does not exist". `updateInferredWeights`
   * computes the numbers from real `user_events` rows and then writes them
   * nowhere, and its warn deliberately swallows exactly that error, so nothing
   * downstream could tell. Every consumer reads the column defensively
   * (`deal-utils.ts:20`, `theses/route.ts:97`) and therefore always sees an
   * empty object, which means the weights order nothing anywhere.
   *
   * The columns are missing on main too. This is not this branch's doing and
   * the migration is a human decision, so the screen's job is to be honest
   * about it rather than to hide it.
   *
   * A stored timestamp is the observable proof that the store exists and took
   * a write. Absent, nothing was kept. This deliberately reads the PRE-refresh
   * snapshot: making the refresh report its own write is a shared-library
   * change and it is split into its own PR, so the reading here is one visit
   * behind. That errs toward saying "not saved" when a write has just landed,
   * which understates rather than overstates, and it self-corrects on the next
   * visit. Today the value is null on every visit for everyone. */
  const storedAt = profile.inferred_weights_updated_at;
  /* `typeof === "string"`, not `!== null`, and the difference is the whole
     honesty of the screen. `stored` is false today only because
     `DEFAULT_PROFILE` happens to set this key to null at `user-profile.ts:109`
     and `getUserProfile` spreads `{...defaults, ...data}` over a `select("*")`
     row that simply lacks it. Drop that default and `storedAt` becomes
     `undefined`, `!== null` becomes true, and the ranking claim comes back
     silently on both surfaces. A positive test cannot fail that way. */
  const stored = typeof storedAt === "string";

  /* Null renders NOTHING. This used to fall back to the literal string
   * "not yet computed", which is what produced
   * "N events considered - last updated not yet computed" in one sentence. */
  const updatedAt = storedAt ? new Date(storedAt).toLocaleString() : null;

  return (
    <>
      <div className="md:hidden">
        <MobileLearnedScreen
          weights={sorted}
          eventCount={eventCount}
          updatedAt={updatedAt}
          refreshFailed={refreshFailed}
          stored={stored}
        />
      </div>

      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: `500 17px/1.4 ${FONT_DISPLAY}`, color: "var(--c-ink)" }}>
          This is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: `400 13px/1.6 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
          On a wider screen the learned weights sit inside{" "}
          <Link href="/settings/preferences" style={{
              boxSizing: "content-box",
              display: "inline-flex",
              alignItems: "center",
              minHeight: "20px",
              padding: "12px 0",
              margin: "-12px 0",
              color: "var(--c-goldink)",
            }}>
            your preferences
          </Link>
          .
        </p>
      </div>
    </>
  );
}

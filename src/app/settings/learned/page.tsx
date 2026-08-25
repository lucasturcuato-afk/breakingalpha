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
    () => ({
      weights: profile.inferred_sector_weights,
      eventCount: 0,
      updatedAt: profile.inferred_weights_updated_at,
      failed: true,
    }),
  );
  const { weights, eventCount, failed: refreshFailed } = refreshed;

  const sorted = Object.entries(weights)
    .sort((a, b) => b[1] - a[1])
    .map(([sector, weight]) => ({ sector, weight }));

  /* ORDERING, and this is a fix.
   *
   * This used to read `profile.inferred_weights_updated_at` off the snapshot
   * taken above, which is read BEFORE `updateInferredWeights` runs and writes
   * that same column. So the screen counted the events it had just computed
   * and then reported a timestamp from the visit before, or, on a first visit,
   * no timestamp at all. Signed in on a fresh account it rendered
   * "12 events considered - last updated not yet computed" in one sentence.
   *
   * The refresh now hands back the timestamp it wrote. On the failure branch
   * the stored value is used instead, which is the right value there: nothing
   * new was written, so the last successful computation is what the reader
   * should see. Either way it can be null, and null renders nothing rather
   * than a phrase standing in for a date. */
  const updatedAt = refreshed.updatedAt
    ? new Date(refreshed.updatedAt).toLocaleString()
    : null;

  return (
    <>
      <div className="md:hidden">
        <MobileLearnedScreen
          weights={sorted}
          eventCount={eventCount}
          updatedAt={updatedAt}
          refreshFailed={refreshFailed}
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

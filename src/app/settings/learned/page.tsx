import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { getUserProfile, updateInferredWeights } from "@/lib/user-profile";
import { MobileLearnedScreen } from "@/components/settings/mobile-learned-screen";

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

  const updatedAt = profile.inferred_weights_updated_at
    ? new Date(profile.inferred_weights_updated_at).toLocaleString()
    : "not yet computed";

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
        <p style={{ margin: 0, font: "500 17px/1.4 'Playfair Display', serif", color: "var(--c-ink)" }}>
          This is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: "400 13px/1.6 Inter, sans-serif", color: "var(--c-secondary)" }}>
          On a wider screen the learned weights sit inside{" "}
          <Link href="/settings/preferences" style={{ color: "var(--c-goldink)" }}>
            your preferences
          </Link>
          .
        </p>
      </div>
    </>
  );
}

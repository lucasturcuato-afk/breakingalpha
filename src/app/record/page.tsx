import { AppShell } from "@/components/shell";
import {
  RecordScreen,
  RECORD_EMPTY_FIXTURE,
  RECORD_UNRESOLVED_FIXTURE,
  RECORD_FIXTURE,
  RECORD_UNAVAILABLE,
  type RecordStage,
} from "@/components/prepared-record";

/**
 * The Prepared record, the user's own. Server component so it can read the
 * lifecycle switch off the async searchParams, matching /ledger and /waitlist.
 *
 * PROVENANCE, and this is the finding batch-2 item 7 asked for. github.md maps
 * this screen to `src/components/record/DeskRecordView.tsx`. That mapping is
 * wrong, and it is wrong about the OBJECT rather than about the layout: this is
 * the user's record of the user's own claims, and DeskRecordView is Signalera's
 * record of Signalera's calls. The correct model is `src/lib/your-record.ts`,
 * which is why no part of this screen imports desk-record. Reasoning in the PR.
 *
 * ?stage= renders a lifecycle state directly. The screen has no data source in
 * this unit, so the states cannot be reached by reproducing their conditions,
 * and the runtime audit has to be able to reach each one.
 *
 * The shell is mounted per page, the way every other route here mounts it.
 * `mobileFullBleed` drops the desk's mood bar, topbar and footer below md,
 * because this screen opens on its own back bar and its own masthead. The tab
 * bar stays: /record is already in the Ledger pole's `owns` list, so the pole
 * lights the moment this route exists and mobile-tab-bar.tsx is untouched.
 */

const STAGES: RecordStage[] = ["ready", "loading", "error", "empty", "unresolved", "stale"];

/**
 * The fixture may not reach production. Delete this line and its two uses when
 * a loader lands.
 *
 * /record is a new route, but it is not an anonymous one: the proxy gates it
 * behind auth outside local dev, so the person who reaches it in production is
 * a real signed-in user and this screen is a record of THEIR calls under THEIR
 * name. An ungated fixture would show them forty-one calls they never made,
 * signed by somebody else. That is a product defect rather than a visual one,
 * and it does not announce itself. Fails closed: anything that is not
 * development or a preview deployment gets the unavailable read.
 */
const FIXTURE_ALLOWED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";

export default async function RecordPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.stage) ? params.stage[0] : params.stage;
  const requested = STAGES.includes(raw as RecordStage) ? (raw as RecordStage) : "ready";
  const stage = FIXTURE_ALLOWED ? requested : "error";

  const data = !FIXTURE_ALLOWED
    ? RECORD_UNAVAILABLE
    : stage === "empty"
      ? RECORD_EMPTY_FIXTURE
      : stage === "unresolved"
        ? RECORD_UNRESOLVED_FIXTURE
        : RECORD_FIXTURE;

  return (
    <AppShell pageTitle="Prepared record" mobileFullBleed>
      {/* Gated on the same breakpoint the shell uses to swap the sidebar for
          the tab bar. Gating lives in classes, never in an inline style: an
          inline display beats the class at every breakpoint. */}
      <div className="md:hidden">
        <RecordScreen stage={stage} data={data} />
      </div>

      {/* Above the breakpoint this route has no layout of its own. The desk
          already renders a record surface and it is not being rebuilt here. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: "500 17px/1.4 'Playfair Display', serif", color: "var(--c-ink)" }}>
          The prepared record is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: "400 13px/1.6 Inter, sans-serif", color: "var(--c-secondary)" }}>
          On a wider screen your calls live under Radar, beside the desk&rsquo;s own record.
        </p>
      </div>
    </AppShell>
  );
}

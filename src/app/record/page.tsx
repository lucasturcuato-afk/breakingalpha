import { AppShell } from "@/components/shell";
import { RecordScreen, RECORD_UNAVAILABLE, type RecordStage } from "@/components/prepared-record";
/* Imported by path, never through the barrel. The barrel is reachable from the
   client graph through `record-screen`, so pulling the sample entries through
   it would put the invented claims back in the browser bundle. This page is a
   server component, so from here they stay on the server. */
import { RECORD_FIXTURE_ENABLED } from "@/components/prepared-record/fixture-gate";
import {
  RECORD_EMPTY_FIXTURE,
  RECORD_FIXTURE,
  RECORD_UNRESOLVED_FIXTURE,
} from "@/components/prepared-record/fixture";
import { FONT_DISPLAY, FONT_SANS } from "@/components/mobile/fonts";

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

const STAGES: RecordStage[] = [
  "ready",
  "loading",
  "error",
  "empty",
  "unresolved",
  "stale",
  /* Listed so the state production actually draws can be reached, audited and
     captured in development like every other one. */
  "unavailable",
];

export default async function RecordPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.stage) ? params.stage[0] : params.stage;
  const requested = STAGES.includes(raw as RecordStage) ? (raw as RecordStage) : "ready";
  /* Not "error". In production nothing was read and nothing failed: the
     fixture is withheld by the gate, so there is nothing to run. Borrowing the
     failed-read copy for that case was a fallback asserting a fact it cannot
     know, which is the exact shape of untruth the gate exists to prevent.
     `unavailable` is the third state, the one /ask built for the same
     situation. `RecordScreen` resolves the same gate itself, so this is the
     honest choice of fixture rather than the only guard on this. */
  const stage = RECORD_FIXTURE_ENABLED ? requested : "unavailable";

  const data = !RECORD_FIXTURE_ENABLED || stage === "unavailable"
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
        <p style={{ margin: 0, font: `500 17px/1.4 ${FONT_DISPLAY}`, color: "var(--c-ink)" }}>
          The prepared record is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: `400 13px/1.6 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
          On a wider screen your calls live under Radar, beside the desk&rsquo;s own record.
        </p>
      </div>
    </AppShell>
  );
}

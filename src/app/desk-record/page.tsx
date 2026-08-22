import { AppShell } from "@/components/shell";
import { DeskRecordScreen, type DeskStage } from "@/components/desk-record";

/**
 * Desk record, at its own top-level route.
 *
 * NOT an edit to `src/app/radar/desk-record/page.tsx`. That route still exists,
 * still loads the live record through `fetchDeskRecord`, and is untouched. The
 * design dismantles Radar, so the mobile surface lands here and composes the
 * shared components instead of growing a mobile branch inside a Radar page.
 *
 * This screen is in no pole's `owns` list in `mobile-tab-bar.tsx`, so it lights
 * no tab. That is the standing decision from PR #619, which left Desk record and
 * Thesis Tracker unassigned because where they sit is still open (batch-2 Q3,
 * batch-3 Q5). It carries its own back control to the Ledger, which is what the
 * prototype draws: `showNav` lists only dash, ledger, watch and ask.
 *
 * NOTHING LINKS HERE YET. The intended entry point is the Ledger's second tail
 * action, "The desk grades itself too", but `TailAction` in `ledger-screen.tsx`
 * takes no href and no handler, so it is an inert button today. Until that is
 * wired, this route is reachable only by typing it, which is enough for the
 * parity run and the state audit and is not enough to ship to a reader.
 *
 * Server component so it can read the lifecycle switch off the async
 * searchParams, matching /ledger and /waitlist. There is no loader in this unit,
 * so the states cannot be reached by reproducing their conditions and the
 * runtime audit has to be able to reach each one.
 */

const STAGES: DeskStage[] = ["ready", "loading", "error", "empty", "stale"];

export default async function DeskRecordMobilePage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.stage) ? params.stage[0] : params.stage;
  const stage = STAGES.includes(raw as DeskStage) ? (raw as DeskStage) : "ready";

  return (
    <AppShell pageTitle="Desk record" mobileFullBleed>
      {/* Gated on the same breakpoint the shell uses to swap the sidebar for
          the tab bar, and gated in a CLASS: an inline display beats the class
          at every breakpoint, which is the defect design-lint rule 10 exists
          to catch. */}
      <div className="md:hidden">
        <DeskRecordScreen stage={stage} />
      </div>

      {/* Above the breakpoint the desktop equivalent already exists at
          /radar/desk-record and is not being rebuilt here. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: "500 17px/1.4 'Playfair Display', serif", color: "var(--c-ink)" }}>
          The Desk record is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: "400 13px/1.6 Inter, sans-serif", color: "var(--c-secondary)" }}>
          On a wider screen the desk keeps its own graded record on Radar.
        </p>
      </div>
    </AppShell>
  );
}

import { AppShell } from "@/components/shell";
import { LedgerScreen, type BriefStage } from "@/components/ledger";

/**
 * The Ledger. Server component so it can read the lifecycle switch off the
 * async searchParams, matching the pattern already used at /waitlist.
 *
 * ?stage= renders a lifecycle state directly. The screen has no data source in
 * this unit, so the states cannot be reached by reproducing their conditions,
 * and the runtime audit has to be able to reach each one.
 *
 * The shell is mounted the way every other page in this repo mounts it, per
 * page rather than by a layout. Without it the Ledger pole navigates to a
 * screen with no tab bar on it and no way back, and the prototype shows the bar
 * here: `showNav` lists `ledger` among its four. `mobileFullBleed` gates the
 * desk chrome the screen replaces rather than skipping the shell to avoid it.
 */

const STAGES: BriefStage[] = ["ready", "loading", "error", "none", "stale"];

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string | string[]; wrap?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.stage) ? params.stage[0] : params.stage;
  const stage = STAGES.includes(raw as BriefStage) ? (raw as BriefStage) : "ready";

  // The wrap slot on the date rule is driven by the artifact existing, never
  // by a clock. ?wrap= stands in for that artifact until a loader supplies it.
  const wrapRaw = Array.isArray(params.wrap) ? params.wrap[0] : params.wrap;

  return (
    <AppShell pageTitle="Ledger" mobileFullBleed>
      {/* The mobile layout is gated on the same breakpoint the shell uses to
          swap the sidebar for the tab bar. Gating lives in classes, never in an
          inline style: an inline display beats the class at every breakpoint,
          which is the defect that shipped the tab bar to desktop once already. */}
      <div className="md:hidden">
        <LedgerScreen stage={stage} wrapPublishedAt={wrapRaw ?? null} />
      </div>

      {/* Above the breakpoint this route has no layout of its own. The desktop
          equivalents already exist and are not being rebuilt here. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: "500 17px/1.4 'Playfair Display', serif", color: "var(--c-ink)" }}>
          The Ledger is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: "400 13px/1.6 Inter, sans-serif", color: "var(--c-secondary)" }}>
          On a wider screen the desk splits it across the Morning Brief and your calls.
        </p>
      </div>
    </AppShell>
  );
}

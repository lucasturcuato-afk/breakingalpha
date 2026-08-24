import { AppShell } from "@/components/shell";
import { ClaimScreen, CLAIM_FIXTURE, type ClaimStage } from "@/components/claim";

/**
 * A claim, opened out of the Ledger. Server component so it can read the
 * lifecycle switch off the async searchParams, matching /ledger and /waitlist.
 *
 * The route is new: nothing under `src/app/` renders a single call full
 * screen. `src/app/radar/calls/page.tsx` is the nearest thing and is a LIST.
 * `src/proxy.ts` already opens `/claim` and its children in local dev, and
 * `mobile-tab-bar.tsx` already lists `/claim` under the Ledger pole, so
 * neither file is touched here.
 *
 * NO DATA LOADER. `[id]` is read, echoed into the fixture's id and otherwise
 * unused: this unit renders from `CLAIM_FIXTURE` and wires no fetch. The
 * fixture's own header records which of its fields have a column behind them
 * and which three do not.
 *
 * BECAUSE THERE IS NO LOADER, PRODUCTION DRAWS `unwired`. This route requires
 * a session in production, so an ungated fixture would put a fabricated Cash
 * App call and a fabricated desk reading in front of a real reader, under a
 * counter claiming it is the second of five calls in their brief. The gate is
 * `CLAIM_FIXTURE_ENABLED` and it is enforced inside `ClaimScreen` rather than
 * here, so it cannot be forgotten at a second call site the day one exists.
 * The stage below is a request, not a decision.
 *
 * ?stage= renders a lifecycle state directly, for the same reason the Ledger
 * takes one: with no data source the states cannot be reached by reproducing
 * their conditions, and the runtime audit has to be able to reach each one.
 *
 * The shell is mounted per page, the way every other page in this repo mounts
 * it. `mobileFullBleed` gates the desk's mood bar, topbar and footer, which
 * are chrome stacked on a screen that already draws its own head.
 *
 * ONE DIVERGENCE FROM THE PROTOTYPE, stated rather than hidden: the design's
 * `showNav` lists four screens and `claim` is not among them, so the design
 * draws this screen with no tab bar. The foundation decided otherwise by
 * putting `/claim` in the Ledger pole's `owns` list, and that file is not this
 * unit's to edit. The bar renders and lights Ledger.
 */

const STAGES: ClaimStage[] = [
  "ready",
  "loading",
  "error",
  "missing",
  "stale",
  "ungradeable",
  "unwired",
];

export default async function ClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stage?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const raw = Array.isArray(query.stage) ? query.stage[0] : query.stage;
  const stage = STAGES.includes(raw as ClaimStage) ? (raw as ClaimStage) : "ready";

  return (
    <AppShell pageTitle="Claim" mobileFullBleed>
      {/* The mobile layout is gated on the same breakpoint the shell uses to
          swap the sidebar for the tab bar. Gating lives in classes, never in an
          inline style: an inline display beats the class at every breakpoint. */}
      <div className="md:hidden">
        <ClaimScreen stage={stage} data={{ ...CLAIM_FIXTURE, id }} />
      </div>

      {/* Above the breakpoint this route has no layout of its own. The desk
          reads a call inside the brief it came from, and that surface already
          exists. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: "500 17px/1.4 'Playfair Display', serif", color: "var(--c-ink)" }}>
          A claim is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: "400 13px/1.6 Inter, sans-serif", color: "var(--c-secondary)" }}>
          On a wider screen the desk reads a call inside the brief it was written in.
        </p>
      </div>
    </AppShell>
  );
}

import { AppShell } from "@/components/shell";
import {
  EntryScreen,
  ENTRY_STAGES,
  entryFixture,
  entryFixtureForState,
  type EntryStage,
} from "@/components/entry";
import { OUTCOME_STATES, type OutcomeState } from "@/components/ledger";

/**
 * One entry on the record, opened from a Ledger row.
 *
 * Server component so it can read the switches off the async searchParams, the
 * pattern /ledger already set. The route param is the entry id and never
 * appears in copy: user_claims has only a uuid, and a uuid slice on screen
 * would be a fabricated identifier.
 *
 * ?stage= renders a lifecycle state and ?state= renders an outcome. The screen
 * has no loader in this unit, so neither can be reached by reproducing its
 * conditions, and the runtime audit has to be able to reach all of them.
 *
 * The shell is mounted per page, as every other page in this repo mounts it.
 * mobileFullBleed gates the desk chrome the screen replaces. The bar itself
 * stays: /entry is already in the Ledger pole's `owns` list, so the pole lights
 * on arrival and there is a way back that is not the design's own head control.
 */

export default async function EntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stage?: string | string[]; state?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;

  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const rawStage = first(query.stage);
  const stage: EntryStage = ENTRY_STAGES.includes(rawStage as EntryStage)
    ? (rawStage as EntryStage)
    : "ready";

  const rawState = first(query.state);
  const entry = OUTCOME_STATES.includes(rawState as OutcomeState)
    ? entryFixtureForState(rawState as OutcomeState)
    : entryFixture(id);

  return (
    <AppShell pageTitle="Entry" mobileFullBleed>
      {/* Gating lives in classes, never in an inline style: an inline display
          beats the class at every breakpoint. */}
      <div className="md:hidden">
        <EntryScreen entry={entry} stage={stage} />
      </div>

      {/* Above the breakpoint this route has no layout of its own. The desk
          reads a settled call inside the record rather than on its own screen. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: "500 17px/1.4 'Playfair Display', serif", color: "var(--c-ink)" }}>
          An entry is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: "400 13px/1.6 Inter, sans-serif", color: "var(--c-secondary)" }}>
          On a wider screen the desk reads settled calls inside your record.
        </p>
      </div>
    </AppShell>
  );
}

import { LedgerScreen, type BriefStage } from "@/components/ledger";

/**
 * The Ledger. Server component so it can read the lifecycle switch off the
 * async searchParams, matching the pattern already used at /waitlist.
 *
 * ?stage= renders a lifecycle state directly. The screen has no data source in
 * this unit, so the states cannot be reached by reproducing their conditions,
 * and the runtime audit has to be able to reach each one.
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

  return <LedgerScreen stage={stage} wrapPublishedAt={wrapRaw ?? null} />;
}

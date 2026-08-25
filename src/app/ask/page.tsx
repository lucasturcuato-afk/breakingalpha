import { AppShell } from "@/components/shell";
import { AskAnswerScreen, AskBrowseScreen, type AskStage } from "@/components/ask";
import { ASK_ANSWER_FIXTURE, ASK_BROWSE_FIXTURE, ASK_FIXTURE_ENABLED } from "@/components/ask/fixture";

/**
 * Ask. Both halves of the Ask pole's entry layer on one route.
 *
 * `?q=` is the whole hierarchy: absent is the directory, present is the answer.
 * `briefs/batch-4.md` open question 1 leaves the answer's URL undecided between
 * `/intelligence` and a child of `/ask`; this unit was scoped to build both
 * states on `/ask`, and a query parameter keeps one route, one pole and one
 * back-stack entry rather than two paths for one screen. `/intelligence` is
 * untouched and still ships the working desktop chat.
 *
 * `?state=` renders a lifecycle state directly. Neither screen has a data
 * source yet, so no state can be reached by reproducing its conditions, and the
 * runtime audit has to be able to reach each one. Outside development and
 * preview the fixture is off and the parameter cannot reach anything invented.
 *
 * Server component so it can read the async searchParams, matching /ledger.
 */

const STAGES: AskStage[] = ["ready", "loading", "error", "empty", "stale"];

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; state?: string | string[] }>;
}) {
  const params = await searchParams;
  const q = (first(params.q) ?? "").trim();
  const rawStage = first(params.state);
  const stage: AskStage = STAGES.includes(rawStage as AskStage) ? (rawStage as AskStage) : "ready";

  return (
    <AppShell pageTitle="Ask" mobileFullBleed>
      {/* Gating lives in a class, never in an inline style: an inline display
          beats the class at every breakpoint, which is the defect that shipped
          the tab bar to desktop once already. */}
      <div className="md:hidden">
        {q ? (
          <AskAnswerScreen
            stage={stage}
            question={q}
            data={ASK_FIXTURE_ENABLED ? ASK_ANSWER_FIXTURE : null}
          />
        ) : (
          <AskBrowseScreen stage={stage} data={ASK_FIXTURE_ENABLED ? ASK_BROWSE_FIXTURE : null} />
        )}
      </div>

      {/* Above the breakpoint this route has no layout of its own. The desk
          already has the research assistant and the company directory, and
          neither is being rebuilt here. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: "500 17px/1.4 'Playfair Display', serif", color: "var(--c-ink)" }}>
          Ask is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: "400 13px/1.6 Inter, sans-serif", color: "var(--c-secondary)" }}>
          On a wider screen the desk splits it across the research assistant and the company directory.
        </p>
      </div>
    </AppShell>
  );
}

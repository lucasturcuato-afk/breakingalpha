import { AppShell } from "@/components/shell";
import { AskAnswerScreen, AskBrowseScreen, type AskStage } from "@/components/ask";
import { ASK_FIXTURE_ENABLED } from "@/components/ask/fixture-gate";
/* Imported by path, never through the barrel. The barrel sits above the client
   composer, so pulling the invented answer through it would put it in the
   browser bundle. This page is a server component, so from here it stays on
   the server unless the gate is open. */
import { ASK_ANSWER_FIXTURE, ASK_BROWSE_FIXTURE } from "@/components/ask/fixture";
import { FONT_DISPLAY, FONT_SANS } from "@/components/mobile/fonts";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { loadAskCompanies, type AskCompaniesLoad } from "@/lib/ask-companies-data";

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
 * `?state=` renders a lifecycle state directly. The three browse counters and
 * the whole answer turn still have no source, so their states cannot be reached
 * by reproducing their conditions and the runtime audit has to be able to reach
 * each one by URL. Outside development and preview the fixture is off and the
 * parameter cannot reach anything invented.
 *
 * THE COMPANY DIRECTORY IS REAL AND IS NOT BEHIND THAT PARAMETER. It is read
 * here, on the server, before a byte of the screen is sent, and passed down as
 * data with its own `{ data, stage }`. `?state=` cannot force it, because it
 * has a source: its states are reached by reproducing its conditions, which is
 * what a wired block is for. `src/lib/ask-companies-data.ts` carries what it
 * reads and what it refuses to read.
 *
 * Server component so it can read the async searchParams and do that read,
 * matching /ledger and /watch.
 */

const STAGES: AskStage[] = ["ready", "loading", "error", "empty", "stale"];

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * The directory read, and the client it needs.
 *
 * A function rather than a value computed above the branch, so it is called on
 * the browse branch ONLY. The answer screen draws no directory, so reading one
 * for it would be a query for a block that is not on the screen, and a
 * `null` threaded through the browse screen's prop would need a `??` at the
 * render site to become a load again.
 */
async function readCompanies(): Promise<AskCompaniesLoad> {
  const { supabase } = await getSupabaseWithUser();
  return loadAskCompanies(supabase);
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
          <AskBrowseScreen
            stage={stage}
            data={ASK_FIXTURE_ENABLED ? ASK_BROWSE_FIXTURE : null}
            companies={await readCompanies()}
          />
        )}
      </div>

      {/* Above the breakpoint this route has no layout of its own. The desk
          already has the research assistant and the company directory, and
          neither is being rebuilt here. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: `500 17px/1.4 ${FONT_DISPLAY}`, color: "var(--c-ink)" }}>
          Ask is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: `400 13px/1.6 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
          On a wider screen the desk splits it across the research assistant and the company directory.
        </p>
      </div>
    </AppShell>
  );
}

import { AppShell } from "@/components/shell";
import { AskDirectoryScreen } from "@/components/ask";
import { FONT_DISPLAY, FONT_SANS } from "@/components/mobile/fonts";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { loadAskCompanies } from "@/lib/ask-companies-data";
import { loadAskCounters } from "@/lib/ask-counters";

/**
 * Ask. One screen, one route, no query parameter.
 *
 * WHAT THIS PAGE STOPPED DOING, and each removal is the point of the unit.
 *
 * IT NO LONGER READS `?q=`. It used to branch on it: absent drew the directory,
 * present drew a separate answer screen whose whole content was the reader's
 * question, the sentence "This surface does not answer yet.", two chips and one
 * inline link measuring 126 by 14 pixels. That screen's scroll region measured
 * `clientHeight` 48 against `scrollHeight` 48, a header and a composer with
 * nothing between them. It is deleted. `/ask?q=nvidia` is now the same screen
 * with its field seeded from the URL and its directory filtered on the client,
 * so a shared link lands on something that works rather than on a sentence
 * saying it does not.
 *
 * That is also the cleanest available answer to Ruling 20 (`DECISIONS.md:249`).
 * The ruling exists because `next/link` prefetched four full RSC renders of
 * `/ask?q=...` with zero interaction, and `prefetch={false}` does not close it:
 * a shared link, a reload or a back press all server-render the same route.
 * There is now no answer block for the framework to reach, no `next/link`
 * anywhere pointing at `/ask?q=`, and neither read below takes `q`, so this
 * page does identical work for every URL that reaches it.
 *
 * IT NO LONGER READS `?state=`. That parameter existed because the three
 * destination counters had no source, so their lifecycle states could not be
 * reached by reproducing their conditions and the runtime audit needed a URL.
 * They have a source now. A wired block's states are reached by reproducing its
 * conditions, and both reads below already model theirs.
 *
 * IT NO LONGER HAS A FIXTURE. `ASK_FIXTURE_ENABLED`, `ASK_BROWSE_FIXTURE` and
 * `ASK_ANSWER_FIXTURE` are deleted with the screen and the counters they served.
 * Nothing on this route is invented in any environment.
 *
 * Server component so it can do both reads before a byte of the screen is sent,
 * matching /ledger and /watch. That is also why there is no skeleton anywhere
 * below: a reader cannot observe either block mid-flight.
 */

export default async function AskPage() {
  /* One client for both reads, so this page cannot end up reading as two
     different sessions. `companies` and all three counter tables carry public
     read policies, so this answers signed out as well, which is what the parity
     and width audits need. */
  const { supabase } = await getSupabaseWithUser();
  const [companies, counters] = await Promise.all([
    loadAskCompanies(supabase),
    loadAskCounters(supabase),
  ]);

  return (
    <AppShell pageTitle="Ask" mobileFullBleed>
      {/* Gating lives in a class, never in an inline style: an inline display
          beats the class at every breakpoint, which is the defect that shipped
          the tab bar to desktop once already. */}
      <div className="md:hidden">
        <AskDirectoryScreen companies={companies} counters={counters} />
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

import { AppShell } from "@/components/shell";
import { CommitSheetProvider } from "@/components/commit";
import { ClaimScreen } from "@/components/claim";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { loadClaim } from "@/lib/claim-data";

/**
 * One desk call, opened out of the Ledger. Server component, so the read
 * happens before a byte of the screen is sent and the query never reaches the
 * browser.
 *
 * WIRED. `src/lib/claim-data.ts` reads the row by id, asks whether the desk has
 * graded it and whether this reader has already taken it onto their own record,
 * and gives back the shape `ClaimScreen` consumes. There is no fixture and no
 * `?stage=` switch: every state this screen has is now reachable by reproducing
 * its condition, which is what that switch existed to stand in for. The
 * `unwired` state went with the fixture.
 *
 * WHICH BLOCKS OF THE DESIGN ARE ABSENT, AND WHY. Three, and THE REASON IS NO
 * COLUMN, NOT NO TIME:
 *
 *   the "what the desk sees" paragraphs   no column. `morning_brief_calls`
 *                                         stores the falsifiable sentence and
 *                                         nothing behind it.
 *   the "WHAT WOULD SETTLE IT" well       no column. Nothing stores what would
 *                                         falsify the claim.
 *   the "Measured against" row            no value at read time, and NOT
 *                                         derived on purpose. The grader picks
 *                                         the benchmark when it runs, so
 *                                         deriving it here would print this
 *                                         screen's prediction of that choice.
 *
 * `sql/0003_brief_self_grading.sql:14-24` plus 0013 and 0014 are the whole
 * column list, and `backend/synthesize.py:1497-1518` writes exactly those. None
 * of the three is stubbed and none is drawn empty. What is left is still the
 * only surface where a reader can see a call's window and its settlement date
 * and commit to it, and it is the ONLY surface that shows an ADOPTED call while
 * its window is still open: the record lists graded entries only.
 *
 * `[id]` IS A morning_brief_calls id. `src/app/entry/[id]/page.tsx` is the
 * sibling route and takes a user_claims id; both are uuids, so the string
 * cannot settle it and the ROUTE does. The loader looks the id up in
 * morning_brief_calls, and anything not there renders missing, which is where a
 * user_claims id pasted in here correctly lands.
 *
 * THE COMMIT SHEET is a global overlay rather than a child of the screen, so it
 * is mounted here as a provider around the route, exactly as
 * `src/app/ledger/page.tsx:109` mounts it. Nothing in `src/components/commit/`
 * changed: a new surface adds a trigger and inherits the note gate, the press,
 * the write and the failure path. `initialTarget` is null on every path,
 * because on this route the sheet only ever opens on a tap.
 *
 * The shell is mounted per page, the way every other page in this repo mounts
 * it. `mobileFullBleed` gates the desk's mood bar, topbar and footer, which are
 * chrome stacked on a screen that already draws its own head.
 *
 * ONE DIVERGENCE FROM THE PROTOTYPE, stated rather than hidden: the design's
 * `showNav` lists four screens and `claim` is not among them, so the design
 * draws this screen with no tab bar. The foundation decided otherwise by
 * putting `/claim` in the Ledger pole's `owns` list, and that file is not this
 * unit's to edit. The bar renders and lights Ledger.
 */

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { supabase, user } = await getSupabaseWithUser();
  const { data, stage } = await loadClaim(supabase, user?.id ?? null, id);

  return (
    <AppShell pageTitle="Claim" mobileFullBleed>
      <CommitSheetProvider initialTarget={null}>
        {/* The mobile layout is gated on the same breakpoint the shell uses to
            swap the sidebar for the tab bar. Gating lives in classes, never in
            an inline style: an inline display beats the class at every
            breakpoint. */}
        <div className="md:hidden">
          <ClaimScreen stage={stage} data={data} />
        </div>

        {/* Above the breakpoint this route has no layout of its own. The desk
            reads a call inside the brief it came from, and that surface already
            exists. */}
        <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
          <p style={{ margin: 0, font: "500 17px/1.4 var(--font-playfair-display), serif", color: "var(--c-ink)" }}>
            A claim is a mobile surface.
          </p>
          <p style={{ margin: "10px 0 0", font: "400 13px/1.6 var(--font-inter), sans-serif", color: "var(--c-secondary)" }}>
            On a wider screen the desk reads a call inside the brief it was written in.
          </p>
        </div>
      </CommitSheetProvider>
    </AppShell>
  );
}

import { AppShell } from "@/components/shell";
import { LedgerScreen, type BriefStage } from "@/components/ledger";
import { LEDGER_FIXTURE, type LedgerData } from "@/components/ledger/fixture";
import { mobileFixtureScreensEnabled } from "@/lib/mobile-fixture-gate";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { initialsFromUser } from "@/lib/user-initials";
import { loadLedger } from "@/lib/ledger-data";

/**
 * The Ledger. Server component, so the read happens before a byte of the
 * screen is sent and the query never reaches the browser.
 *
 * WIRED. `src/lib/ledger-data.ts` reads the real morning brief, the desk's
 * calls on it, and the signed-in reader's own graded calls, and gives back the
 * shape `LedgerScreen` already consumed. Fields with no source come back null
 * and the screen draws nothing for them; that file's header lists which.
 *
 * WHERE THE SAMPLE CONTENT CAN STILL REACH:
 * a non-production build, and only with nobody signed in. That is exactly the
 * parity harness, the width audits and a signed-out local browse. A signed-in
 * reader always takes the loader, in every environment, so no real person is
 * shown invented data. The gate fails closed, so a production build takes the
 * loader branch whatever the session turns out to be.
 *
 * ?stage= and ?wrap= still force a lifecycle state so the runtime audit can
 * reach each one, and they sit behind THE SAME gate the sample content does:
 * a non-production build AND nobody signed in. They used to be gated on the
 * build alone, so a signed-in reader on a dev or preview build could paint the
 * failure state over a brief that had loaded fine. The overrides now apply
 * only on the path that is already showing sample content, which is the only
 * path with no real read for them to contradict.
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
  const named = STAGES.includes(raw as BriefStage) ? (raw as BriefStage) : null;

  const { supabase, user } = await getSupabaseWithUser();
  const sampleAllowed = user === null && mobileFixtureScreensEnabled();

  // The masthead disc's letters come from the reader's own auth record through
  // `src/lib/user-initials.ts`, which is the same record and the same function
  // the shell avatar reads, so the two cannot show one reader different
  // letters. Null when nothing is derivable, and the disc then draws empty.
  const loaded = sampleAllowed
    ? null
    : await loadLedger(supabase, user?.id ?? null, initialsFromUser(user));

  // The gate is resolved HERE and the result is passed down. The screen has no
  // default and no fallback, so a missing gate is a build failure rather than
  // invented data in front of a reader.
  const data: LedgerData | null = sampleAllowed ? LEDGER_FIXTURE : (loaded?.data ?? null);
  const stage: BriefStage = (sampleAllowed ? named : null) ?? loaded?.stage ?? "ready";

  // The wrap slot on the date rule is driven by the artifact existing, never by
  // a clock. The loader supplies it; ?wrap= only overrides it off production.
  const wrapRaw = Array.isArray(params.wrap) ? params.wrap[0] : params.wrap;
  const wrapOverride = sampleAllowed ? (wrapRaw ?? null) : null;

  return (
    <AppShell pageTitle="Ledger" mobileFullBleed>
      {/* The mobile layout is gated on the same breakpoint the shell uses to
          swap the sidebar for the tab bar. Gating lives in classes, never in an
          inline style: an inline display beats the class at every breakpoint,
          which is the defect that shipped the tab bar to desktop once already. */}
      <div className="md:hidden">
        <LedgerScreen stage={stage} data={data} wrapPublishedAt={wrapOverride} />
      </div>

      {/* Above the breakpoint this route has no layout of its own. The desktop
          equivalents already exist and are not being rebuilt here. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        {/* The loaded families, through the same back-compat variables the
            screen below md uses. Playfair Display and Inter are not loaded by
            this app, so spelling them here rendered both of these lines in the
            browser's default serif and sans. They sit outside
            [data-parity="ledger"], which is why the subtree measurement that
            found the other 96 could not see them. */}
        <p style={{ margin: 0, font: "500 17px/1.4 var(--font-playfair-display), serif", color: "var(--c-ink)" }}>
          The Ledger is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: "400 13px/1.6 var(--font-inter), sans-serif", color: "var(--c-secondary)" }}>
          On a wider screen the desk splits it across the Morning Brief and your calls.
        </p>
      </div>
    </AppShell>
  );
}

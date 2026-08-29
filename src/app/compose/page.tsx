import Link from "next/link";
import { AppShell } from "@/components/shell";
import {
  ComposeScreen,
  COMPOSE_FIXTURE_ENABLED,
  COMPOSE_STAGES,
  type ComposeStage,
} from "@/components/compose";
/* Imported by path, never through the barrel. The barrel is reachable from the
   client graph through `compose-screen`, so pulling the sample draft, note and
   proposals through it would put them back in the browser bundle. This page is
   a server component, so from here they stay on the server and the screen only
   ever receives the resolved seed. */
import { seedFor } from "@/components/compose/fixture";
import { todayPt } from "@/lib/session-date";
import { FONT_DISPLAY, FONT_SANS } from "@/components/mobile/fonts";

/**
 * Compose, "Write your own call".
 *
 * A new route. The composer exists today only as the `AuthorClaim` section
 * inside `src/app/radar/calls/page.tsx`; nothing under `src/app/radar/calls/`
 * renders it standalone, and the mobile design promotes it to a screen. This
 * lands beside that page rather than editing it, which is the same rule the
 * skill sets for Watch, Thesis Tracker and Desk record.
 *
 * Server component for two reasons now.
 *
 * It reads the lifecycle SEED off the async searchParams, matching /ledger and
 * /waitlist. That switch is no longer how the screen moves between states, it
 * is only how a dev or preview audit OPENS on one: the live states are driven
 * by the two requests the screen makes. Reproducing `saving` or `save-error`
 * against a real route means a real row, so the seed stays, gated.
 *
 * And it supplies `sessionIso`, which is the reason this page cannot be a
 * client component. `todayPt()` is the US-Pacific session date, and it is read
 * ONCE, HERE, then handed down as data, exactly as `src/lib/ledger-data.ts`
 * supplies it to /ledger and as `commit-target.ts` documents for the commit
 * sheet: "passed in rather than read off a clock here, so a server render and
 * a client render cannot disagree." The screen resolves the window it shows
 * the reader AND the window it writes from this one value.
 *
 * The shell is mounted per page, the way every other page in this repo mounts
 * it. `mobileFullBleed` gates the desk chrome the screen replaces.
 */

export default async function ComposePage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.stage) ? params.stage[0] : params.stage;

  /*
    The fixture stages are gated, and the gate fails closed. It now lives in
    `@/components/compose/fixture-gate` rather than inline here, because it is
    read in two places: once to choose the stage and once inside the screen.

    `empty` carries no invented content: two blank fields and a locked control,
    which is what a real composer opens on. Every other stage carries a made-up
    NVDA proposal and a made-up note. This route requires a session in
    production, so an ungated `?stage=gradeable` would put an invented call in
    front of a real person on a phone. One line, deletable the day a loader
    lands. /ledger ships its fixture ungated because that route serves nobody
    real yet; this one is reachable by anyone signed in.
  */
  const stage =
    COMPOSE_FIXTURE_ENABLED && COMPOSE_STAGES.includes(raw as ComposeStage)
      ? (raw as ComposeStage)
      : "empty";

  /* Built HERE, on the server, and passed down as data. `ComposeScreen` does
     not import `./fixture`, so none of the sample copy is emitted into a
     client chunk on any build. The screen re-checks the same gate before it
     opens on whatever it was handed, so this line being wrong would not be
     enough on its own. */
  const seed = COMPOSE_FIXTURE_ENABLED ? seedFor(stage) : null;

  /* The reader's session date, read once on the server. Every window on the
     screen below is measured from it: the settlement date the reader agrees
     to, and the `resolution_window_end` the write carries. They cannot come
     apart because there is only one value. */
  const sessionIso = todayPt();

  return (
    <AppShell pageTitle="Write your own call" mobileFullBleed>
      {/* Gating lives in classes, never in an inline style: an inline display
          beats the class at every breakpoint, which is the defect that shipped
          the tab bar to desktop once already.

          The layout classes are load-bearing and are here rather than on the
          screen. The screen is a column whose footer carries the commit
          control, and that control has to sit at the bottom of the scrollport
          on a short state and below the content on a tall one. Two measured
          failures got it here: with the wrapper at height auto the screen
          stopped 646px into an 785px scrollport and the control floated
          mid-screen, and with the wrapper at a fixed h-full the tall states
          spilled into the padding the shell reserves for the tab bar, putting
          the control 43px behind it. min-h-full does both, because this
          wrapper's own parent is height-definite. */}
      <div className="md:hidden flex min-h-full flex-col">
        {/* Keyed on the stage. The screen seeds its draft, note, proposal and
            opening lifecycle phase from the stage on mount, so on a client-side
            navigation between two ?stage= values React would reuse the instance
            and keep the previous stage's content: /compose?stage=gradeable then
            ?stage=empty drew the gradeable draft and its READ AS card under the
            empty state. A key remounts instead, which a full page load already
            did. */}
        <ComposeScreen key={stage} stage={stage} seed={seed} sessionIso={sessionIso} />
      </div>

      {/* Above the breakpoint this route has no layout of its own. The desktop
          composer already exists and is not being rebuilt here. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: `500 17px/1.4 ${FONT_DISPLAY}`, color: "var(--c-ink)" }}>
          Writing your own call is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: `400 13px/1.6 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
          On a wider screen the composer sits inside your calls.
        </p>
        {/* A standalone control, not an inline anchor. An anchor inside a
            13px paragraph is a 15px tap target, which the audit refuses and
            which no rule about desktop excuses. */}
        <Link
          href="/radar/calls"
          style={{
            marginTop: "6px",
            minHeight: "44px",
            display: "inline-flex",
            alignItems: "center",
            font: `500 13px/1.6 ${FONT_SANS}`,
            color: "var(--c-goldink)",
          }}
        >
          Open your calls
        </Link>
      </div>
    </AppShell>
  );
}

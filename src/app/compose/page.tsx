import Link from "next/link";
import { AppShell } from "@/components/shell";
import { ComposeScreen, COMPOSE_STAGES, type ComposeStage } from "@/components/compose";

/**
 * Compose, "Write your own call".
 *
 * A new route. The composer exists today only as the `AuthorClaim` section
 * inside `src/app/radar/calls/page.tsx`; nothing under `src/app/radar/calls/`
 * renders it standalone, and the mobile design promotes it to a screen. This
 * lands beside that page rather than editing it, which is the same rule the
 * skill sets for Watch, Thesis Tracker and Desk record.
 *
 * Server component so it can read the lifecycle switch off the async
 * searchParams, matching /ledger and /waitlist. The screen has no data source
 * in this unit, so its states cannot be reached by reproducing their
 * conditions and the runtime audit has to be able to reach each one.
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
    The fixture stages are gated, and the gate fails closed.

    `empty` carries no invented content: two blank fields and a locked control,
    which is what a real composer opens on. Every other stage carries a made-up
    NVDA proposal and a made-up note. This route requires a session in
    production, so an ungated `?stage=gradeable` would put an invented call in
    front of a real person on a phone. One line, deletable the day a loader
    lands. /ledger ships its fixture ungated because that route serves nobody
    real yet; this one is reachable by anyone signed in.
  */
  const fixtureStagesAllowed =
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";

  const stage =
    fixtureStagesAllowed && COMPOSE_STAGES.includes(raw as ComposeStage)
      ? (raw as ComposeStage)
      : "empty";

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
        {/* Keyed on the stage. The screen seeds its draft, note and proposal
            from the stage on mount, so on a client-side navigation between two
            ?stage= values React would reuse the instance and keep the previous
            stage's content: /compose?stage=gradeable then ?stage=empty drew the
            gradeable draft and its READ AS card under the empty state. A key
            remounts instead, which a full page load already did. */}
        <ComposeScreen key={stage} stage={stage} />
      </div>

      {/* Above the breakpoint this route has no layout of its own. The desktop
          composer already exists and is not being rebuilt here. */}
      <div className="hidden md:block" style={{ padding: "48px", backgroundColor: "var(--c-bg)" }}>
        <p style={{ margin: 0, font: "500 17px/1.4 'Playfair Display', serif", color: "var(--c-ink)" }}>
          Writing your own call is a mobile surface.
        </p>
        <p style={{ margin: "10px 0 0", font: "400 13px/1.6 Inter, sans-serif", color: "var(--c-secondary)" }}>
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
            font: "500 13px/1.6 Inter, sans-serif",
            color: "var(--c-goldink)",
          }}
        >
          Open your calls
        </Link>
      </div>
    </AppShell>
  );
}

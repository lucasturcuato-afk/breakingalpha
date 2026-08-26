import { PreviewSettingsBatch, type PreviewScreen, type PreviewState } from "@/components/mobile/preview-settings-batch";

/* Declared here rather than imported: a value exported from a "use client"
 * module reaches a server component as a client reference, not an array. */
const SCREENS: readonly PreviewScreen[] = ["settings", "alerts", "saved", "learned", "share"];
const STATES: readonly PreviewState[] = ["ready", "loading", "error", "empty", "saved"];

/**
 * DESIGN PREVIEW HARNESS, NOT A LIVE SURFACE.
 *
 * Four of these five screens need a session, and Share needs a briefing row,
 * so none of their lifecycle states can be reached by reproducing their
 * conditions in an audit run. The runtime audit has to reach each one, and a
 * state that cannot be looked at is a state nobody checked.
 *
 * Same instinct as `/preview/radar` and `/preview/scored-object`, which exist
 * for the same reason. Every value here is a fixture. Live surfaces render
 * only from real rows.
 *
 *   /preview/settings-batch?screen=settings&state=ready
 *   /preview/settings-batch?screen=saved&state=error
 *
 * The screens are the real components, imported unmodified. Nothing here
 * branches inside one.
 */

export const metadata = {
  title: "Preview: settings batch",
};

function pick<T extends string>(raw: string | string[] | undefined, allowed: readonly T[], fallback: T): T {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return allowed.includes(v as T) ? (v as T) : fallback;
}

export default async function PreviewSettingsBatchPage({
  searchParams,
}: {
  searchParams: Promise<{ screen?: string | string[]; state?: string | string[] }>;
}) {
  const params = await searchParams;
  const screen = pick(params.screen, SCREENS, "settings");
  const state = pick(params.state, STATES, "ready");

  return <PreviewSettingsBatch screen={screen} state={state} />;
}

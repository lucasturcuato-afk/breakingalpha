"use client";

import { useEffect, useState } from "react";
import { MobileSettingsScreen } from "@/components/settings/mobile-settings-screen";
import { AlertsView } from "@/components/settings/mobile-alerts-screen";
import { MobileLearnedScreen } from "@/components/settings/mobile-learned-screen";
import { MobileSavedScreen, type SavedSortKey } from "@/components/saved/mobile-saved-screen";
import { MobileShareScreen } from "@/components/share/mobile-share-screen";

/**
 * Fixtures for the preview harness. Not a live surface. See the route comment.
 *
 * The figures below are shaped like the real rows and are labelled as
 * fixtures wherever they could be mistaken for a reading. Nothing here states
 * a rate.
 */

export type PreviewScreen = "settings" | "alerts" | "saved" | "learned" | "share";
export type PreviewState = "ready" | "loading" | "error" | "empty" | "saved";

const SECTORS = [
  "Technology", "Healthcare & Biotech", "Energy & Oil/Gas", "Financial Services",
  "Consumer & Retail", "Industrials & Manufacturing", "Aerospace & Defense",
  "Real Estate", "Media & Telecom", "Materials & Mining", "Agriculture",
  "Geopolitics & Macro",
];


const WEIGHTS = [
  { sector: "Energy & Utilities", weight: 1.84 },
  { sector: "Technology", weight: 1.42 },
  { sector: "Financial Services", weight: 1.11 },
  { sector: "Healthcare", weight: 0.98 },
  { sector: "Industrials", weight: 0.91 },
  { sector: "Consumer", weight: 0.62 },
];


/**
 * The harness's invented data, loaded on demand and only off production.
 *
 * WHY THE LITERAL IS WRITTEN OUT RATHER THAN READ FROM A GATE CONSTANT.
 * Turbopack inlines `process.env.NODE_ENV` inside the module that reads it and
 * does not propagate an imported boolean back to a call site in another
 * module. A guard written as `if (!SOME_GATE)` therefore leaves the `import()`
 * below REACHABLE, and a reachable `import()` is emitted as its own chunk under
 * `.next/static/chunks/`, which is public and needs no session. Written as the
 * literal, it folds at build time, the `import()` is unreachable, and no chunk
 * is emitted for the fixture at all.
 *
 * The routing gate in `src/proxy.ts:112` already keeps `/preview/*` to a
 * development server. That gates the ROUTE, not the BUNDLE: the chunk shipped
 * regardless, because a bundler ships what a client module imports, not what a
 * reader is allowed to reach. Null forever on production is the correct
 * answer, and each caller draws its own empty state for it.
 */
type PreviewFixture = typeof import("./preview-settings-fixture");

function usePreviewFixture(): PreviewFixture | null {
  const [mod, setMod] = useState<PreviewFixture | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    let cancelled = false;
    void import("./preview-settings-fixture").then((m) => {
      if (!cancelled) setMod(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return mod;
}

export function PreviewSettingsBatch({ screen, state }: { screen: PreviewScreen; state: PreviewState }) {
  if (screen === "settings") return <SettingsPreview state={state} />;
  if (screen === "alerts") return <AlertsPreview />;
  if (screen === "saved") return <SavedPreview state={state} />;
  if (screen === "learned") return <LearnedPreview state={state} />;
  return <SharePreview state={state} />;
}

function SettingsPreview({ state }: { state: PreviewState }) {
  const [firstName, setFirstName] = useState("Maya");
  const [firm, setFirm] = useState("NYU Stern");
  const [role, setRole] = useState<string | null>("student_analyst");
  const [sectors, setSectors] = useState<string[]>(SECTORS.slice(0, 3));
  const [tickers, setTickers] = useState("CEG, NVO, MSFT, BRK.B");

  return (
    <MobileSettingsScreen
      loading={state === "loading"}
      error={state === "error" ? "The profile could not be saved." : null}
      saving={false}
      saved={state === "saved"}
      firstName={firstName}
      firmOrSchool={firm}
      role={role}
      sectors={sectors}
      sectorOptions={SECTORS}
      watchlistInput={tickers}
      onFirstName={setFirstName}
      onFirmOrSchool={setFirm}
      onRole={setRole}
      onToggleSector={(s) =>
        setSectors((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
      }
      onWatchlistInput={setTickers}
      onSave={() => {}}
      theme="light"
      onToggleTheme={() => {}}
      onSignOut={() => {}}
      learnedEventCount={214}
      savedDealCount={4}
    />
  );
}

/* Alerts has no data source and no store any more, so it has no loading,
 * error or empty state to preview. One rendering, whatever `state` asks for.
 * See the header of `mobile-alerts-screen.tsx`. */
function AlertsPreview() {
  return <AlertsView />;
}

function SavedPreview({ state }: { state: PreviewState }) {
  const [sortKey, setSortKey] = useState<SavedSortKey>("saved_at");
  const fx = usePreviewFixture();
  /* Unsaving is tracked as a set of removed ids rather than by copying the
     rows into state, because the rows now arrive after the first render. */
  const [removed, setRemoved] = useState<string[]>([]);
  const deals = (fx?.PREVIEW_DEALS ?? []).filter((d) => !removed.includes(d.id));
  /* Loading, not empty, while the sample is still in flight off production.
     On production `fx` stays null and the screen draws its real empty state. */
  const pending = process.env.NODE_ENV !== "production" && fx === null;
  return (
    <MobileSavedScreen
      deals={state === "empty" ? [] : deals}
      isLoading={state === "loading" || (state !== "empty" && pending)}
      error={state === "error" ? "Your saved deals could not be loaded." : null}
      sortKey={sortKey}
      onSort={setSortKey}
      onUnsave={(id) => setRemoved((prev) => [...prev, id])}
      onExport={() => {}}
      exported={state === "saved"}
      stageOf={(deal) => deal.stage || deal.status || "rumored"}
    />
  );
}

function LearnedPreview({ state }: { state: PreviewState }) {
  return (
    <MobileLearnedScreen
      weights={state === "empty" ? [] : WEIGHTS}
      eventCount={state === "empty" ? 0 : 214}
      /* Null, not the literal "not yet computed". That string was the source of
         the sentence that contradicted itself, and the screen now renders
         nothing for a missing timestamp. */
      updatedAt={state === "empty" ? null : "Aug 13, 4:02 AM"}
      refreshFailed={state === "error"}
      /* False, because false is what production does. The two columns these
         weights would be stored in do not exist, so the harness would be
         drawing a state the product cannot reach if this were true. The plate
         is meant to be a picture of production, not of the fixture's wishes. */
      stored={false}
    />
  );
}

function SharePreview({ state }: { state: PreviewState }) {
  const fx = usePreviewFixture();
  /* Empty when the state asks for empty, and empty on production because the
     sample never arrives there. Both draw the screen's own nothing-to-show
     plate, which is the honest rendering for a harness with no fixture. */
  const brief = state === "empty" ? null : fx?.PREVIEW_BRIEF ?? null;
  return (
    <MobileShareScreen
      kind="Morning Brief"
      dateLine="Thursday, August 6, 2026"
      headline={brief?.headline ?? null}
      marketTone={brief?.marketTone ?? null}
      summary={brief?.summary ?? null}
      deals={brief?.deals ?? []}
      sections={brief?.sections ?? []}
      sectors={brief?.sectors ?? []}
    />
  );
}

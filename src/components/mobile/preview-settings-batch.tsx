"use client";

import { useState } from "react";
import { MobileSettingsScreen } from "@/components/settings/mobile-settings-screen";
import { AlertsView } from "@/components/settings/mobile-alerts-screen";
import { MobileLearnedScreen } from "@/components/settings/mobile-learned-screen";
import { MobileSavedScreen, type SavedSortKey } from "@/components/saved/mobile-saved-screen";
import { MobileShareScreen } from "@/components/share/mobile-share-screen";
import type { EnrichedDeal } from "@/hooks/useSavedDeals";

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

const DEALS: EnrichedDeal[] = [
  {
    id: "fx-1", company: "Hologic", acquirer: "Blackstone & TPG", deal_type: "Take-private",
    stage: "under_loi", value: "$18.3B", sector: "Medtech",
    source_url: "https://www.wsj.com", saved_at: "2026-08-04T12:00:00.000Z",
  },
  {
    id: "fx-2", company: "Electronic Arts", acquirer: "PIF consortium", deal_type: "Take-private",
    stage: "closed", value: "$55.0B", sector: "Software",
    source_url: "https://www.ft.com", saved_at: "2026-08-06T12:00:00.000Z",
  },
  {
    id: "fx-3", company: "Evoqua", acquirer: "Xylem", deal_type: "All-stock merger",
    stage: "announced", value: "$9.4B", sector: "Industrials",
    source_url: "https://www.reuters.com", saved_at: "2026-08-03T12:00:00.000Z",
  },
  {
    id: "fx-4", company: "Smartsheet", acquirer: "Vista Equity", deal_type: "Take-private",
    stage: "rumored", value: "$4.1B", sector: "Software",
    source_url: "https://www.bloomberg.com", saved_at: "2026-07-29T12:00:00.000Z",
  },
];

const WEIGHTS = [
  { sector: "Energy & Utilities", weight: 1.84 },
  { sector: "Technology", weight: 1.42 },
  { sector: "Financial Services", weight: 1.11 },
  { sector: "Healthcare", weight: 0.98 },
  { sector: "Industrials", weight: 0.91 },
  { sector: "Consumer", weight: 0.62 },
];


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
  const [deals, setDeals] = useState(DEALS);
  return (
    <MobileSavedScreen
      deals={state === "empty" ? [] : deals}
      isLoading={state === "loading"}
      error={state === "error" ? "Your saved deals could not be loaded." : null}
      sortKey={sortKey}
      onSort={setSortKey}
      onUnsave={(id) => setDeals((prev) => prev.filter((d) => d.id !== id))}
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
  const empty = state === "empty";
  return (
    <MobileShareScreen
      kind="Morning Brief"
      dateLine="Thursday, August 6, 2026"
      headline={empty ? null : "Breadth Thins as Rates Do the Quiet Work"}
      marketTone={empty ? null : "Patient"}
      summary={
        empty
          ? null
          : "Breadth thinned for a fourth session while the index kept its level, which is the tape saying it does not believe that level. Nine of eleven sectors finished green on a day the index gained almost nothing."
      }
      deals={
        empty
          ? []
          : [
              {
                company: "Hologic",
                value: "$18.3B",
                deal_type: "Take-private",
                one_liner:
                  "Blackstone and TPG go exclusive on a diagnostics platform with a recurring consumables base.",
              },
              {
                company: "Evoqua",
                value: "$9.4B",
                deal_type: "Merger",
                one_liner:
                  "Xylem acquires the industrial water division all-stock; antitrust review runs into Q1.",
              },
            ]
      }
      sections={
        empty
          ? []
          : [
              {
                key: "macro_and_rates",
                title: "Macro & Rates",
                body:
                  "The ten-year gave back a basis point into the close after two soft payroll prints, and the front end has moved further than the long end in every session this week. The desk reads the term premium as carrying more of the level than the market is pricing.",
              },
              {
                key: "deals_and_ma",
                title: "Deals & M&A",
                body:
                  "Sponsors are moving again in medtech. Hologic going exclusive at $18.3B resets the comp set for three more platforms already in market, and the financing is private credit rather than syndicated.",
              },
            ]
      }
      sectors={
        empty
          ? []
          : [
              {
                key: "Energy & Utilities",
                title: "Energy & Utilities",
                body:
                  "Data centre contracting has pulled roughly a third of the merchant nuclear fleet into fixed-price supply agreements. The PJM capacity auction late this month is the first real test of whether firm capacity is scarce enough to keep that pricing.",
              },
            ]
      }
    />
  );
}

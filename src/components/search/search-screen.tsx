"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PAD,
  SearchAskTheDesk,
  SearchCompanyRow,
  SearchDealRow,
  SearchField,
  SearchGroup,
  SearchJumpRow,
  SearchLedgerResult,
} from "./search-parts";
import {
  JUMP_GROUPS,
  SEARCH_FIXTURE_ENABLED,
  isEmptyResult,
  matchFixture,
} from "./fixture";
import styles from "./search.module.css";

/**
 * Search. A jump list to the destinations that exist, then entity results.
 *
 * The three query states are the design's own and are driven by the query,
 * exactly as the prototype drives them:
 *
 *   queryEmpty  nothing typed. PAGES and RESEARCH.
 *   queryTyped  the query matched something in the fixture.
 *   queryNone   the query matched nothing.
 *
 * Loading, error and unwired are UNSPECIFIED in the design. The prototype
 * resolves synchronously from a prefix regex, so it has no in-flight moment,
 * no failed read and no notion of a missing source. All three are built here
 * because a real search has all three.
 *
 * `unwired` is the one that took two passes to get right, so it is written
 * down. Outside development and preview the entity fixture is gated out and
 * there is no search route behind it, so a typed query has nothing to answer
 * it. The first build resolved that to `loading`. That is wrong: a skeleton
 * says something is on its way, and nothing is coming, so it lies in the
 * opposite direction from the empty state it was avoiding. `none` claims a
 * search ran and found nothing; `loading` claims a search is running. Neither
 * is true, so the screen says the third thing instead. The jump list is not
 * gated and stays rendered, because those destinations are real.
 *
 * THERE IS NO TAB BAR ON THIS SCREEN, and that is reproduced rather than
 * fixed. The prototype gates its nav on
 * `showNav: ['dash','ledger','watch','ask'].includes(s.screen)` at line 3460,
 * and `search` is not in that list, so the surface renders full screen with no
 * bar and no pole lit. That is DECISIONS.md open item O2, a recorded design
 * bug. `mobile-tab-bar.tsx` already lists `/search` under the Ask pole, so the
 * pole would light the moment a bar were mounted; mounting one is not this
 * unit's call and `AppShell` is deliberately not wrapped around this screen.
 *
 * Every measurement is read off the rendered prototype with getComputedStyle
 * through `scripts/parity_harness.py --screen search`.
 */

export type SearchStage = "ready" | "loading" | "error" | "unwired";

export function SearchScreen({
  stage = "ready",
  initialQuery = "",
}: {
  stage?: SearchStage;
  /** Seeds the field so a capture and the runtime audit can reach each state. */
  initialQuery?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);

  const typed = query.trim().length > 0;
  const results = useMemo(
    () => (SEARCH_FIXTURE_ENABLED ? matchFixture(query) : null),
    [query],
  );

  /* With the gate closed the screen is unwired whatever `?stage=` says, since
     that parameter is a way to reach the lifecycle states in development and
     is not a source. In development and preview `?stage=unwired` reaches this
     branch on purpose, so it can be audited and captured like the rest. */
  const effective: SearchStage = SEARCH_FIXTURE_ENABLED ? stage : "unwired";

  /* Which branch the results area draws, resolved once so what follows reads
     as a list of states rather than a nest of conditions. */
  const view: "jump" | "results" | "none" | "loading" | "error" | "unwired" =
    effective === "unwired"
      ? typed
        ? "unwired"
        : "jump"
      : effective === "error"
        ? "error"
        : effective === "loading"
          ? "loading"
          : !typed
            ? "jump"
            : /* Unreachable: `results` is null only when the gate is closed,
                 and that already resolved to unwired above. Written as unwired
                 rather than none anyway, so the fallback stays honest if the
                 two conditions ever come apart. */
              !results
              ? "unwired"
              : isEmptyResult(results)
                ? "none"
                : "results";

  return (
    <div
      data-parity="search"
      className={styles.screenIn}
      style={{
        /* dvh, never vh: the address bar moves and a vh-sized column jumps
           with it. The screen owns the viewport because the results scroll
           under a field that stays put, which is the prototype's own
           structure: a `flex:none` head over a `flex:1;overflow-y:auto` body. */
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--c-bg)",
      }}
    >
      <SearchField
        value={query}
        onChange={setQuery}
        /* The prototype's Cancel fires goAsk. Browser back is the honest
           equivalent for a pushed view, it is what README's gesture rule
           assigns the job to, and it does not aim at a route that is not
           built yet.

           Back alone is not enough. `history.back()` is a no-op on the first
           entry of a tab, and this screen is reached by URL rather than from a
           pole, so an opened-directly Search leaves Cancel dead on a surface
           that mounts no tab bar and has no other way off it. */
        onCancel={() => {
          if (typeof window !== "undefined" && window.history.length > 1) {
            router.back();
          } else {
            router.push("/dashboard");
          }
        }}
      />

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          /* The screen's only gutter. It is set once, here and on the field
             row above, and NOT on the root: a gutter on both the root and the
             scroll area is 40px of padding where the design draws 20. */
          padding: `0 ${PAD} calc(24px + env(safe-area-inset-bottom))`,
        }}
      >
        {view === "jump" ? <JumpList /> : null}
        {view === "results" && results ? <Results query={query.trim()} results={results} /> : null}
        {view === "none" ? <NoResults /> : null}
        {view === "unwired" ? <Unwired /> : null}
        {view === "loading" ? <SearchSkeleton /> : null}
        {view === "error" ? <SearchError /> : null}
      </div>
    </div>
  );
}

/* ── states ─────────────────────────────────────────────────────────── */

function JumpList() {
  return (
    <div style={{ paddingTop: "4px" }}>
      {JUMP_GROUPS.map((group, i) => (
        <SearchGroup key={group.eyebrow} eyebrow={group.eyebrow} first={i === 0}>
          {group.rows.map((row) => (
            <SearchJumpRow key={row.label} label={row.label} href={row.href} />
          ))}
        </SearchGroup>
      ))}
    </div>
  );
}

function Results({
  query,
  results,
}: {
  query: string;
  results: ReturnType<typeof matchFixture>;
}) {
  /* Groups render only when they have something in them, so a query that hits
     one company and no entries does not draw an empty YOUR LEDGER heading. */
  const groups: Array<{ eyebrow: string; node: React.ReactNode }> = [];
  if (results.companies.length) {
    groups.push({
      eyebrow: "COMPANIES",
      node: results.companies.map((c) => (
        <SearchCompanyRow key={c.id} href={c.href} ticker={c.ticker} name={c.name} detail={c.detail} />
      )),
    });
  }
  if (results.ledger.length) {
    groups.push({
      eyebrow: "YOUR LEDGER",
      node: results.ledger.map((l) => (
        <SearchLedgerResult key={l.id} href={l.href} state={l.state} date={l.date} claim={l.claim} />
      )),
    });
  }
  if (results.deals.length) {
    groups.push({
      eyebrow: "DEALS",
      node: results.deals.map((d) => <SearchDealRow key={d.id} name={d.name} detail={d.detail} />),
    });
  }

  return (
    <div className={styles.groupIn} style={{ paddingTop: "4px" }}>
      {groups.map((g, i) => (
        <SearchGroup key={g.eyebrow} eyebrow={g.eyebrow} first={i === 0} rowsMarginTop="0px">
          {g.node}
        </SearchGroup>
      ))}
      <SearchGroup eyebrow="ASK THE DESK" rowsMarginTop="0px">
        <SearchAskTheDesk query={query} />
      </SearchGroup>
    </div>
  );
}

/**
 * Reached only after a search actually ran and came back with nothing, which
 * is what makes the sentence true. When there is no search to run at all the
 * screen shows `Unwired` instead; see the `view` resolution above.
 */
function NoResults() {
  return (
    /* role="status" so the sentence is announced when it replaces the list.
       The results themselves are not in a live region on purpose: reading a
       whole result list back on every keystroke is worse than silence. An
       empty answer is one sentence and is the case a reader cannot infer. */
    <div
      className={styles.groupIn}
      role="status"
      style={{ padding: "44px 8px 0", textAlign: "center" }}
    >
      <p style={{ margin: 0, font: "500 16px/1.45 'Playfair Display', serif", color: "var(--c-ink)" }}>
        No results found
      </p>
      <p
        style={{
          margin: "10px 0 0",
          font: "400 13px/1.6 Inter, sans-serif",
          color: "var(--c-muted)",
          textWrap: "pretty",
        }}
      >
        Coverage runs to US and European listed names, live deal processes, and the themes the desk
        tracks.
      </p>
    </div>
  );
}

/**
 * The entity half has no source. Not a failed read, not an empty answer, and
 * not something on its way.
 *
 * Every word here is chosen against a sentence it must not say. It does not
 * say no results, because nothing was searched. It does not say loading,
 * because nothing is coming. It does not say the name is out of coverage,
 * because coverage has not been consulted. It says the three groups are not
 * connected to anything yet, which is the only fact available.
 *
 * The jump list stays underneath. Those destinations are live in every
 * environment and are not part of what is missing.
 */
function Unwired() {
  return (
    <>
      <div className={styles.groupIn} style={{ paddingTop: "18px" }} role="status">
        <p style={{ margin: 0, font: "500 16px/1.45 'Playfair Display', serif", color: "var(--c-ink)" }}>
          Entity search is not wired yet.
        </p>
        <p
          style={{
            margin: "10px 0 0",
            font: "400 13px/1.6 Inter, sans-serif",
            color: "var(--c-secondary)",
            textWrap: "pretty",
          }}
        >
          Companies, your entries and deals are not connected to a source on this screen, so nothing
          has been searched and nothing has been ruled out. The pages below are live.
        </p>
      </div>
      <div style={{ marginTop: "22px" }}>
        <JumpList />
      </div>
    </>
  );
}

function SearchSkeleton() {
  return (
    /* role="status", not a bare div. `aria-label` and `aria-busy` on an element
       with no role are not exposed, so the skeleton announced nothing at all
       and a screen reader reader was told only that the list had emptied. */
    <div style={{ paddingTop: "4px" }} role="status" aria-busy="true" aria-label="Searching">
      <div className={styles.sk} style={{ height: "10px", width: "34%" }} />
      {[0, 1].map((i) => (
        <div
          key={i}
          style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "13px", minHeight: "60px" }}
        >
          <div className={styles.sk} style={{ flex: "none", width: "46px", height: "11px" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className={styles.sk} style={{ height: "14px", width: "62%" }} />
            <div className={styles.sk} style={{ marginTop: "6px", height: "11px", width: "44%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * A failed read is not an empty result, and the copy says so in both
 * directions. Nothing is being hidden and nothing has been ruled out: the
 * screen could not read, which is a different fact from finding nothing.
 *
 * The jump list stays under the notice. It needs no backend, so a failed
 * entity read is no reason to take the destinations away, and it means the
 * sentence about them is one the reader can act on.
 */
function SearchError() {
  return (
    <>
      <div style={{ paddingTop: "18px" }} role="alert">
        <p style={{ margin: 0, font: "500 16px/1.45 'Playfair Display', serif", color: "var(--c-ink)" }}>
          We could not run that search.
        </p>
        <p
          style={{
            margin: "10px 0 0",
            font: "400 13px/1.6 Inter, sans-serif",
            color: "var(--c-secondary)",
            maxWidth: "34ch",
            textWrap: "pretty",
          }}
        >
          This is a failed read, not an empty one. Nothing has been ruled out of coverage, and the
          pages below are still reachable.
        </p>
      </div>
      <div style={{ marginTop: "22px" }}>
        <JumpList />
      </div>
    </>
  );
}

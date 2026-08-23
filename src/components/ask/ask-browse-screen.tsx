import {
  AskDirectoryRow,
  AskLookupRow,
  AskNotice,
  AskSectionRule,
  AskSkeleton,
  IconDeals,
  IconFeed,
  IconTrends,
  PAD,
} from "./ask-parts";
import { AskComposer } from "./ask-composer";
import {
  ASK_BROWSE_FIXTURE,
  ASK_DIRECTORY,
  ASK_FIXTURE_ENABLED,
  SUGGESTED_PROMPTS,
  type AskBrowseData,
  type DirectoryId,
} from "./fixture";
import type { ReactNode } from "react";

/**
 * Ask, browse. The Ask pole's tab root and the directory the answer screen is
 * reached from.
 *
 * `showNav` at prototype line 3460 lists `ask` among its four, so the tab bar
 * renders here. The screen is therefore a column exactly one bar shorter than
 * the viewport, with the list scrolling between a fixed head and a fixed
 * composer, which is how the prototype draws it.
 *
 * The gutter is drawn ONCE, by the head, the scroll region and the composer.
 * The root carries no padding of its own. That matters: `parity_harness.py`
 * gives its own phone element `padding:0 var(--v3-pad)` that the real prototype
 * has not got, so a build that also pads its root measures a 310px column
 * against a design that draws 350. See the PR body.
 */

export type AskStage = "ready" | "loading" | "error" | "empty" | "stale";

const ICONS: Record<DirectoryId, ReactNode> = {
  deals: IconDeals,
  trends: IconTrends,
  feed: IconFeed,
};

const INTRO =
  "Research assistant. A ticker resolves to a company; a question is answered from your intelligence, theses and briefings.";

const LOOKUP_INTRO =
  "Type any ticker or company name above for the primer, filings, financials and insider activity. Recent lookups:";

export function AskBrowseScreen({
  stage = "ready",
  data = ASK_BROWSE_FIXTURE,
}: {
  stage?: AskStage;
  data?: AskBrowseData;
}) {
  /* Outside development and preview there is no source for either the counters
     or the lookups, so the screen renders as if both came back empty: the three
     destinations stay, their figures do not. */
  const effective: AskStage = ASK_FIXTURE_ENABLED ? stage : "empty";
  const loading = effective === "loading";
  const showDetail = effective === "ready" || effective === "stale";

  return (
    <div
      data-parity="ask"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100dvh - var(--mobile-tabbar-height) - env(safe-area-inset-bottom))",
        backgroundColor: "var(--c-bg)",
      }}
    >
      <div style={{ flex: "none", padding: `6px ${PAD} 0` }}>
        <h1
          style={{
            margin: 0,
            font: "700 26px/1.14 'Playfair Display', serif",
            letterSpacing: "-0.02em",
            color: "var(--c-ink)",
          }}
        >
          Ask
        </h1>
        <p style={{ margin: "8px 0 0", font: "400 12.5px/1.5 Inter, sans-serif", color: "var(--c-secondary)" }}>
          {INTRO}
        </p>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: `18px ${PAD} 24px` }}>
        <AskSectionRule label="browse" />

        {ASK_DIRECTORY.map((route, i) => {
          const detail = data.detail[route.id];
          return (
            <AskDirectoryRow
              key={route.id}
              href={route.href}
              label={route.label}
              icon={ICONS[route.id]}
              counter={loading ? <AskSkeleton width="46px" height={10} /> : showDetail ? detail.counter : null}
              summary={
                loading ? (
                  <AskSkeleton width="100%" height={11} style={{ marginTop: "2px" }} />
                ) : showDetail ? (
                  detail.summary
                ) : null
              }
              first={i === 0}
              last={i === ASK_DIRECTORY.length - 1}
            />
          );
        })}

        {effective === "error" ? (
          <AskNotice>
            The counts on these three did not load. The destinations are open and current; only their figures are
            missing, so read this as a failed read rather than a quiet day.
          </AskNotice>
        ) : null}

        {effective === "empty" ? (
          <AskNotice>Nothing has moved on any of the three since yesterday&apos;s close.</AskNotice>
        ) : null}

        {effective === "stale" ? <AskNotice>{data.countedAt}</AskNotice> : null}

        <AskSectionRule label="company intel" style={{ marginTop: "24px" }} />
        <p
          style={{
            margin: "8px 0 0",
            font: "400 11.5px/1.5 Inter, sans-serif",
            color: "var(--c-muted)",
            textWrap: "pretty",
          }}
        >
          {LOOKUP_INTRO}
        </p>

        {loading ? (
          <div style={{ marginTop: "12px" }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "13px",
                  minHeight: "56px",
                  borderTop: "1px solid var(--c-hair)",
                  ...(i === 2 ? { borderBottom: "1px solid var(--c-hair)" } : null),
                }}
              >
                <AskSkeleton width="34px" height={11} />
                <AskSkeleton width="60%" height={12} />
              </div>
            ))}
          </div>
        ) : null}

        {effective === "error" ? (
          <AskNotice>Your recent lookups did not load. They have not been cleared.</AskNotice>
        ) : null}

        {effective === "empty" ? (
          <AskNotice>No recent lookups yet. Type a ticker or a company name above and it will land here.</AskNotice>
        ) : null}

        {showDetail
          ? data.lookups.map((lookup, i) => (
              <AskLookupRow
                key={lookup.ticker}
                href={lookup.href}
                ticker={lookup.ticker}
                name={lookup.name}
                entries={lookup.entries}
                first={i === 0}
                last={i === data.lookups.length - 1}
              />
            ))
          : null}
      </div>

      <AskComposer prompts={[SUGGESTED_PROMPTS[0], SUGGESTED_PROMPTS[2]]} />
    </div>
  );
}

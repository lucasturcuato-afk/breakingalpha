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
import styles from "./ask.module.css";
/* `./fixture` is NOT imported here and must never be. The gate stops the
   render and not the download, so a value import from that module would be a
   download of the invented lookups whether or not they can paint. This screen
   carries no "use client" today, which is too thin a thing to rely on. The
   directory and the shape live in `./ask-data` and are invented nothing; the
   fixture arrives as the `data` prop, resolved on the server by
   `src/app/ask/page.tsx`. */
import { ASK_FIXTURE_ENABLED } from "./fixture-gate";
import { ASK_DIRECTORY, CHIP_PROMPTS, type AskBrowseData, type DirectoryId } from "./ask-data";
import type { AskCompaniesLoad } from "@/lib/ask-companies-data";
import type { ReactNode } from "react";
import { FONT_DISPLAY, FONT_SANS } from "@/components/mobile/fonts";

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
 *
 * TWO SOURCES, ONE SCREEN, and they must not be confused for each other. The
 * three browse counters are still unwired and take the fixture's lifecycle
 * through `stage`. The company directory below them is a real read in every
 * environment and arrives as its own `{ data, stage }` prop. Folding the second
 * into the first would put a real block behind the fixture gate, which would
 * blank it in production.
 */

export type AskStage = "ready" | "loading" | "error" | "empty" | "stale";

const ICONS: Record<DirectoryId, ReactNode> = {
  deals: IconDeals,
  trends: IconTrends,
  feed: IconFeed,
};

/**
 * THE INTRO NAMES THE TWO CONTROLS THAT EXIST, and that is why it is not the
 * design's string any more.
 *
 * The design draws "A ticker resolves to a company; a question is answered from
 * your intelligence, theses and briefings." Neither clause held. Nothing on the
 * screen resolved a ticker, and the field it referred to went to an answer
 * screen that answers "This surface does not answer yet". Both halves are real
 * now and both are reached differently: a directory row opens a company, and a
 * prompt chip opens the assistant. The sentence says that instead.
 *
 * Costs one text pair in the parity fingerprint, named in the PR body. A
 * matching sentence that describes the wrong screen is not parity.
 */
const INTRO =
  "Research assistant. The rows below open a company; the prompts open the assistant, which answers from your intelligence, theses and briefings.";

/**
 * THE BLOCK IS A DIRECTORY, NOT A HISTORY, and this string is where that shows.
 *
 * The design's copy ended "Recent lookups:", and the build shipped a notice
 * under it saying lookups are not recorded for anyone. Nothing in the product
 * records that a company was viewed, so the list could never fill. The rows are
 * the companies the corpus names most often now, which is a fact the read
 * already carries, and the sentence says that instead of promising a history.
 *
 * The ordering is stated HERE, once, rather than as a figure on every row: a
 * mention count beside each name invites reading the column as a ranking of
 * importance, which a count of articles is not.
 */
const DIRECTORY_INTRO =
  "The companies named most often across the coverage Signalera has ingested. Each row opens its primer, filings, financials and insider activity.";

export function AskBrowseScreen({
  stage = "ready",
  data,
  companies,
}: {
  stage?: AskStage;
  /** The gated fixture, or null when no source exists. Never defaulted. */
  data: AskBrowseData | null;
  /**
   * The company directory read, resolved on the server by `src/app/ask/page.tsx`.
   * Required, with no default: this half of the screen has a real source in
   * every environment, so it is NOT behind the fixture gate and a missing prop
   * is a type error rather than a quietly empty block.
   */
  companies: AskCompaniesLoad;
}) {
  /* Outside development and preview there is no source for the three browse
     counters. That is NOT the same as an empty read, and it must not
     render as one: "nothing has moved since yesterday's close" is a claim about
     the market, and asserting it off no source at all is the same fabrication
     the fixture gate exists to prevent. Unwired says unwired. The three
     destinations stay, their figures do not. */
  const effective: AskStage | "unwired" = ASK_FIXTURE_ENABLED ? stage : "unwired";

  /* Read once into a local so the empty check and the map are looking at the
     same value, and so neither needs a non-null assertion to say so. */
  const companyRows = companies.data;
  const loading = effective === "loading";
  const showDetail = effective === "ready" || effective === "stale";

  return (
    <div
      data-parity="ask"
      className={styles.enter}
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
            font: `700 26px/1.14 ${FONT_DISPLAY}`,
            letterSpacing: "-0.02em",
            color: "var(--c-ink)",
          }}
        >
          Ask
        </h1>
        <p style={{ margin: "8px 0 0", font: `400 12.5px/1.5 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
          {INTRO}
        </p>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: `18px ${PAD} 24px` }}>
        <AskSectionRule label="browse" />

        {ASK_DIRECTORY.map((route, i) => {
          const detail = data?.detail[route.id];
          return (
            <AskDirectoryRow
              key={route.id}
              href={route.href}
              label={route.label}
              icon={ICONS[route.id]}
              counter={loading ? <AskSkeleton width="46px" height={10} /> : showDetail ? detail?.counter : null}
              summary={
                loading ? (
                  <AskSkeleton width="100%" height={11} style={{ marginTop: "2px" }} />
                ) : showDetail ? (
                  detail?.summary
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

        {effective === "unwired" ? (
          <AskNotice>
            These three counts are not wired to a source yet. The destinations are open and current; a missing figure
            here means unread, not a quiet day.
          </AskNotice>
        ) : null}

        {effective === "stale" ? <AskNotice>{data?.countedAt}</AskNotice> : null}

        <AskSectionRule label="company intel" style={{ marginTop: "24px" }} />
        <p
          style={{
            margin: "8px 0 0",
            font: `400 11.5px/1.5 ${FONT_SANS}`,
            color: "var(--c-muted)",
            textWrap: "pretty",
          }}
        >
          {DIRECTORY_INTRO}
        </p>

        {/* THIS BLOCK IS NOT GATED ON `effective`, and that is deliberate. The
            counters above are still unwired, so they take the fixture's
            lifecycle. The directory has a real read in every environment and
            takes its own, which is the only way a failed read can say a
            different thing from an empty corpus.

            THERE IS NO SKELETON HERE ANY MORE. `/ask` is a server component and
            this read is awaited before a byte of the screen is sent, so a
            reader can never observe the block mid-flight. A skeleton for a
            state that cannot be reached is a drawing of a load, not a load. */}
        {companies.stage === "error" ? (
          <AskNotice>
            The company directory did not load. This is a failed read and not an empty one: no company has
            been ruled out of coverage, and the rows are missing rather than absent.
          </AskNotice>
        ) : null}

        {companyRows !== null && companyRows.length === 0 ? (
          <AskNotice>The read answered with no companies, so there is nothing to list here yet.</AskNotice>
        ) : null}

        {companyRows?.map((company, i) => (
          <AskLookupRow
            key={company.id}
            href={company.href}
            ticker={company.ticker}
            name={company.name}
            detail={company.detail}
            first={i === 0}
            last={i === companyRows.length - 1}
          />
        ))}
      </div>

      {/* The chips come off `CHIP_PROMPTS`, NOT off `data`. They are the live
          chat's own strings, so they are invented nothing and belong in front
          of every reader; taking them off `data` put them behind the fixture
          gate, and production drew a screen whose intro promised a question
          would be answered with nothing on it that asked one. There is still
          one definition of the pair: the fixture reads the same constant. */}
      <AskComposer prompts={CHIP_PROMPTS} />
    </div>
  );
}

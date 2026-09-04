"use client";

import { useEffect, useMemo, useState, Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SectionRule } from "./section-rule";
import { WatchNotice, WatchSkeleton } from "./watch-notice";
import { WATCH_RECENCY_DAYS } from "./recency";
/* Type-only. A value import out of this path would drag the sample headlines
   beside the types into this client component's chunk in `.next/static`, which
   is design-lint rule `fixture-in-client-bundle`. Types erase. */
import type {
  FollowCluster,
  WatchData,
  WatchLens,
  WatchlistItem,
  WatchQuote,
  WatchQuotes,
} from "./fixture";
/* A VALUE import, deliberately. This is the product's own reason for something
   it does not draw, it has to reach the browser, and it is not sample content.
   The rule the import beside it obeys is about `fixture.ts`'s invented prose
   reaching `.next/static`; this is the opposite of invented. */
import { WATCH_OMISSIONS } from "./omissions";
/* The add control. A wrapper around the desk's own `WatchlistAddInput`, which
   it imports by reference and does not modify. See `watch-add.tsx`. */
import { WatchAdd } from "./watch-add";
import styles from "./watch.module.css";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";
import { TabBarClearance } from "@/components/mobile/tab-bar-clearance";

/**
 * Radar's two ungraded sections: the reader's watchlist, and what they follow.
 *
 * ONE COMPONENT, TWO ROUTES, ONE SECTION DRAWN AT A TIME. `segment` decides
 * which. This used to draw both tiers in one scroll under a masthead reading
 * "Radar", which is why the surface read as a renamed watchlist while the desk
 * had four tabs. The two tiers are unchanged inside; what changed is that each
 * is now a whole screen with its own route, its own masthead and its own place
 * in the four-section row. Calls and Desk record are the graded half of Radar
 * and are their own screens, because their data has nothing to do with this
 * loader. See `decisions/mobile-radar-mirrors-the-desk.md`.
 *
 * WHAT IS DRAWN AND WHAT IS NOT.
 *
 * FOUR THINGS ARE OMITTED AND NONE OF THEM SAYS SO. Tracked views, the
 * pinned-espresso hero, theme headings over following and staleness are all
 * absent, and the measurements behind each are unchanged. What changed is that
 * the screen stopped narrating them. The ruling of 2026-08-29 narrowed the one
 * this screen shipped under: the app must never assert something false, but it
 * does not have to enumerate everything absent, and four stacked "not shown
 * here" explanations read as a product apologizing for itself. The test is
 * whether ABSENCE WOULD MISLEAD, applied per entry.
 *
 * Three fail it outright. Nothing on this screen names a third tier, no figure
 * counts claims, every entry renders as the same card so no rank is implied,
 * and `ThemeCluster` already draws no heading where there is no label, so the
 * rows read as the list they are. A reader has no way to know any of the three
 * was ever meant to be here, and no rendered line becomes wrong without it.
 *
 * The fourth went for a different reason and it is the one to read before
 * putting anything back. Staleness PASSES the misleading test: this screen
 * renders dated claims off an undated store, and nothing records when a given
 * desk's rows were last refreshed. The owner's ruling is that the note was
 * still wrong, because it is a CAPTION ON A WRONG SENTENCE. "No news today"
 * does not become true because a footnote says nothing is dated; it stays
 * wrong and acquires an apology. The fix is issue #748, which makes the `stale`
 * branch reachable so the screen says when it last checked instead of
 * asserting a check it did not make. `omissions.ts` carries all of it.
 *
 * The register is unchanged: a REASON is about the PRODUCT, an EMPTY STATE is
 * about the READER and needs a read behind it.
 *
 * Every measurement is taken off the rendered prototype with getComputedStyle.
 * The prototype's sc-if blocks need a runtime that does not resolve over
 * file://, so the screen was rendered through `scripts/parity_harness.py`,
 * which resolves those branches from the prototype's own state map. See the PR
 * body for the parity numbers.
 *
 * The two tiers are distinct by anatomy, not by decoration. The watchlist is
 * cards; following is hairline-separated rows. Nothing on this screen is
 * graded, so nothing on it carries an outcome state, a top edge or a state
 * word.
 */

export type WatchStage = "ready" | "loading" | "error" | "stale";

const PAD = "var(--v3-pad)";

/**
 * How a short section's free space is divided, as flex-grow weights on the
 * `Slack` blocks.
 */
/* THE LEAD IS 0 NOW, AND THE WEIGHTS BELOW ARE RE-DERIVED, because splitting
   Radar into four sections changed the layout these numbers described.

   WHAT THEY USED TO SERVE. One screen, one masthead, TWO tiers, so the body had
   two interior seams and 3:8:1 spread the free space across four gaps: above
   the masthead, above the first section rule, between the tiers, and below the
   last notice. Measured on the empty state at 390x844 that was 59px / 158px
   split in two / 20px, every gap inside the 15% gate.

   WHAT BROKE. With one tier per route there is no gap BETWEEN tiers, so the
   body's whole share fell into the single seam that was left, and that seam sat
   ABOVE the content. Measured on the empty Following section at 390: roughly
   300px of nothing between the standfirst and the section rule, with the
   masthead pinned to the top and the notice pushed to the bottom. That is the
   two-lump composition the original comment was written to remove, reproduced
   by the change that inherited it. It was found by looking at the rendered
   screen, not by reading the code.

   WHAT THEY SERVE NOW. There is also a new element above the masthead that did
   not exist when these were chosen: the four-section row. It is the top chrome,
   and the masthead belongs directly under it, which is exactly where Calls and
   Desk record put theirs. So the lead is 0, the masthead sits under the row on
   all four sections, and the free space goes BELOW the content where a short
   document naturally leaves it. */
const SLACK_LEAD = 0;
const SLACK_BODY = 8;
const SLACK_TAIL = 1;

/*
 * THE TWO DESK LINKS ARE GONE, AND THIS IS THE REASON THEY HAD TO GO.
 *
 * They were `WATCHLIST_DESK = "/radar/watchlist"` and
 * `FOLLOWING_DESK = "/radar/following"`, drawn as the `action` on each tier's
 * empty state, and until this branch they were the honest answer: this screen
 * could not add anything, so it named the surface that could and went there.
 *
 * `src/components/mobile/desk-redirect.tsx` now sends both of those desk routes
 * to this screen below `md`. That turns each link into a closed circle. The
 * reader taps "Open the watchlist desk", the desk route sends them to
 * `/watch/watchlist`, and they arrive back on the empty state they tapped out
 * of. Following is the identical shape through `/watch`. Two navigations, no
 * movement, and no way to tell that anything happened.
 *
 * WHAT REPLACES THEM IS NOT THE SAME ON BOTH TIERS, because the two tiers do
 * not have the same answer available.
 *
 *   watchlist  `WatchAdd` mounts the desk's own add widget here, so the empty
 *              state carries the control it used to send the reader away to
 *              find. The circle is closed by making the destination
 *              unnecessary.
 *   following  Nothing replaces it, and the copy stops promising one. A follow
 *              is written only by `/radar/following`, which is one of the six
 *              redirected routes, so below `md` there is no reachable surface
 *              that creates one. An action pointing anywhere would either loop
 *              or lie. The empty state says what is true and offers no control
 *              this screen does not have. The consequence is recorded in the PR
 *              body as a gap for a human to rule on, not smoothed over here.
 */

/**
 * Small counts are spelled, matching the design's own prose. Above twelve the
 * numeral reads better and the design never draws one. Either way the word is
 * derived from the count and never typed beside it, which is the rule that
 * stops a figure and the list it describes from drifting apart.
 */
const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six",
  "seven", "eight", "nine", "ten", "eleven", "twelve",
];

function spell(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

function sentenceCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The window the quiet line describes, said in words rather than typed beside
 * the count. The desktop source filters at two days and says "in the last two
 * days"; the design says "today". The copy is derived from the constant so the
 * two cannot disagree again, whichever way the window is eventually settled.
 */
const RECENCY_LABEL =
  WATCH_RECENCY_DAYS === 1 ? "today" : `in the last ${spell(WATCH_RECENCY_DAYS)} days`;

const LENSES: { key: WatchLens; label: string }[] = [
  { key: "all", label: "All" },
  { key: "public", label: "Public" },
  { key: "private", label: "Private" },
  { key: "industries", label: "Industries" },
];

function matchesLens(item: WatchlistItem, lens: WatchLens): boolean {
  if (lens === "all") return true;
  if (lens === "industries") return item.kind === "industry";
  return item.kind === lens;
}

/**
 * The signed move, per ticker, read after mount.
 *
 * NOT part of `WatchData` and never blocking the server read.
 * `/api/watchlist-quotes` reaches Finnhub and Yahoo, and the design calls price
 * "the quiet part"; paying for it with the whole screen's time to first byte is
 * the wrong trade.
 *
 * Absence is the only failure mode this needs. A read in flight and a read that
 * faulted both render NOTHING rather than a number, so the transiently wrong
 * figure a `?? 0` produces on the desk cannot happen here. `pct >= 0` decides
 * direction, which is the rule `/api/watchlist-quotes` callers already use.
 *
 * That route caps its symbol list at twenty. Past that a name simply has no
 * quote, which draws no price rather than a wrong one. Logged as a defect this
 * unit does not own.
 */
function useQuotes(symbols: string[]): WatchQuotes {
  const [quotes, setQuotes] = useState<WatchQuotes>({});
  const key = symbols.join(",");
  useEffect(() => {
    if (key.length === 0) return;
    let live = true;
    fetch(`/api/watchlist-quotes?symbols=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { quotes?: Record<string, { pct: number }> } | null) => {
        if (!live || !json?.quotes) return;
        const next: WatchQuotes = {};
        for (const [symbol, q] of Object.entries(json.quotes)) {
          if (typeof q?.pct !== "number" || Number.isNaN(q.pct)) continue;
          next[symbol] = {
            move: `${q.pct >= 0 ? "+" : ""}${q.pct.toFixed(2)}%`,
            direction: q.pct >= 0 ? "up" : "down",
          };
        }
        setQuotes(next);
      })
      .catch(() => {
        /* Nothing drawn. An absent price is honest; a stale one is not. */
      });
    return () => {
      live = false;
    };
  }, [key]);
  return quotes;
}

export function WatchScreen({
  stage = "ready",
  data,
  onRetry,
  segment,
  nav,
}: {
  stage?: WatchStage;
  /**
   * WHICH OF RADAR'S FOUR SECTIONS THIS IS. REQUIRED, with no default, so a
   * call site has to say which one it is drawing rather than inheriting
   * whichever the last author happened to write first.
   *
   * This screen used to draw both tiers in one scroll under one masthead, and
   * that masthead led on the watchlist, which is exactly why the surface read
   * as a renamed watchlist while the desk had four tabs. Each tier is now its
   * own route and its own section, and this prop is the switch. Only two of
   * Radar's four sections live in this component; Calls and Desk record are
   * their own screens because their data has nothing to do with this loader.
   */
  segment: "watchlist" | "following";
  /**
   * The section row, supplied by the route. REQUIRED, so a Radar route cannot
   * ship without the navigation that makes its three siblings reachable, which
   * is the failure this whole surface exists to correct.
   *
   * Passed in rather than imported here for one reason: this component is one
   * of three screens under the row, and the other two are `DeskRecordScreen`
   * and `CallsScreen`. A row each screen imported for itself would be a row no
   * route owns and three places to forget it.
   */
  nav: React.ReactNode;
  /**
   * REQUIRED and NULLABLE, and never defaulted to the sample content. Two
   * separate reasons, and the second is the one that blocked PR #653.
   *
   * A default of WATCH_FIXTURE puts every sample headline in this screen's
   * PRODUCTION client bundle, since a default parameter is a live reference
   * the bundler cannot drop.
   *
   * And null is not the same value as an every-tier-empty shape. This screen
   * was once mounted in production with `stage: "ready"` over empty data, so it
   * told a reader "Nothing on your watchlist yet" when nothing had been read
   * at all. Those are claims about the reader, made with no source. Now there
   * IS a loader (`src/lib/watch-data.ts`), and it hands back null on exactly
   * one condition: no reader to scope the tiers to. The early return below says
   * that and nothing more.
   */
  data: WatchData | null;
  /**
   * Re-read the tiers. Defaults to a router refresh, which is a real retry
   * rather than a control that does nothing: the tiers are supplied by the
   * server component above this one, so refreshing it re-runs the read.
   */
  onRetry?: () => void;
}) {
  const router = useRouter();
  const retry = onRetry ?? (() => router.refresh());
  const [lens, setLens] = useState<WatchLens>("all");

  const tickers = useMemo(
    () =>
      (data?.watchlist ?? [])
        .filter((i) => i.kind === "public")
        .map((i) => i.identifier.toUpperCase()),
    [data],
  );
  const quotes = useQuotes(tickers);

  /**
   * What the add control greys out as already tracked.
   *
   * Folded from the three lists the loader already handed down rather than read
   * again: entries that produced articles, entries that were quiet, and entries
   * whose article read faulted. Between them that is every watchlist row this
   * screen was told about, and no new query is made to build it.
   *
   * It can still be short of the table, because these lists are what the
   * article read answered for. A row it misses is simply not greyed; the reader
   * taps it and the API answers with its own duplicate sentence, which the
   * wrapper draws. Under-greying costs a round trip. Over-greying would tell a
   * reader they already track something they do not, so the incomplete
   * direction is the safe one.
   */
  const trackedIdentifiers = useMemo(
    () =>
      data === null
        ? []
        : [
            ...data.watchlist.map((i) => i.identifier),
            ...data.quietNames,
            ...data.watchlistCouldNotRead,
          ],
    [data],
  );

  const loading = stage === "loading";
  const stale = stage === "stale";

  /* No reader, no tiers. This is an EARLY RETURN on purpose: below this line
     TypeScript knows `data` is non-null, so no later reader needs a guard and
     no later edit can reintroduce the sample content, or the empty data, by
     leaving the prop off. That omission is exactly how `/ledger` shipped an
     invented brief (PR #670).

     This is NOT an empty state and NOT a per-tier failure. Both of those are
     drawn below, off real reads. This one branch says the screen could not
     work out whose watchlist to read, which is the only thing it knows. */
  if (data === null) {
    return (
      <div
        data-parity="watch"
        data-watch-state="no-reader"
        className={styles.enter}
        style={{
          backgroundColor: "var(--c-bg)",
          minHeight: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {nav}
        <WatchMasthead segment={segment} />
        {/* STILL CENTRED, and this is the one branch that is. The block below
            distributes its free space across the seams the layout already has,
            which is what stops a short screen reading as a hole under the
            masthead. This branch has no seams: one notice, nothing above it and
            nothing below it, so there is nothing to distribute into and a
            weighted split would collapse into the same two lumps. A single
            block centred in the free space is a composition; the same block
            left dangling under the masthead is the defect PR #710 shipped on
            `/claim` (415px, 49.1% of the viewport).

            IT IS ALSO NOT REACHABLE ON A DEVELOPMENT SERVER, so nothing about
            it is stated here as measured. It needs a signed-out PRODUCTION
            build, and `src/proxy.ts` redirects that request to `/auth` before
            this component runs. What can be said from the code is that it draws
            one notice under the masthead and nothing else, which is the
            shortest body on this screen by a distance and leaves far more free
            space than any weighting could place inside the 15% gate. The
            per-entry failure branch is unreachable for its own reason: it needs
            a database error, and the sample content's `watchlistCouldNotRead`
            is empty. Both are named rather than tabulated. */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: `18px ${PAD} 24px`,
          }}
        >
          {/* The section names itself in both halves. This branch used to say
              "whose watchlist" on a screen that also drew what the reader
              follows; now each section is its own route, so the sentence can
              name the one thing that was not read instead of the pair. */}
          <WatchNotice
            heading={
              segment === "watchlist"
                ? "Could not work out whose watchlist to read."
                : "Could not work out whose follows to read."
            }
            body={
              segment === "watchlist"
                ? "Your session did not resolve, so nothing was read. This is not an empty watchlist, and nothing you track has been lost."
                : "Your session did not resolve, so nothing was read. This is not an empty follow list, and nothing you follow has been lost."
            }
            onRetry={retry}
          />
        </div>
        <TabBarClearance />
      </div>
    );
  }

  const visible = data.watchlist.filter((i) => matchesLens(i, lens));
  /* Per-tier failure, because one tier failing says nothing about the other.
     `stage === "error"` stays as a whole-screen override so the runtime audit
     can still reach both notices at once. */
  const watchlistFailed = stage === "error" || data.watchlistRead === "failed";
  const followingFailed = stage === "error" || data.followingRead === "failed";
  /* Follows that produced coverage, which is the count this line and the tail
     below both speak in. It is neither the cluster count nor the story count:
     a cluster is a theme, several follows can land in one, and one follow can
     produce several stories. The loader knows this number. */
  const coverage = data.followsWithCoverage;
  /* Quiet names are hidden under the private and industries lenses, matching
     `setWatch` in the prototype: neither lens carries a name that could be
     quiet, so the line would describe a set the screen is not showing. */
  const quietVisible =
    (lens === "all" || lens === "public") && data.quietNames.length > 0;
  const followRows = data.following.reduce((n, c) => n + c.rows.length, 0);

  /* A section with no cards and no rows. Reported on the root so a test and a
     measurement script can name the state they are looking at; the slack
     distribution below does not depend on it.

     SCOPED TO THE SECTION BEING DRAWN. This used to require both tiers to be
     empty, which was right when both were on one screen and is wrong now: with
     the sections split, a populated watchlist would have reported the
     Following route "populated" while it drew nothing at all. The attribute
     has to describe what is on the screen, or it is worse than absent. */
  const sparse =
    segment === "watchlist"
      ? watchlistFailed || visible.length === 0
      : followingFailed || followRows === 0;

  /* LOADING IS ITS OWN NAME, and it outranks the other two.
     `sparse` is computed off `data`, which under `stage: "loading"` is whatever
     the caller had before the read settled. So a loading screen drawing nothing
     but skeletons reported "populated", which is the one thing an attribute
     whose whole job is to name the state must not do. Measured at
     `/watch?stage=loading`. The tri-state discipline this screen is built on is
     that a read in flight is not an answer; the attribute now says so too. */
  const watchState = loading ? "loading" : sparse ? "sparse" : "populated";

  const followingEmpty =
    coverage === 0 &&
    data.followsQuiet === 0 &&
    data.followsMuted === 0 &&
    data.followsCouldNotCheck.length === 0;

  return (
    <div
      data-parity="watch"
      data-watch-state={watchState}
      /* The skeletons are aria-hidden, so without this a screen reader gets
         two section headings with nothing under either and no signal that
         anything is on its way. */
      aria-busy={loading || undefined}
      className={styles.enter}
      style={{
        backgroundColor: "var(--c-bg)",
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {nav}
      <Slack grow={SLACK_LEAD} />
      <WatchMasthead segment={segment} />

      {/* THE SLACK IS SPREAD ACROSS THE LAYOUT'S OWN SEAMS, not dumped in one
          place. This replaces `justifyContent: center` on this block, and the
          reason centring was here in the first place still stands: omitting a
          whole tier plus a hero without reflowing is how PR #710 shipped 415px
          of dead screen on `/claim`, 49.1% of the viewport. So the short states
          still absorb their free space rather than piling it under the last
          notice. What changed is WHERE.

          Centring has two lumps and only two, and the masthead is in neither.
          Measured on the empty state at 390x844: 785px root, 548px of content,
          237px of free space, split into a 134px hole between the masthead and
          the first section rule and a 204px tail. The masthead stayed pinned to
          the top while the rules floated in the middle, which is the part that
          read as unfinished. Both lumps also sat over the 15% gate on their own.

          Four weighted `Slack` blocks take that free space instead: above the
          masthead, above the first section rule, between the two tiers, and
          below the last notice. The weights are the arithmetic. 237px at
          3:8:1 across the root gives the lead 59px, this block 158px and the
          tail 20px, and this block splits its 158px equally between its two
          seams. Against the 844px viewport that is 7.7% lead, 11.5% and 12.4%
          interior, 12.2% trailing, every one of them inside the gate, where
          centring measured 15.9% and 24.1%. Re-measured numbers for all four
          states are in the PR body.

          THE TAIL WEIGHT IS THE SMALLEST ON PURPOSE, because the tail is the
          only gap that starts in a hole. `#main-content` already carries
          `padding-bottom: var(--mobile-tabbar-height)`, measured at 59px, and
          the fixed bar sits at top 785 in an 844 viewport, so the 59px
          clearance block below plus this block's own 24px is 83px of structural
          gap under every state, short or tall. 83px is 9.8% of the viewport and
          it is the floor the 15% gate is measured against, which leaves the
          tail 43px of headroom where every other seam has over 100.

          A TALL STATE IS UNTOUCHED, for the same reason centring was safe on
          one: a `Slack` is `flex-basis: 0`, so with no free space to distribute
          it is 0px high and the block lays out exactly as it did. Measured on
          the populated state, whose root is 1319px: lead, both seams and the
          tail are unchanged from before this edit. */}
      <div
        style={{
          flex: `${SLACK_BODY} 1 auto`,
          display: "flex",
          flexDirection: "column",
          padding: `18px ${PAD} 24px`,
        }}
      >
        {stale ? (
          <WatchNotice
            body={`Last checked ${data.lastCheckedLabel}. Today's pass has not run yet, so everything below is the last reading rather than this morning's.`}
            onRetry={retry}
            retryLabel="Check again"
          />
        ) : null}

        {/* ── watchlist ──────────────────────────────────────────────── */}
        {/* ONE SECTION PER ROUTE. The two blocks below are unchanged inside;
            what changed is that exactly one of them is ever drawn, and which
            one is decided by the route rather than by the scroll position.

            The section rule stays even with one section on the screen. It
            carries the count, and the count is the only place a reader is told
            how much of their list produced anything this week. */}
        {segment === "watchlist" ? (
        <>
        <SectionRule
          label="watchlist"
          /* Both halves are read off what the screen is actually drawing under
             the active lens. `data.watchlist.length` here said "5 with news"
             over a single card once Private was selected, which reads as a
             broken filter, and the quiet half described a set the lens hides. */
          count={
            loading || watchlistFailed
              ? undefined
              : quietVisible
                ? `${visible.length} with news · ${data.quietNames.length} quiet`
                : `${visible.length} with news`
          }
          marginTop={stale ? "22px" : 0}
        />
        <TierStandfirst>
          News about what you watch: names, private companies and industries. Price is the quiet part.
        </TierStandfirst>
        {loading ? <WatchSkeleton rows={4} /> : null}
        {watchlistFailed ? (
          <WatchNotice
            heading="Could not load your watchlist."
            body="This is a loading failure, not an empty watchlist. Nothing you track has been lost."
            onRetry={retry}
          />
        ) : null}
        {!loading && !watchlistFailed ? (
          <>
            {/* A lens over an empty set is four controls that do nothing, so
                the row is drawn only once there is something to filter. */}
            {data.watchlist.length > 0 ? (
              <div
                role="group"
                aria-label="Watchlist filter"
                style={{ marginTop: "11px", display: "flex", flexWrap: "wrap", gap: "12px" }}
              >
                {LENSES.map((l) => (
                  <LensChip
                    key={l.key}
                    label={l.label}
                    active={lens === l.key}
                    onSelect={() => setLens(l.key)}
                  />
                ))}
              </div>
            ) : null}

            {visible.map((item) => (
              <WatchlistCard
                key={item.id}
                item={item}
                quote={quotes[item.identifier.toUpperCase()]}
              />
            ))}

            {data.watchlist.length === 0 &&
            data.quietNames.length === 0 &&
            data.watchlistCouldNotRead.length === 0 ? (
              /* THE COPY CHANGED WITH THE CONTROL. It used to end "are added
                 on the desk", which was true when this screen could not add
                 anything and is now false: they are added here, on the control
                 directly below this notice. A sentence sending a reader to a
                 desk they cannot reach from a phone would be the loop this
                 unit exists to remove, written in prose instead of in an
                 `action`. */
              <WatchNotice body="Nothing on your watchlist yet. Add a name, a private company or an industry and its news arrives here." />
            ) : visible.length === 0 && data.watchlist.length > 0 ? (
              <WatchNotice body="Nothing tracked under this filter yet." />
            ) : null}

            {/* THE PER-ENTRY FAULT. A read that errored is not a name with no
                news, so these names are omitted from the cards AND from the
                quiet line, and named here with the reason instead. Without
                this block a Postgres error on one identifier would be
                indistinguishable from that name having a quiet day, in prose,
                about the reader's own list. */}
            {data.watchlistCouldNotRead.length > 0 ? (
              <WatchNotice
                heading={`Could not read: ${data.watchlistCouldNotRead.join(" · ")}`}
                body="The article read failed for these, so they are left out rather than drawn. They are not quiet and they are not counted quiet."
                onRetry={retry}
              />
            ) : null}

            {quietVisible ? <QuietLine names={data.quietNames} shown={data.quietShown} /> : null}

            {/* THE ADD CONTROL, and it sits inside `!loading && !watchlistFailed`
                on purpose. A tier whose read faulted draws its failure and
                nothing else: offering to add a name underneath a notice saying
                the list could not be read invites a reader to write into a
                surface that cannot show them the result.

                OPEN ON AN EMPTY TIER, CLOSED OTHERWISE. With nothing on the
                list this control is the only useful thing on the screen and a
                closed disclosure would put one tap between the reader and the
                only action there is. With a list drawn, the list is what they
                came for and the control waits under it. */}
            <WatchAdd
              trackedIdentifiers={trackedIdentifiers}
              defaultOpen={data.watchlist.length === 0 && data.quietNames.length === 0}
            />
          </>
        ) : null}
        </>
        ) : null}

        {/* ── following ──────────────────────────────────────────────── */}
        {/* THE SECOND INTERIOR SEAM IS GONE WITH THE SECOND TIER. It sat
            between the two tiers, and with one tier per route there is nothing
            between. The free space it used to take is not lost: the body's
            remaining `Slack grow={1}` above is the only weighted child left
            inside the body, so it now receives the whole of the body's share
            rather than half of it. The 3:8:1 root weights are untouched, which
            is why the lead and the tail measure as they did. Re-measured for
            every state and both sections in the PR body. */}
        {segment === "following" ? (
        <>
        <SectionRule
          label="following"
          count={
            loading || followingFailed
              ? undefined
              : followingCount(coverage, data.followsQuiet, data.followsMuted)
          }
          marginTop="26px"
        />
        <TierStandfirst>This week&apos;s coverage.</TierStandfirst>
        {loading ? <WatchSkeleton rows={5} /> : null}
        {followingFailed ? (
          <WatchNotice
            heading="Could not load what you follow."
            body="This is a loading failure, not an empty feed. Your follows are intact."
            onRetry={retry}
          />
        ) : null}
        {!loading && !followingFailed ? (
          <>
            {data.following.map((cluster, i) => (
              <ThemeCluster key={cluster.id} cluster={cluster} first={i === 0} />
            ))}
            {followingEmpty ? (
              /* NO ACTION, AND THE COPY NO LONGER NAMES A DESTINATION.
                 It used to link to `/radar/following`, which below `md` is now
                 redirected to this very screen, so the link was a circle. The
                 obvious repair is to point it somewhere else, and there is
                 nowhere: `/radar/following` is the only surface in the app that
                 writes a follow, and it is one of the six redirected routes.

                 So the sentence says what is true and stops there. It does not
                 name the desk, because a phone reader cannot reach it; it does
                 not offer a control, because this screen has none to offer; and
                 it does not imply that following is coming. Adding a name to
                 the watchlist is a different table and a different tier, and
                 saying so here would read as an instruction that does not do
                 what it says. */
              <WatchNotice body="You follow nothing yet. Follows are set up on a wider screen." />
            ) : null}
            <FollowingTail
              quiet={data.followsQuiet}
              muted={data.followsMuted}
              couldNotCheck={data.followsCouldNotCheck}
            />
          </>
        ) : null}
        </>
        ) : null}

        {/* ── what is not drawn here ─────────────────────────────────── */}
        {/* NOTHING RENDERS HERE TODAY. `WATCH_OMISSIONS` is empty and
            `OmittedNotes` guards on that, so this line draws no container, no
            rule and no heading, in every stage. The element and the constant
            stay on the owner's instruction: issue #748 makes the `stale` branch
            reachable and something will need to render here again.

            THE STALE GATE IS KEPT, DELIBERATELY, and it is currently guarding
            nothing. It was added because the staleness note contradicted the
            "Last checked <time>" line the stale notice draws directly above it,
            and that note is now gone, so today `{stale ? null : ...}` and a
            bare `<OmittedNotes />` are indistinguishable.

            It is kept because issue #748 is the work that refills this, and issue #748 is
            precisely the work that makes this screen date its own readings. The
            note most likely to come back here is therefore the one most likely
            to collide with that line, and rediscovering the collision from a
            rendered contradiction is worse than carrying four characters of
            guard.

            IT IS NOTE-SPECIFIC AND MUST BE RE-DECIDED, not inherited. This
            encodes "no omission note in the stale stage", which was true of one
            note rather than of the block. An entry about something other than
            dating would be suppressed here for no reason. Whoever refills the
            array decides whether the gate still applies; it is not a rule about
            omissions, it is a fact about one that no longer exists. */}
        {stale ? null : <OmittedNotes />}

        {/* THE FREE SPACE, TAKEN BELOW THE CONTENT RATHER THAN ABOVE IT. This
            is the seam that used to sit between the two tiers. With one section
            per route the only honest place for the body's share is after the
            last block: put it above the content and a short section renders as
            a masthead, a hole, and a notice pressed against the bottom.

            A `Slack` is `flex-basis: 0`, so on a section with enough content to
            fill the viewport it is 0px high and the layout is exactly what it
            would be without it. Only the short states move. */}
        <Slack grow={1} />
      </div>

      <Slack grow={SLACK_TAIL} />
      <TabBarClearance />
    </div>
  );
}

/**
 * Free space, taken deliberately rather than left over.
 *
 * `flex-basis: 0` with an explicit grow is the whole of it: with free space to
 * distribute the block takes its weighted share, and with none it is 0px high
 * and the layout is exactly what it was. That is what lets one set of weights
 * serve a 785px empty screen and a 1319px populated one without a branch.
 *
 * `flex-shrink: 0` because a `Slack` has nothing to shrink and must never be
 * asked to absorb an overflow that belongs to the content.
 *
 * Empty and `aria-hidden`, so a screen reader walks from the masthead to the
 * first section rule with nothing between them.
 */
function Slack({ grow }: { grow: number }) {
  return <div aria-hidden="true" style={{ flex: `${grow} 0 0`, minHeight: 0 }} />;
}

/** "3 with coverage · 2 quiet · 1 muted". Muted only when there are muted. */
function followingCount(coverage: number, quiet: number, muted: number): string {
  const parts = [`${coverage} with coverage`, `${quiet} quiet`];
  if (muted > 0) parts.push(`${muted} muted`);
  return parts.join(" · ");
}

/** The one-line note under each section rule. Same type on both tiers. */
function TierStandfirst({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: "8px 0 0",
        font: `400 11.5px/1.5 ${FONT_SANS}`,
        color: "var(--c-muted)",
      }}
    >
      {children}
    </p>
  );
}

/**
 * Title and standfirst. Drawn once and shared by every branch, so they cannot
 * drift into two different mastheads.
 *
 * The gutter is applied ONCE, here and on the body below, never on both an
 * ancestor and a descendant. A doubled gutter measures a 310px text column
 * where the design draws 350px at 390.
 *
 * Neither string is a claim about the reader. They describe what the screen is
 * for, which is true whether or not anything was read.
 */
function WatchMasthead({ segment }: { segment: "watchlist" | "following" }) {
  return (
    <div style={{ flex: "none", padding: `6px ${PAD} 0` }}>
      <h1
        style={{
          margin: 0,
          font: `700 26px/1.14 ${FONT_DISPLAY}`,
          letterSpacing: "-0.02em",
          color: "var(--c-ink)",
        }}
      >
        {/* THE SECTION, NOT THE SURFACE. The row above already says Radar and
            says which of its four sections is lit, so a masthead reading
            "Radar" spent the largest type on the screen repeating it. Naming
            the section is also what stops this screen reading as a renamed
            watchlist: the reader is told they are in one of four places, not
            in the whole thing.

            Written as a literal rather than read out of `RADAR_TAB_LABEL`,
            deliberately. The words are the same by construction and the test
            holds them together, but this is a headline and the table is a
            navigation label; a shared constant would weld a 26px display
            headline to a 12px nav word and the next person to want one changed
            would have to change both. */}
        {segment === "watchlist" ? "Watchlist" : "Following"}
      </h1>
      <p
        style={{
          margin: "8px 0 0",
          font: `400 12.5px/1.5 ${FONT_SANS}`,
          color: "var(--c-secondary)",
        }}
      >
        {/* ONE SENTENCE, AND IT IS NOT A DESCRIPTION. The section rule below
            already carries a standfirst describing what the tier holds, and
            repeating it here would spend the top of the screen saying the same
            thing twice at two sizes.

            What this line says instead is the thing only the four-section
            structure makes sayable: these two sections are the ungraded half
            of Radar and the two beside them are the graded half. A reader
            arriving from Calls or Desk record needs that, and before those two
            sections existed on this surface there was nothing to distinguish
            from. It is a claim about the product, never about the reader, so
            it needs no read behind it and is true in every state. */}
        Nothing in this section is ever graded.
      </p>
    </div>
  );
}

/* ── watchlist ──────────────────────────────────────────────────────── */

function LensChip({
  label,
  active,
  onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={styles.bare}
      style={{
        flex: "none",
        minHeight: "44px",
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        borderRadius: "6px",
        whiteSpace: "nowrap",
        border: active ? "1px solid var(--c-ink)" : "1px solid var(--c-border)",
        font: active ? `600 12px/1 ${FONT_SANS}` : `500 12px/1 ${FONT_SANS}`,
        color: active ? "var(--c-ink)" : "var(--c-secondary)",
        backgroundColor: active ? "var(--c-surface)" : "transparent",
      }}
    >
      {label}
    </button>
  );
}

/**
 * Every watchlist entry. Three type branches, one card shape.
 *
 * There is no second shape. The design promotes one entry to a pinned-espresso
 * hero carrying "today's strongest story", and nothing in the schema ranks a
 * reader's names against each other. Deriving the winner from `published_at`
 * would present a timestamp as a judgement, so the promotion is not made.
 */
function WatchlistCard({ item, quote }: { item: WatchlistItem; quote?: WatchQuote }) {
  const shape = {
    marginTop: "10px",
    width: "100%",
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
    padding: "13px 14px",
    border: "1px solid var(--c-border)",
    borderRadius: "12px",
    backgroundColor: "var(--c-card)",
  } as const;

  const body = (
    <>
      <Badge item={item} />
      <div style={{ minWidth: 0, flex: 1 }}>
        {/* A name carries its move beside it on a baseline row, once the quote
            lands. A private company and an industry carry no price at all, and
            the design draws their qualifier as one plain line rather than a row
            of one. A name whose quote has not landed, or did not answer, draws
            that same plain line: nothing, rather than a number that might be
            wrong. */}
        {quote ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ font: `600 11px/1 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
              {item.qualifier}
            </span>
            <span
              style={{
                font: `400 11px/1 ${FONT_MONO}`,
                color: quote.direction === "down" ? "var(--c-redink)" : "var(--c-greenink)",
              }}
            >
              {quote.move}
            </span>
          </div>
        ) : (
          <div style={{ font: `600 11px/1 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
            {item.qualifier}
          </div>
        )}
        <p
          style={{
            margin: "6px 0 0",
            font: `600 14px/1.35 ${FONT_DISPLAY}`,
            color: "var(--c-ink)",
            textWrap: "pretty",
          }}
        >
          {item.headline}
        </p>
        <p
          style={{
            margin: "6px 0 0",
            font: `400 11px/1.4 ${FONT_SANS}`,
            color: "var(--c-muted)",
          }}
        >
          {item.source}
        </p>
      </div>
    </>
  );

  /* WHERE THE CARD GOES IS NOT DECIDED HERE, and that is the whole design of
     it. `item.href` arrives from the loader, which PROVED it against
     `companies` before setting it (`src/lib/watch-links.ts`). This component
     runs in the browser and cannot check anything, so it renders a destination
     rather than inventing one.

     WHAT CHANGED. Every card was a `<button>` with `onClick={() => {}}`, on the
     stated grounds that neither destination existed. Half of that expired:
     `/company/[id]` shipped in PR #721. This was also the only path from a
     phone reader's own watchlist to Company Intel, and it was not connected.

     WHY IT IS PROVED RATHER THAN BUILT. The obvious version, `/company/` plus
     the identifier, tells a reader with BRK.B on their list that Berkshire
     Hathaway is not on Signalera, over a company with 540 corpus mentions. The
     resolver's ticker regex rejects the dot. So a card links only when the
     route's own reconstruction has been shown to land, and draws as a plain
     card otherwise. An unlinked card is a card; a card that lands on the miss
     surface is a false claim about the reader's own list, which is the thing
     `watch-data.ts` spends its header refusing to make.

     TODO, see #643: open the industry signal. `/signal` is step 10 and still
     does not exist, so an industry never carries an href.

     A REAL ANCHOR, never a button with a router push. It gives back long press,
     open in a new tab and the status-bar preview, and it is what
     `watch-notice.tsx` already does for the two desk links on this screen.
     Nothing is lost with the `<button>`: the card carried no handler, no
     `aria-pressed` and no disabled state, so `styles.bare` is the whole of what
     it was, and the same class resets the anchor. `text-decoration` is the one
     thing that reset does not cover, so the anchor turns it off inline. */
  if (item.href === null) return <div style={shape}>{body}</div>;

  return (
    <Link href={item.href} prefetch={false} className={styles.bare} style={{ ...shape, textDecoration: "none" }}>
      {body}
    </Link>
  );
}

function Badge({ item }: { item: WatchlistItem }) {
  if (item.kind === "public") {
    return (
      <span
        style={{
          flex: "none",
          minWidth: "38px",
          height: "36px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 7px",
          borderRadius: "6px",
          backgroundColor: "var(--c-green-surface)",
          font: `700 13px/1 ${FONT_MONO}`,
          color: "var(--c-oninv)",
        }}
      >
        {item.badge}
      </span>
    );
  }
  if (item.kind === "private") {
    return (
      <span
        style={{
          flex: "none",
          height: "36px",
          display: "inline-flex",
          alignItems: "center",
          font: `600 15px/1 ${FONT_DISPLAY}`,
          color: "var(--c-ink)",
        }}
      >
        {item.badge}
      </span>
    );
  }
  return (
    <span
      style={{
        flex: "none",
        height: "36px",
        display: "inline-flex",
        alignItems: "center",
        padding: "0 9px",
        borderRadius: "6px",
        backgroundColor: "var(--c-gold)",
        font: `600 10.5px/1 ${FONT_SANS}`,
        letterSpacing: "0.06em",
        color: "var(--c-ongold)",
      }}
    >
      {item.badge}
    </span>
  );
}

/**
 * Quiet is a real answer, and a distinct state both from an empty watchlist and
 * from a read that did not answer. The loader keeps all three apart; a name
 * whose read faulted never reaches this line.
 *
 * The names are underlined and are not controls, exactly as the design draws
 * them. The desktop source links each one to /watchlist/<identifier>; an inline
 * anchor in an 11.5px prose line cannot carry a 44px target without moving the
 * text, and the inline-citation carve-out is for citations. Recorded as a
 * deviation rather than taken.
 */
function QuietLine({ names, shown }: { names: string[]; shown: number }) {
  const head = names.slice(0, shown);
  const more = names.length - head.length;
  return (
    <p
      style={{
        margin: "12px 0 0",
        font: `400 11.5px/1.6 ${FONT_SANS}`,
        color: "var(--c-muted)",
        textWrap: "pretty",
      }}
    >
      No news {RECENCY_LABEL}:{" "}
      {head.map((n, i) => (
        <Fragment key={n}>
          {i > 0 ? " · " : null}
          <span style={{ textDecoration: "underline", textUnderlineOffset: "2px" }}>{n}</span>
        </Fragment>
      ))}
      {more > 0 ? ` · +${more} more` : null}
    </p>
  );
}

/* ── following ──────────────────────────────────────────────────────── */

function ThemeCluster({ cluster, first }: { cluster: FollowCluster; first: boolean }) {
  return (
    <div style={{ marginTop: first ? "12px" : "18px" }}>
      {/* The heading is drawn only when there is a real label. Cluster names
          are null until a lazy model pass writes them, and an empty uppercase
          rule over a list of stories is worse than no rule at all. */}
      {cluster.label ? (
        <h3
          style={{
            margin: 0,
            paddingBottom: "6px",
            borderBottom: "1px solid var(--c-border)",
            font: `600 11px/1.3 ${FONT_SANS}`,
            letterSpacing: "0.12em",
            color: "var(--c-secondary)",
          }}
        >
          {cluster.label}
        </h3>
      ) : null}
      {/* A FOLLOW ROW IS NOT A CONTROL, and that is the design rather than a
          shortfall. Every row was a `<button>` with `onClick={() => {}}`,
          carrying a TODO, see #643. `/story` still does not exist, measured:
          `/story` and `/story/abc` both 404. What changed is that the row
          stopped claiming to be tappable while it waits.

          THE PROTOTYPE ALREADY DRAWS THIS. `Signalera Mobile v3.dc.html`
          draws three following rows and only two are controls; line 729 is an
          inert row with identical padding, hairline and type. The two live
          rows point at `goSignal` and `goDeals`, never at a story surface, and
          `/signal` is step 10, which is the same reason `watch-links.ts`
          leaves an industry card unlinked.

          WHAT IT COST. 82 no-op tab stops measured across four real accounts,
          worst case 37 consecutive dead stops in one uninterrupted run because
          the list is deliberately uncapped. The e2e account has zero follows,
          so the defect was invisible to the suite that guards this screen.

          NOTHING IS LOST, and this was measured rather than assumed. All 850
          computed properties were enumerated on this row, on main and on this
          branch, in both themes. NINE MOVE. An earlier version of this comment
          said two, which is exactly the shortlist-presented-as-exhaustive that
          a change arguing "nothing moves" cannot afford. `cursor: pointer`
          becomes `auto`, which is the false affordance itself. `text-align:
          left` becomes the inherited `start`. `unicode-bidi: normal` becomes
          `isolate`. And six border style longhands, the three physical sides
          plus their three logical aliases, go `none` to `solid`.

          ONLY THE CURSOR PAINTS. The document's `direction` is `ltr` and no
          element on the page carries a `dir`, so `start` resolves to `left`
          and the bidi isolation has nothing to isolate. Every box, font,
          colour, padding, gap and border is identical: row `350x76.78`,
          headline `350x37.78`, meta `350x10`, in both themes. Every `:hover`
          rule in `globals.css` is class or attribute scoped, so not one ever
          matched a bare row either.

          THE BORDER STYLES ARE LATENT RATHER THAN INERT, which is the one
          thing here worth knowing before editing this row. They fail to paint
          only because the top, leading and trailing border widths are all
          `0px`. `styles.bare` set `border: 0`, which zeroed every width AND
          set the style to `none`; a plain div
          zeroes nothing and inherits `solid`. So a `border-width` introduced
          anywhere up the cascade would now paint on three sides where it
          previously could not, and the bottom hairline this row draws on
          purpose would silently gain neighbours. If you add a border here,
          name the sides you do not want.

          Each headline is fully rendered static text with nothing clipped, so
          a screen reader reads it identically and stops announcing "button"
          over something that is not one. `width: 100%` goes with the button
          because it is redundant on a block element.

          WHEN A DESTINATION EXISTS. `matchFollow` already returns `url` and
          `primary_company` on every row and the loader discards both, so
          giving these rows somewhere to go is a change in `watch-data.ts`, not
          a bare button restored here. */}
      {cluster.rows.map((row) => (
        <div
          key={row.id}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            padding: "12px 0",
            borderBottom: "1px solid var(--c-hair)",
          }}
        >
          <p
            style={{
              margin: 0,
              font: `500 13.5px/1.4 ${FONT_SANS}`,
              color: "var(--c-ink)",
              textWrap: "pretty",
            }}
          >
            {row.headline}
          </p>
          {row.meta ? (
            <p
              style={{
                margin: 0,
                font: `400 10px/1 ${FONT_MONO}`,
                letterSpacing: "0.07em",
                color: "var(--c-muted)",
              }}
            >
              {row.meta}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

const tailCopy = {
  margin: "14px 0 0",
  font: `400 11.5px/1.55 ${FONT_SANS}`,
  color: "var(--c-muted)",
  textWrap: "pretty",
} as const;

/**
 * The tail lines, and the one place this screen refuses the design's copy.
 *
 * The prototype asserts "That is an empty week, not a failed load". That
 * sentence is true only when every follow was actually checked. The desktop
 * source separates a follow whose match query errored from a quiet one for
 * precisely this reason, and without that separation the screen states, out
 * loud, something it does not know. So when a follow could not be checked the
 * claim is withdrawn and the failures are named.
 *
 * MUTED IS A THIRD STATE and gets its own sentence. `radar/following/page.tsx`
 * lines 196 to 201 count a muted follow as quiet; a muted follow was never
 * matched, so it has no coverage answer either way, and saying it had none is a
 * claim with nothing behind it.
 */
function FollowingTail({
  quiet,
  muted,
  couldNotCheck,
}: {
  quiet: number;
  muted: number;
  couldNotCheck: string[];
}) {
  if (quiet === 0 && muted === 0 && couldNotCheck.length === 0) return null;
  const unchecked = couldNotCheck.length > 0;
  /* The count decides the noun as well as the number. A figure read from state
     drags its grammar with it, and "The other one follows" is the shape that
     bug takes if only the number is derived. */
  const subject = quiet === 1 ? "The other follow" : `The other ${spell(quiet)} follows`;
  const mutedSentence =
    muted === 1
      ? "One follow is muted, so it was not checked at all."
      : `${sentenceCase(spell(muted))} follows are muted, so they were not checked at all.`;
  return (
    <>
      {quiet > 0 ? (
        <p style={tailCopy}>
          {unchecked
            ? `${subject} had no coverage this week.`
            : `${subject} had no coverage this week. That is an empty week, not a failed load; your follows are intact.`}
        </p>
      ) : null}
      {muted > 0 ? <p style={tailCopy}>{mutedSentence}</p> : null}
      {unchecked ? (
        <WatchNotice
          heading={`Could not check: ${couldNotCheck.join(" · ")}`}
          body="Matching failed for these. This is an error, not an empty result, and they are not counted as quiet."
        />
      ) : null}
    </>
  );
}

/**
 * What Radar does not draw, and why, at the foot of the screen. Currently:
 * nothing, and the block is kept anyway.
 *
 * THE RULING: omit silently unless absence would mislead. All four of this
 * screen's absences now clear that bar in the silent direction, so
 * `WATCH_OMISSIONS` is empty and this draws nothing. `omissions.ts` carries the
 * per-entry reasoning and the owner's argument for the last one to go, which is
 * that a note explaining the store is undated is a CAPTION ON A WRONG SENTENCE
 * rather than a correction: "No news today" does not become true because
 * something downstairs withdrew it.
 *
 * KEPT RATHER THAN DELETED, on the owner's instruction: "keep the mechanism
 * with an empty array and a comment saying why, rather than deleting it. issue #748
 * will make the stale branch reachable and something will need to render." So
 * this is a live component with no data, not dead code, and the empty case is
 * a guard rather than an accident.
 *
 * WHAT THE COPY HAS TO BE IF ANYTHING COMES BACK. The register is used well in
 * two other places on this screen: the per-entry fault notice names the
 * identifiers and then says "They are not quiet and they are not counted
 * quiet", and `FollowingTail` withdraws its own claim when a follow could not
 * be checked. Both CORRECT A RENDERED FIGURE, which is the bar. Flat, specific,
 * about the product. `tailCopy` is the surface, the quieter of the two, because
 * an absence is not a fault and the notice surface is for faults.
 *
 * The heading is a heading and not a `SectionRule`: a rule with a label and a
 * hairline is this screen's shape for A TIER, and a tier is the one thing this
 * block must not look like.
 */
function OmittedNotes() {
  /* NOTHING TO SAY MEANS NOTHING DRAWN, and that has to be a guard rather than
     a trusted consequence of `.map` over an empty array. Without it the section
     still renders: a 26px top margin, a hairline rule and an "NOT SHOWN HERE"
     heading with no content under it, which is a section rule promising a tier
     that is not there. That is a worse screen than the four notes were.

     The guard is on the DATA being empty, not on a stage or a read, so it is
     still not an empty state. Verified in the DOM: with `WATCH_OMISSIONS` empty
     the screen contains no `section[aria-labelledby="watch-omitted"]` at all. */
  if (WATCH_OMISSIONS.length === 0) return null;

  return (
    <section
      aria-labelledby="watch-omitted"
      style={{
        marginTop: "26px",
        paddingTop: "16px",
        borderTop: "1px solid var(--c-border)",
      }}
    >
      <h2
        id="watch-omitted"
        style={{
          margin: 0,
          font: `600 11px/1.3 ${FONT_SANS}`,
          letterSpacing: "0.12em",
          color: "var(--c-secondary)",
        }}
      >
        NOT SHOWN HERE
      </h2>
      {WATCH_OMISSIONS.map((o) => (
        <p key={o.id} style={tailCopy}>
          <span style={{ fontWeight: 600, color: "var(--c-body)" }}>{o.absent}.</span>{" "}
          {o.reason}
        </p>
      ))}
    </section>
  );
}

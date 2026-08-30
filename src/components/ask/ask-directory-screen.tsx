"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import styles from "./ask.module.css";
import {
  AskAnswerNotice,
  AskDestinationRow,
  AskLookupRow,
  AskNotice,
  AskSectionRule,
  CONTENT_BOX,
  IconAssistant,
  IconDeals,
  IconFeed,
  IconTrends,
  PAD,
} from "./ask-parts";
import {
  ASK_DIRECTORY,
  ASSISTANT_HREF,
  ASSISTANT_LABEL,
  CHIP_PROMPTS,
  type DirectoryId,
} from "./ask-data";
import { useAskSearch } from "./use-ask-search";
import {
  ASK_SHOWN,
  belowMinimumLine,
  directoryLine,
  pendingLine,
  searchBlurb,
  type AskSearchRow,
} from "@/lib/ask-search";
import type { AskCounters } from "@/lib/ask-counters";
import type { AskCompaniesLoad } from "@/lib/ask-companies-data";
import { FONT_DISPLAY, FONT_SANS } from "@/components/mobile/fonts";

/**
 * Browse. Directory first, field at the top. One screen, no second one.
 *
 * THE FIELD REACHES THE CORPUS NOW, AND THAT IS WHAT CHANGED HERE LAST.
 * It used to run `String.includes` over the fifty rows the server had already
 * put in this payload, against a corpus of thousands. Under one percent of it.
 * The probe that settles it is `starbucks`, a company the corpus carries with a
 * ticker and hundreds of mentions: typing its name returned nothing. The copy
 * said so honestly ("Nothing beyond this list was searched"), which is exactly
 * why copy could not fix it. A reader only ever read that sentence after
 * already failing, and it confirmed the ceiling rather than offering a way past
 * it. The field now queries `GET /api/companies?q=`, debounced, and
 * `src/lib/ask-filter.ts` is deleted along with the substring match.
 *
 * FOUR STATES THIS SCREEN HAS NEVER HAD. Both of the directory's states used to
 * be resolved on the server before a byte was sent, which is why the note below
 * says there is no skeleton here. A fetch adds pending, failed, stale and race.
 * They are handled in `use-ask-search.ts` and drawn here, and none of them
 * draws a skeleton: the rows already on screen stay while a search is in
 * flight, one line of copy carries the state, and that line waits out the
 * ordinary case before it appears so it cannot flash.
 *
 * WHAT THIS REPLACED, and why the shape changed rather than the copy. The Ask
 * pole root drew a heading, an intro, a rule, three 95px destination rows
 * carrying one word each, a notice explaining that their figures had no source,
 * a second rule, a 52px intro, six 57px company rows, two prompt chips wrapped
 * onto two lines, and a pinned composer with a 48px send button. Measured at
 * 390x844 on a production build, the scroll region was `clientHeight` 497
 * against `scrollHeight` 886 and ZERO company rows cleared the fold. The pole
 * that owns Company Intel could not show a reader a company without a scroll.
 *
 * THE FIVE MOVES, in the order they pay:
 *
 *   1. NOTHING IS PINNED TO THE BOTTOM except the tab bar. The composer and the
 *      chip row are gone from the bottom chrome, which is what buys the room.
 *   2. THE FIELD MOVES TO THE TOP. It filtered the payload when that move
 *      shipped; it searches the corpus now, and the note at the top of this
 *      file is the record of why. No model call and no submit moment either
 *      way.
 *   3. THE DIRECTORY BECOMES THE SCREEN, directly under the field, rather than
 *      a section under a heading below three destinations.
 *   4. SECTOR DEMOTES to an inline tail, so a company row loses its second line.
 *   5. THE DESTINATIONS DEMOTE to one line each and carry a REAL figure with
 *      the window it covers spelled beside it.
 *
 * THE FIELD SEARCHES ON A POLE NOW CALLED BROWSE, AND THAT IS STILL A WATCH
 * ITEM, THOUGH A SMALLER ONE. The pole was named Ask when this note was
 * written, and a search field under that word promised an answer it never
 * gave. The rename takes half of that away: a field on a pole called Browse
 * that reaches the company corpus is doing the thing its pole is named for.
 * What is left is the reader who types a question into it anyway. They get
 * companies whose names contain the words of that question, and a block saying
 * this screen does not answer. That is the honest behaviour rather than the
 * ideal one, and it is deliberately NOT
 * pre-solved: no mode toggle, no segmented control, no "did you mean to ask?"
 * affordance, and NO SECOND CONTROL. The field is right; what was wrong was its
 * promise, and the promise is what moved.
 *
 * RULING 20 (`DECISIONS.md:249`), AND HOW THIS SATISFIES IT.
 * An answer block must never be a server render of `?q=`. The measurement
 * behind the ruling: `next/link` prefetched four full RSC renders of
 * `/ask?q=...` with zero interaction, and `prefetch={false}` does not close it,
 * because a shared link, a reload or a back press all server-render the same
 * route. Three properties keep it closed here, and all three are structural:
 *
 *   - NOTHING LINKS TO `/ask?q=`. There is no such `next/link` anywhere in the
 *     repo any more, so the RSC prefetch has nothing to walk to.
 *   - THE URL IS READ, NEVER WRITTEN. `?q=` seeds the field once, on mount.
 *     Typing updates React state and never the address bar, so no keystroke can
 *     produce a navigation, a history entry or a render.
 *   - THE SERVER READ DOES NOT TAKE `q`. `loadAskCompanies` and
 *     `loadAskCounters` have no query parameter in their signatures, so the
 *     server does identical work for every value of `?q=`, and no model is
 *     called on any path the framework can reach.
 *
 * There is no answer block to server-render, because the answer screen is gone.
 *
 * THE FIELD NOW MAKES A CLIENT FETCH, AND THAT IS WHAT THE RULING PRESCRIBES
 * RATHER THAN WHAT IT FORBIDS. Its title is "the Ask answer is a CLIENT FETCH
 * ... never a server read of `?q=`", and the harm it measured was a model call
 * reached by prefetch: `gemini-embedding-001` plus `gemini-2.5-flash` fired
 * with no interaction, burning 2 of a reader's 15 daily messages before the
 * cache was even checked. `GET /api/companies` imports `getSupabaseWithUser`
 * and `normalizeLookupKey`, calls no model, and has no per-user budget. All
 * three properties above are unchanged: the fetch writes nothing to the URL,
 * so no keystroke produces a navigation the prefetcher can walk.
 *
 * ONE CLAUSE OF THE RULING IS OPEN AND IS NOT RESOLVED HERE. It says "behind an
 * explicit submit", and a debounce is not a submit. It is in the PR body for
 * the owner to rule on; if that clause is read as universal rather than as a
 * property of the model call it was written about, this becomes a submit and
 * `ASK_SEARCH_DEBOUNCE_MS` goes away.
 */

const ICONS: Record<DirectoryId, ReactNode> = {
  deals: IconDeals,
  trends: IconTrends,
  feed: IconFeed,
};

/**
 * The intro names the two things a reader can do here, in the order the screen
 * offers them. It is one sentence because the field is directly under it and a
 * paragraph above a field is a delay.
 */
const INTRO = "Search every company, or ask the assistant.";

/**
 * What the field says it does, and it is the same string twice on purpose: the
 * label is the accessible name and the placeholder is the visible one, and a
 * control whose two names disagree reads as two different controls. There is no
 * label drawn above it, which is what keeps a 16px field from inverting the
 * hierarchy against the 26px title.
 *
 * IT SAID "Filter companies" AND THAT WAS ACCURATE ABOUT A DEFECT. The field
 * filtered fifty rows; the label described the filter; a reader read a true
 * sentence and still could not reach Starbucks. The mechanism moved first, and
 * the label moved with it rather than instead of it.
 *
 * WHY THIS STRING AND NOT A LONGER ONE. "any" carries the reach in one word.
 * "name or ticker" carries the match rule, which is the whole of the honesty
 * budget here: the search is a plain substring over two columns, so naming them
 * is also the promise NOT to forgive a misspelling. It fits a 390 gutter at
 * 16px without ellipsis, which a sentence naming the corpus size would not; the
 * figure is carried by the section line below, where there is room for it.
 */
const FIELD_LABEL = "Search any company or ticker";


const ANSWER_NOTICE = {
  heading: "Not answered on this screen yet.",
  body: "The research assistant answers from the same intelligence, theses and briefings today.",
  action: { href: ASSISTANT_HREF, label: "Open the research assistant" },
};

export function AskDirectoryScreen({
  companies,
  counters,
}: {
  /**
   * The company directory read, resolved on the server by `src/app/ask/page.tsx`.
   * Required, with no default: this block has a real source in every
   * environment, so a missing prop is a type error rather than a quietly empty
   * screen.
   */
  companies: AskCompaniesLoad;
  /** The three destination figures, read on the server. Also required. */
  counters: AskCounters;
}) {
  /* Read once, on mount, and never written back. See the Ruling 20 note above:
     writing `?q=` as the reader types would put a navigable URL back on this
     route and hand the prefetcher the thing it was measured walking to. */
  const seeded = useSearchParams().get("q") ?? "";
  const [query, setQuery] = useState(seeded);

  /* The one request this screen makes. Debounced, race-guarded, aborted on
     supersede, and never issued under two characters. No model is called on
     this path; see the Ruling 20 note above and `ask-search.ts`. */
  const { state, pendingVisible } = useAskSearch(query);

  const typing = query.trim().length > 0;
  const standing = companies.data;
  const corpusTotal = companies.corpusTotal;

  /* WHICH ROWS ARE DRAWN, and the only branch that ever empties the list is a
     search that answered with nothing. A pending search keeps whatever is
     already on screen: the previous answer if there is one, the standing
     directory if there is not. */
  const searched = state.kind !== "off";
  let rows: AskSearchRow[] | null;
  if (state.kind === "ready") {
    rows = state.rows;
  } else if (state.kind === "pending") {
    rows = state.held?.rows ?? standing?.slice(0, ASK_SHOWN) ?? null;
  } else if (state.kind === "error") {
    rows = null;
  } else {
    rows = standing?.slice(0, ASK_SHOWN) ?? null;
  }

  /* The one line under the section rule, and every state gets its own sentence.
     A failed SEARCH is not drawn here at all; it takes the notice branch below,
     because "could not be read" and "there is nothing here" are different
     facts and this codebase keeps them in different shapes. */
  let line: string | null;
  if (state.kind === "ready") {
    line = searchBlurb(state, corpusTotal);
  } else if (state.kind === "pending") {
    /* Nothing is SAID about the wait until it has outlasted the ordinary case.
       Until then the standing sentence holds, and which sentence that is
       follows the rows that are still drawn: the previous answer's own
       sentence, or the directory line when there has not been one yet. */
    line = pendingVisible
      ? pendingLine(state.query, corpusTotal)
      : state.held
        ? searchBlurb(state.held, corpusTotal)
        : directoryLine(corpusTotal);
  } else if (state.kind === "error") {
    line = null;
  } else if (typing) {
    line = belowMinimumLine(corpusTotal);
  } else {
    line = directoryLine(corpusTotal);
  }

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
          Browse
        </h1>
        <p style={{ margin: "8px 0 0", font: `400 12.5px/1.5 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
          {INTRO}
        </p>
      </div>

      {/* NOT A FORM, and that is the point. A filter has no submit moment, so
          there is nothing for a form to submit and no send control beside the
          field: a submit button would promise a navigation that does not
          happen. Enter does nothing, which is correct, because the list has
          already narrowed by the time a reader could press it. */}
      <div style={{ flex: "none", padding: `12px ${PAD} 14px` }}>
        <label htmlFor="ask-filter" className="sr-only">
          {FIELD_LABEL}
        </label>
        <input
          id="ask-filter"
          name="q"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={styles.field}
          placeholder={FIELD_LABEL}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            ...CONTENT_BOX,
            display: "block",
            width: "100%",
            minHeight: "48px",
            padding: "0 15px",
            border: "1px solid var(--c-border)",
            borderRadius: "12px",
            backgroundColor: "var(--c-surface)",
            /* 16px, without exception. iOS Safari zooms the viewport on focus
               of any control under 16px, on iPhone and iPad alike, and the zoom
               does not undo itself: the reader is left on a magnified page with
               the layout pushed sideways. The app's viewport meta is
               `width=device-width, initial-scale=1` with no `user-scalable=no`
               and no `maximum-scale`, which is correct and stays that way.

               THE SIZE LIVES IN THIS INLINE `font:` SHORTHAND, which is why no
               stylesheet could reach it. An inline style beats every rule in
               every sheet, so a global 16px floor would be overridden here and
               nowhere else, silently. It has to change at the declaration. */
            font: `400 16px/1 ${FONT_SANS}`,
            color: "var(--c-ink)",
          }}
        />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: `18px ${PAD} 24px` }}>
        {/* The one block that changes with `?q=`. Anything typed: the screen
            says plainly that it does not answer, and the assistant is a
            full-width 44px action instead of a 126x14 inline link. Empty
            field: NOTHING, and that is the change. This slot used to hold a
            45px jump row carrying the assistant above the company directory.
            The assistant is a browse destination now, last in that list, so a
            row here would be the same destination twice on one screen. */}
        {typing ? (
          <AskAnswerNotice
            heading={ANSWER_NOTICE.heading}
            body={ANSWER_NOTICE.body}
            action={ANSWER_NOTICE.action}
          />
        ) : null}

        <AskSectionRule label="company intel" style={{ marginTop: "20px" }} />

        {/* STILL NO SKELETON, AND NOW THAT IS A DECISION RATHER THAN A FACT
            ABOUT THE ROUTE. The standing directory is a server read awaited
            before a byte is sent, so it cannot be observed mid-flight; the
            SEARCH can. What it never does is replace real rows with drawn
            ones: a pending search leaves the rows that are already there and
            changes one line of copy, and it waits out the ordinary case
            (`ASK_PENDING_VISIBLE_AFTER_MS`) before it changes even that. A
            skeleton here would be a drawing of a load, not a load.

            THE TWO FAILED READS ARE SEPARATE SENTENCES, because they are
            separate facts. A search that could not run says so; a server read
            that could not run says so; neither is allowed to render as "there
            is nothing here". */}
        {state.kind === "error" ? (
          <AskNotice>
            The search for “{state.query}” did not run. This is a failed request and not an empty
            result: no company has been ruled out of coverage, and the answer is missing rather than absent.
          </AskNotice>
        ) : rows === null ? (
          <AskNotice>
            The company directory did not load. This is a failed read and not an empty one: no company has
            been ruled out of coverage, and the rows are missing rather than absent.
          </AskNotice>
        ) : (
          <>
            {line !== null ? (
              <p
                style={{
                  margin: "8px 0 0",
                  font: `400 11.5px/1.5 ${FONT_SANS}`,
                  color: "var(--c-muted)",
                  textWrap: "pretty",
                }}
              >
                {line}
              </p>
            ) : null}
            {/* An empty SEARCH result is the sentence above and no rows. It is
                not a notice, because nothing failed: the corpus was read and it
                carries no such name, which the sentence says outright along
                with the reason a misspelling would land here. */}
            {rows.length === 0 && !searched ? (
              <AskNotice>The read answered with no companies, so there is nothing to list here yet.</AskNotice>
            ) : null}
            {rows.map((company, i) => (
              <AskLookupRow
                key={company.id}
                href={company.href}
                ticker={company.ticker}
                name={company.name}
                detail={company.detail}
                /* Searched rows do not prefetch. One keystroke over
                   forty-nine linked rows already fired eight RSC prefetches of
                   company pages, and a result set moves with every keystroke.
                   The standing six keep the framework default: they are the
                   same six on every visit and they are what a reader taps. */
                prefetch={searched ? false : undefined}
                first={i === 0}
                last={i === rows.length - 1}
              />
            ))}
          </>
        )}

        {/* FOUR ROWS, AND THE FOURTH IS THE ASSISTANT. The owner's ruling:
            Intelligence gets its own row, and 3px past the fold at 390 against
            rescuing 320 from 2-of-3 to 3-of-4 is a trade worth taking.

            IT IS LAST, MEASURED RATHER THAN CHOSEN. Any other position pushes
            Live Feed off the fold at 375 and 390 instead, which trades a row
            nothing counts for a row with a real figure on it.

            IT IS NOT IN `ASK_DIRECTORY` AND MUST NOT BE. That table is typed
            `DirectoryId`, which is kept in sync with `AskCounterId` in
            `ask-counters.ts`, and `AskCounters` is `Record<AskCounterId,
            AskCounter>`. A fourth id there would make tsc demand a counter
            entry for a count that has no source, and the only way to satisfy
            it would be `figure: null`, which already means a FAULTED read.
            Two different absences would then render identically and say the
            same thing in the types. The row simply carries no `count` prop,
            so the shape has no figure slot to fill wrongly. */}
        <AskSectionRule label="browse" style={{ marginTop: "24px" }} />
        {ASK_DIRECTORY.map((route, i) => (
          <AskDestinationRow
            key={route.id}
            href={route.href}
            label={route.label}
            icon={ICONS[route.id]}
            count={counters[route.id]}
            first={i === 0}
          />
        ))}
        <AskDestinationRow
          href={ASSISTANT_HREF}
          label={ASSISTANT_LABEL}
          icon={IconAssistant}
          last
        />

        <AskSectionRule label="prompts" style={{ marginTop: "24px" }} />
        {/* ONE ROW, NOT TWO. At 11.5px with 12px of side padding the pair needs
            roughly 490px and the gutter gives 350, so wrapping cost a second
            46px line and 112px of fixed chrome under a 497px window. `nowrap`
            with a horizontal scroll keeps both sourced prompts, leaves the
            second chip half visible at the right edge to signal the scroll, and
            hands 56px back for a one-line change. */}
        <div className={styles.chips}>
          {CHIP_PROMPTS.map((prompt) => (
            <Link
              key={prompt}
              href={ASSISTANT_HREF}
              style={{
                ...CONTENT_BOX,
                flex: "none",
                minHeight: "44px",
                display: "flex",
                alignItems: "center",
                padding: "0 12px",
                border: "1px solid var(--c-border)",
                borderRadius: "9px",
                backgroundColor: "var(--c-surface)",
                font: `400 11.5px/1 ${FONT_SANS}`,
                color: "var(--c-secondary)",
                whiteSpace: "nowrap",
                textDecoration: "none",
              }}
            >
              {prompt}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

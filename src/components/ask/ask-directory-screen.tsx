"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import styles from "./ask.module.css";
import {
  AskAnswerNotice,
  AskDestinationRow,
  AskJumpRow,
  AskLookupRow,
  AskNotice,
  AskSectionRule,
  CONTENT_BOX,
  IconDeals,
  IconFeed,
  IconTrends,
  PAD,
} from "./ask-parts";
import { ASK_DIRECTORY, ASSISTANT_HREF, CHIP_PROMPTS, type DirectoryId } from "./ask-data";
import { ASK_SHOWN, filterAskCompanies, filterBlurb } from "@/lib/ask-filter";
import type { AskCounters } from "@/lib/ask-counters";
import type { AskCompaniesLoad } from "@/lib/ask-companies-data";
import { FONT_DISPLAY, FONT_SANS } from "@/components/mobile/fonts";

/**
 * Ask. Directory first, field at the top. One screen, no second one.
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
 *   2. THE FIELD MOVES TO THE TOP AND FILTERS. It narrows the rows the server
 *      already read, on the client, as the reader types. No endpoint, no second
 *      query, no model call, and no submit moment.
 *   3. THE DIRECTORY BECOMES THE SCREEN, directly under the field, rather than
 *      a section under a heading below three destinations.
 *   4. SECTOR DEMOTES to an inline tail, so a company row loses its second line.
 *   5. THE DESTINATIONS DEMOTE to one line each and carry a REAL figure with
 *      the window it covers spelled beside it.
 *
 * THE FIELD FILTERS ON A POLE CALLED ASK, AND THAT IS A KNOWN WATCH ITEM. A
 * reader who types a question into a field labelled "Filter companies" gets a
 * filtered list and a block saying this screen does not answer. That is the
 * honest behaviour rather than the ideal one, and it is deliberately NOT
 * pre-solved: no mode toggle, no segmented control, no "did you mean to ask?"
 * affordance. The label says what the field does, the assistant sits one
 * deliberate tap below it, and the confusion is something to look for in
 * testing rather than to design around before it has been seen.
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
const INTRO = "Filter the directory below, or ask the assistant.";

/**
 * What the field says it does, and it is the same string twice on purpose: the
 * label is the accessible name and the placeholder is the visible one, and a
 * control whose two names disagree reads as two different controls. There is no
 * label drawn above it, which is what keeps a 16px field from inverting the
 * hierarchy against the 26px title.
 *
 * IT NAMES THE FILTER, NOT THE POLE. "Ask Signalera" or "Search Signalera"
 * would both promise something this field does not do. It filters companies, so
 * it says so, and the owner's ruling is explicit that the honest label goes on
 * and the confusion gets watched for rather than pre-solved.
 */
const FIELD_LABEL = "Filter companies";

/**
 * The directory's standing copy, drawn when nothing is typed.
 *
 * The ordering is stated HERE, once, rather than as a figure on every row: a
 * mention count beside each name invites reading the column as a ranking of
 * importance, which a count of articles is not.
 */
const DIRECTORY_INTRO =
  "Named most often across the coverage Signalera has ingested. Each row opens its primer, filings and financials.";

const ANSWER_NOTICE = {
  heading: "Not answered on this screen yet.",
  body: "The research assistant answers from the same intelligence, theses and briefings today.",
  action: { href: ASSISTANT_HREF, label: "Open the research assistant" },
};

const JUMP_LABEL = "Put a question to the research assistant";

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

  const filtering = query.trim().length > 0;
  const rows = companies.data;
  const matched = rows === null ? null : filterAskCompanies(rows, query);
  /* Every match when the reader is filtering, the standing six when not. */
  const visible = matched === null ? null : filtering ? matched : matched.slice(0, ASK_SHOWN);

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
        {/* The one block that changes with `?q=`, and it changes between two
            pieces of standing copy rather than between a screen and a screen.
            Empty field: the assistant is one row away. Anything typed: the
            screen says plainly that it does not answer, and the same assistant
            is a full-width 44px action instead of a 126x14 inline link. */}
        {filtering ? (
          <AskAnswerNotice
            heading={ANSWER_NOTICE.heading}
            body={ANSWER_NOTICE.body}
            action={ANSWER_NOTICE.action}
          />
        ) : (
          <AskJumpRow href={ASSISTANT_HREF} label={JUMP_LABEL} />
        )}

        <AskSectionRule label="company intel" style={{ marginTop: "20px" }} />

        {/* THERE IS NO SKELETON HERE. `/ask` is a server component and both
            reads are awaited before a byte of the screen is sent, so a reader
            can never observe this block mid-flight. A skeleton for a state that
            cannot be reached is a drawing of a load, not a load. */}
        {rows === null ? (
          <AskNotice>
            The company directory did not load. This is a failed read and not an empty one: no company has
            been ruled out of coverage, and the rows are missing rather than absent.
          </AskNotice>
        ) : rows.length === 0 ? (
          <AskNotice>The read answered with no companies, so there is nothing to list here yet.</AskNotice>
        ) : (
          <>
            <p
              style={{
                margin: "8px 0 0",
                font: `400 11.5px/1.5 ${FONT_SANS}`,
                color: "var(--c-muted)",
                textWrap: "pretty",
              }}
            >
              {/* The second sentence of the filtered copy is the load-bearing
                  one. The filter narrowed a list of fifty rows and says so; it
                  does not claim to have searched the corpus, and it makes no
                  typo-tolerance promise, because a substring match over fifty
                  names cannot keep one. */}
              {filtering ? filterBlurb(matched?.length ?? 0) : DIRECTORY_INTRO}
            </p>
            {visible?.map((company, i) => (
              <AskLookupRow
                key={company.id}
                href={company.href}
                ticker={company.ticker}
                name={company.name}
                detail={company.detail}
                first={i === 0}
                last={i === visible.length - 1}
              />
            ))}
          </>
        )}

        <AskSectionRule label="browse" style={{ marginTop: "24px" }} />
        {ASK_DIRECTORY.map((route, i) => (
          <AskDestinationRow
            key={route.id}
            href={route.href}
            label={route.label}
            icon={ICONS[route.id]}
            figure={counters[route.id].figure}
            window={counters[route.id].window}
            first={i === 0}
            last={i === ASK_DIRECTORY.length - 1}
          />
        ))}

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

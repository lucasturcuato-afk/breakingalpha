"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./ask.module.css";
import { CONTENT_BOX, PAD } from "./ask-parts";
import { FONT_SANS } from "@/components/mobile/fonts";

/**
 * The chip row and the composer, byte identical on both Ask screens in the
 * design, so one extraction with no variant axis.
 *
 * WHERE THE TWO CONTROLS GO, AND WHY THEY GO TO DIFFERENT PLACES.
 *
 * Both used to navigate to `/ask?q=`, which draws the answer screen, which
 * answers "This surface does not answer yet." Measured end to end on a
 * production build. So every tap on this row made a promise the next screen
 * broke, and the fix is a destination, not a wording.
 *
 * THE FIELD GOES TO `/search?q=`, which is what the design draws. The comment
 * this one replaces recorded the divergence and gave its reason: `/search` "is
 * a different unit and does not exist yet". It exists now
 * (`src/app/search/page.tsx`), it renders in production, and its jump rows,
 * Company Intel among them, are live. That reason has expired.
 *
 * The deciding argument is not the design though, it is the text. This is a
 * field: a reader types words into it and presses send. `/search` reads `?q=`,
 * seeds its own field from it and keys its screen on it. `/intelligence` reads
 * no query parameter at all, and giving it one means editing another unit's
 * route, so the typed words would be dropped on arrival. A field that takes
 * words and hands them to a surface which cannot receive them is the same
 * broken promise in a new place.
 *
 * What that costs, logged here and not fixed here: `/search`'s entity half has
 * no source, so it says plainly that nothing was searched rather than drawing
 * an empty result, and it mounts no `AppShell`, so the tab bar is absent there
 * (DECISIONS.md open item O2). Its Cancel comes back. The field's own copy
 * therefore names a destination and claims no result, which is what actually
 * happens.
 *
 * THE CHIPS GO TO `/intelligence`, because their text is not a search term, it
 * is a question, and `/intelligence` is the surface that answers questions.
 * These strings are that route's own `SUGGESTED_PROMPTS`, copied verbatim, and
 * it renders them as buttons on its empty state (`IntelligenceChat.tsx:212`),
 * so a reader who taps "Which sectors show the most momentum?" here arrives on
 * a screen offering that exact prompt. The words survive the tap as a control
 * rather than as a query string, which is why no `?q=` is needed to carry them.
 *
 * A SIDE EFFECT WORTH NAMING: nothing on the browse screen navigates to
 * `/ask?q=` any more, so the four unprompted RSC prefetches of the answer
 * screen recorded in DECISIONS.md Ruling 20 no longer originate there. That
 * does NOT retire the ruling. The answer screen is still reachable by URL, by
 * reload and by a shared link, and the ruling governs how it may ever be
 * wired: a client fetch behind an explicit submit, never a server read of
 * `?q=`. This unit did not wire it and did not go near it.
 */

/** The Search screen, seeded with what the reader typed. */
function searchHref(query: string): string {
  return `/search?q=${encodeURIComponent(query)}`;
}

/**
 * What the field says it does, and it is the same string twice on purpose: the
 * label is the accessible name and the placeholder is the visible one, and a
 * control whose two names disagree reads as two different controls.
 *
 * It names a DESTINATION and claims no result. "Search companies and deals"
 * would claim a search that runs; the entity half of `/search` has no source
 * yet, and this field is not the place to find that out.
 */
const FIELD_LABEL = "Search Signalera";

export function AskComposer({ prompts }: { prompts?: readonly [string, string] }) {
  const router = useRouter();
  const [value, setValue] = useState("");

  return (
    <>
      <div
        style={{
          flex: "none",
          display: "flex",
          flexWrap: "wrap",
          gap: "10px",
          padding: `10px ${PAD} 0`,
        }}
      >
        {(prompts ?? []).map((prompt) => (
          <Link
            key={prompt}
            href="/intelligence"
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const q = value.trim();
          if (!q) return;
          router.push(searchHref(q));
          /* The field does not clear itself. Measured on the running page while
             both halves lived on `/ask`: submitting from the answer left the
             last question in the field, because `/ask?q=a` to `/ask?q=b` is a
             same-pathname navigation and PageTransition keys on pathname; and
             submitting from browse left it too, because this composer is the
             same element type in the same position in both trees, so React
             reconciled it rather than remounting it. Both left the question
             sitting under a cursor as though it had not been sent. The field's
             destination is a different pathname now, so the second case cannot
             arise from browse; the clear stays because the answer screen still
             mounts this component and the first case is unchanged. */
          setValue("");
        }}
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: "9px",
          padding: `12px ${PAD} 14px`,
        }}
      >
        <label htmlFor="ask-composer" className="sr-only">
          {FIELD_LABEL}
        </label>
        <input
          id="ask-composer"
          name="q"
          type="text"
          autoComplete="off"
          className={styles.field}
          placeholder={FIELD_LABEL}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{
            ...CONTENT_BOX,
            flex: 1,
            minWidth: 0,
            minHeight: "48px",
            padding: "0 15px",
            border: "1px solid var(--c-border)",
            borderRadius: "12px",
            backgroundColor: "var(--c-surface)",
            /* 16px, where the design draws 13. iOS Safari zooms the viewport on
               focus of any control under 16px, and the zoom does not undo
               itself: the reader is left on a magnified page with the layout
               pushed sideways. The app's viewport meta is `width=device-width,
               initial-scale=1` with no `user-scalable=no` and no
               `maximum-scale`, which is correct and stays that way. Adding
               either would suppress the symptom by taking pinch-zoom off the
               whole app, which is worse for exactly the readers who need it.

               THE SIZE LIVES IN THIS INLINE `font:` SHORTHAND, which is why no
               stylesheet could have reached it. An inline style beats every
               rule in every sheet, so a global 16px floor would have been
               overridden here and nowhere else, silently. It has to change at
               the declaration.

               Nothing needs rebalancing around it. This is a lone field with no
               label drawn above it, inside a 48px box that already had the
               room, so the 3px is absorbed by the line box. The other sub-16px
               controls in the product are a scale decision and are untouched. */
            font: `400 16px/1 ${FONT_SANS}`,
            color: "var(--c-ink)",
          }}
        />
        <button
          type="submit"
          aria-label={FIELD_LABEL}
          style={{
            flex: "none",
            width: "48px",
            height: "48px",
            borderRadius: "12px",
            backgroundColor: "var(--c-inverse)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            cursor: "pointer",
          }}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--c-gold)"
            strokeWidth="1.9"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 19V5M6 11l6-6 6 6" />
          </svg>
        </button>
      </form>
    </>
  );
}

"use client";

/**
 * EmptyState (PR-E1) -- route-level empty state for un-indexed companies.
 *
 * Trigger: src/app/company/[id]/page.tsx renders this inside LiveMoodShell
 * when getCompanyDetail() returns null. Visual mirrors docs/DirectionD.jsx
 * lines 1204-1236 (centered editorial card): 56px gold-faint circle icon,
 * serif headline (max-width 480), sans body, two inline CTAs.
 *
 * The DirectionD mono metric strip is intentionally omitted -- it is not
 * in the PR-E1 testid manifest and the data (last-indexed / sources-checked
 * / watchlist-count) is not yet wired through to the route.
 *
 * a11y:
 *  - role="region" + aria-labelledby targets the headline wrapper.
 *  - THE HEADLINE IS TWO ELEMENTS, and the reason is the route's invariant
 *    rather than styling. The route header states it: one visible `h1` at
 *    every width, with the subordinate head stepping to `h2` wherever the
 *    shell's own head is also on screen. The hit branch gets that for free
 *    because it carries two trees and `md:hidden` puts one of them inside
 *    `display:none`. THIS BRANCH HAS NO SECOND TREE, so the same rule has to
 *    be spelled on the heading itself: `h1` below `md`, where the route's
 *    `mobileFullBleed` has dropped the shell's "Company Intel" head, and `h2`
 *    at `md` and above, where that head is back and this card sits under it.
 *
 *    An earlier version of this comment said "h1 is the only h1 on the page in
 *    this branch (header is gone)". THAT WAS FALSE AT EVERY WIDTH, measured on
 *    a production build at 375, 390, 430 and 1024 in both themes: the shell
 *    head was never gone here, because page.tsx rendered this branch WITHOUT
 *    `mobileFullBleed`, so both heads were on screen and the enumeration came
 *    back ["Company Intel", "<name> isn't on Signalera yet."] at all four
 *    widths. The flag now ships, which fixes the pair below `md` and leaves it
 *    standing above `md`; the split below is what fixes it there.
 *
 *    The id and the testid sit on the WRAPPER, not on either heading, so both
 *    stay attached to an element that is on screen at every width. Accessible
 *    name computation skips `display:none` descendants that are not themselves
 *    the referenced node, so the region's name is the one heading on screen
 *    rather than the pair concatenated.
 *  - Primary CTA receives focus on mount; both CTAs have focus-visible rings.
 *  - The back control is `md:hidden`. Below `md` this branch owns the whole
 *    viewport and the shell draws no head, so without it a reader who arrived
 *    from the directory has the tab bar and nothing else. At `md` and above the
 *    sidebar and topbar are back and the hit branch carries no back control
 *    either, so neither does this one.
 *
 *    IT IS A COPY OF `company-intel-screen.tsx`'s back control, deliberately,
 *    and this is the one place a copy is the smaller change. That control is
 *    ~30 lines inline inside a screen this unit does not otherwise touch, so
 *    extracting it would mean editing the hit branch to serve the miss branch.
 *    `src/components/mobile/screen-chrome.tsx` already exports a `BackHeader`,
 *    but it takes an `href` and this control has to step through history, and a
 *    sibling unit is making that component history-aware right now. Building a
 *    second history-aware back header would be that unit's work done twice.
 *    When it lands, BOTH this control and the hit branch's should be replaced
 *    by it in one edit rather than either of them growing a private variant.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { EmptyStateCTA } from "./EmptyStateCTA";

const SERIF = "var(--font-display), Georgia, serif";
const SANS = "var(--font-inter), Inter, sans-serif";

/* One object, two elements, so the type ramp cannot drift between the `h1` and
   the `h2` when only the tag is supposed to differ. NO `display` KEY HERE:
   `md:hidden` and `hidden md:block` do the gating, and an inline `display`
   beats a class at every breakpoint, which is design-lint's rule 10 and the
   defect that shipped the tab bar to desktop once already. */
const HEADLINE_STYLE = {
  fontFamily: SERIF,
  fontSize: 24,
  fontWeight: 700,
  margin: 0,
  letterSpacing: "-0.015em",
  color: "var(--espresso)",
} as const;

interface Props {
  canonical: string;
}

export function EmptyState({ canonical }: Props) {
  const ctaRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  useEffect(() => {
    ctaRef.current?.focus();
  }, []);

  /* The {" "} is load-bearing: this repo's SWC strips the leading space of JSX
     text that follows an expression container, which rendered
     "Coca Colaisn't ..." in production. */
  const headline = (
    <>
      {canonical}{" "}isn&apos;t on Signalera yet.
    </>
  );

  return (
    <div className="bg-cream">
      <div
        className="flex items-center md:hidden"
        style={{
          flex: "none",
          minHeight: 48,
          padding: "0 16px",
          borderBottom: "1px solid var(--c-border)",
        }}
      >
        <button
          type="button"
          data-testid="company-empty-state-back"
          onClick={() => router.back()}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          style={{
            minHeight: 44,
            display: "flex",
            alignItems: "center",
            gap: 6,
            font: `500 13px/1 ${SANS}`,
            color: "var(--c-secondary)",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
          }}
        >
          {/* Drawn here rather than through the shared Chevron, for the reason
              the hit branch draws its own: that component has no left direction
              and no 16px size. */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
            style={{ flex: "none" }}
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
          Back
        </button>
      </div>

      <div className="p-4" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <section
          role="region"
          aria-labelledby="company-empty-state-headline"
          data-testid="company-empty-state"
          /* PADDING LIVES IN CLASSES NOW, and it had to MOVE rather than gain a
             `md:` twin. It was `padding: "48px 56px"` in the style object, and
             an inline style beats every class, so no `md:` utility could have
             reached it. On the 358px card a 390 viewport gives, 112px of that
             padding left 244px of content: the two CTAs measured 118.8 and
             117.2 with an 8px gap against those 244, so BOTH wrapped onto two
             lines. The desktop pair is unchanged, and at 1024 the card is 772px
             wide where the 48/56 was always right. */
          className="px-5 py-6 md:px-14 md:py-12"
          style={{
            background: "var(--cream-hi)",
            border: "1px solid var(--border-base)",
            /* 10 was off this repo's 4/6/9/12/14 radius scale. */
            borderRadius: 12,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 12,
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              background: "var(--gold-faint)",
              border: "1px solid var(--gold-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: SERIF,
              fontSize: 24,
              fontWeight: 700,
              color: "var(--gold-deep)",
            }}
          >
            -
          </div>
          <div
            id="company-empty-state-headline"
            data-testid="company-empty-state-headline"
            style={{ maxWidth: 480 }}
          >
            <h1 className="font-display md:hidden" style={HEADLINE_STYLE}>
              {headline}
            </h1>
            <h2 className="font-display hidden md:block" style={HEADLINE_STYLE}>
              {headline}
            </h2>
          </div>
          <p
            style={{
              fontFamily: SANS,
              fontSize: 14,
              lineHeight: 1.6,
              color: "var(--text-muted)",
              margin: 0,
              maxWidth: 480,
            }}
          >
            {/* Never a sentence about the reader: this said "Add it to YOUR
                watchlist". Both affordances survive and the first one now names
                the same object the primary CTA names. */}
            We haven&apos;t indexed any qualifying coverage for this company. Add
            it to the watchlist for an alert the moment something publishes, or
            search the directory for a different name or ticker.
          </p>
          <EmptyStateCTA ref={ctaRef} canonical={canonical} />
        </section>
      </div>
    </div>
  );
}

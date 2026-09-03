"use client";

/**
 * PrimerBusinessOverview (Coverage Primer)
 *
 * Renders a factual business description: the live provider profile summary
 * (Yahoo assetProfile) when available, else the curated COMPANY_IDENTITY
 * description, else the stored Wikipedia lead paragraph. The parent only
 * renders this section when a description exists, so there is no placeholder
 * branch: a company with none of the three hides the section entirely.
 * Informational only.
 *
 * THE WIKIPEDIA BRANCH IS VERBATIM AND THE TYPE SYSTEM ENFORCES IT.
 *
 * A Wikipedia lead paragraph is reproduced under CC BY-SA 4.0 section
 * 2(a)(1)(A). ShareAlike, section 3(b), fires only "if You Share Adapted
 * Material You produce", and section 1(a) defines Adapted Material as material
 * that is translated, altered, arranged, transformed or otherwise modified. Any
 * trim, ellipsis or model rewrite converts a one-line attribution obligation
 * into an obligation to publish Signalera's own identity prose under CC BY-SA.
 *
 * So the wikipedia branch carries `VerbatimText`, a branded string only
 * `asVerbatim()` can mint. `.slice()`, `.substring()`, `.trim()`, `.replace()`
 * and template interpolation all return plain `string` and stop type-checking
 * on that branch. There is no `maxLength` prop, no truncation and no ellipsis
 * on this path. The paragraph renders at whatever length it is and the layout
 * absorbs it: normal flow, `text-wrap: pretty`, no clamp, no fixed height.
 *
 * The other branches are Signalera's own or the provider's and carry no such
 * constraint, so the caller may hand them pre-trimmed text.
 */

import type { IdentityArtifact } from "@/lib/company-identity";
import { CC_BY_SA_4_0_URL, attributionParts } from "@/lib/company-identity";

interface PrimerBusinessOverviewProps {
  /** Resolved artifact. Always present; the parent hides the section otherwise. */
  identity: IdentityArtifact;
}

export function PrimerBusinessOverview({ identity }: PrimerBusinessOverviewProps) {
  return (
    <section
      data-testid="primer-business-overview"
      data-identity-source={identity.source}
      className="bg-cream-hi border border-border-base rounded-lg p-4 space-y-2"
    >
      <h3 className="font-sans text-[9.5px] font-bold text-text-faint">
        Business overview
      </h3>
      <p
        data-testid="primer-business-overview-text"
        className="font-sans text-[13px] text-text-secondary leading-relaxed text-pretty"
      >
        {identity.text}
      </p>
      {identity.source === "wikipedia" ? <Attribution identity={identity} /> : null}
    </section>
  );
}

/**
 * The complete CC BY-SA 4.0 section 3(a) obligation for a verbatim excerpt, in
 * the form Wikimedia's Terms of Use section 7 names: a hyperlink to the page
 * being reused, plus a licensing notice hyperlinked to the licence text. The
 * article's history page enumerates the authors, which is how the first link
 * discharges 3(a)(1)(A)(i).
 *
 * Rendered, visible, not behind a tooltip or a hover. It is one line.
 */
function Attribution({
  identity,
}: {
  identity: Extract<IdentityArtifact, { source: "wikipedia" }>;
}) {
  const { attribution } = identity;
  const parts = attributionParts(attribution);
  return (
    <p
      data-testid="primer-business-overview-attribution"
      className="font-sans text-[10px] text-text-faint"
    >
      {parts.lead}
      <a
        href={attribution.articleUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-text-secondary"
        title={attribution.articleTitle}
      >
        {parts.sourceLabel}
      </a>
      {parts.middle}
      <a
        href={attribution.licenseUrl || CC_BY_SA_4_0_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-text-secondary"
      >
        {parts.licenseLabel}
      </a>
      {parts.tail}
    </p>
  );
}

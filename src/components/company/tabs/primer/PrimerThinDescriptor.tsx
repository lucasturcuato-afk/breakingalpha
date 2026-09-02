"use client";

/**
 * PrimerThinDescriptor (Coverage Primer)
 *
 * A Wikidata short description, rendered as a LABELLED THIN TIER.
 *
 * It is deliberately not PrimerBusinessOverview. That section carries a
 * provider profile summary or a curated brief, and its heading is a promise
 * that what follows is an overview. A Wikidata short description is a category
 * label with a 30-character median across the names that have one, and putting
 * it under the same heading would launder it into the same tier.
 *
 * So it renders under its own heading, with its provenance in the heading
 * itself rather than in a tooltip or an info icon, and the parent mounts it
 * only when there is no real overview to show. It never counts toward the
 * identity pillar: see qualifiesAtParity in src/lib/wikidata-descriptor.ts,
 * which nothing in the UI calls.
 */

import type { WikidataDescriptor } from "@/lib/wikidata-descriptor";

interface PrimerThinDescriptorProps {
  descriptor: WikidataDescriptor;
}

export function PrimerThinDescriptor({ descriptor }: PrimerThinDescriptorProps) {
  return (
    <section
      data-testid="primer-thin-descriptor"
      className="bg-cream-hi border border-border-base rounded-lg p-4 space-y-2"
    >
      <h3 className="font-sans text-[9.5px] font-bold text-text-faint">
        Wikidata description
      </h3>
      <p className="font-sans text-[13px] text-text-secondary leading-relaxed">
        {descriptor.description}
      </p>
      <p className="font-sans text-[9px] text-text-faint">
        One-line description from Wikidata (CC0). Community-maintained, not a filing, and not a
        business overview.
      </p>
    </section>
  );
}

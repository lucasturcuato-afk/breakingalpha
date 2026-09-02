/**
 * Wikidata short descriptions as a LABELLED THIN TIER (read-only).
 *
 * Wikidata's main-namespace structured data is CC0, so a short description may
 * be shown. This module exists to ship it HONESTLY, which means shipping it
 * BELOW the identity pillar rather than as another source of it.
 *
 * WHY IT IS NOT A PILLAR SOURCE, measured on the 306 single-pillar names:
 *   282 have a Wikidata item at all.
 *   277 of those carry a description.
 *   Median description length is 30 characters.
 *   The identity pillar's floor is 74 characters, and exactly 8 of 277 clear it.
 *   Cinven's description, in full, is the single word "company".
 *
 * A 30-character category label is not a business overview. Counting it at
 * parity would move ~275 names over a bar on the strength of the words
 * "investment company", and the page behind the move would say nothing a reader
 * did not already know from the company's name. So `qualifiesAtParity` exists
 * and is the ONLY function that answers the pillar question, it applies the
 * scorer's own 74-character floor, and nothing in the UI calls it.
 *
 * WHAT SHIPS. `fetchWikidataDescriptor` returns the description with a source
 * label attached. The consuming section renders it as a labelled fallback shown
 * only when no real overview exists, so a reader always knows a one-line
 * category came from Wikidata rather than from a filing or a provider profile.
 *
 * The cache table is populated by backend/wikidata.py during entity validation;
 * this is a read of rows that already exist. 202 of the 306 have a non-empty
 * description already sitting in prod.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The scorer's identity floor. A description shorter than this does not
 * describe a business; it names a category.
 */
export const WIKIDATA_PARITY_FLOOR_CHARS = 74;

/**
 * Display floor. Below this the string is a bare noun phrase ("company",
 * "international law firm") and putting it on the page under a heading makes
 * the page look emptier than saying nothing. Deliberately far below the parity
 * floor: this is "is it worth a line of pixels", not "is it a pillar".
 */
export const WIKIDATA_DISPLAY_FLOOR_CHARS = 16;

export interface WikidataDescriptor {
  /** The CC0 short description, verbatim. */
  description: string;
  /** Always "wikidata". Present so the UI cannot render this unlabelled. */
  source: "wikidata";
  /** Character count, so a caller can apply its own floor without recounting. */
  length: number;
}

/**
 * Does this description clear the identity pillar's bar?
 *
 * THE PILLAR QUESTION, AND NOTHING ELSE CALLS IT. Kept exported so the rule is
 * testable and so a future change to the scorer has one place to meet the UI.
 */
export function qualifiesAtParity(descriptor: WikidataDescriptor | null): boolean {
  return descriptor !== null && descriptor.length >= WIKIDATA_PARITY_FLOOR_CHARS;
}

/** Is it long enough to be worth rendering as a labelled thin line? */
export function worthDisplaying(descriptor: WikidataDescriptor | null): boolean {
  return descriptor !== null && descriptor.length >= WIKIDATA_DISPLAY_FLOOR_CHARS;
}

/**
 * Read the cached Wikidata description for a company name.
 *
 * REJECT-SAFE for the same reason fetchRegistryProfile is: this runs inside the
 * company page's Promise.all, where one rejection fails the whole render.
 * Returns null on any failure; a thin fallback is never worth an error state.
 */
export async function fetchWikidataDescriptor(
  supabase: SupabaseClient,
  companyName: string,
): Promise<WikidataDescriptor | null> {
  const name = companyName.trim();
  if (!name) return null;
  try {
    const { data, error } = await supabase
      .from("wikidata_entity_cache")
      .select("wikidata_description")
      .eq("name", name)
      .maybeSingle();
    if (error || !data) return null;
    const description = ((data as { wikidata_description: string | null }).wikidata_description || "")
      .trim();
    if (!description) return null;
    return { description, source: "wikidata", length: description.length };
  } catch {
    return null;
  }
}

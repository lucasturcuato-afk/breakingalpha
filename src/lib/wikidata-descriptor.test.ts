/**
 * Unit tests for the Wikidata thin tier.
 *
 * Run: npm run test:unit
 *
 * The point of these is the boundary, not the plumbing: a Wikidata short
 * description must never satisfy the identity pillar.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  WIKIDATA_DISPLAY_FLOOR_CHARS,
  WIKIDATA_PARITY_FLOOR_CHARS,
  fetchWikidataDescriptor,
  qualifiesAtParity,
  worthDisplaying,
  type WikidataDescriptor,
} from "./wikidata-descriptor";

function descriptor(text: string): WikidataDescriptor {
  return { description: text, source: "wikidata", length: text.length };
}

function stubClient(data: unknown, error?: unknown) {
  return {
    from() {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data, error }),
      };
      return chain;
    },
  } as never;
}

describe("qualifiesAtParity", () => {
  it("rejects the real median description", () => {
    // Median across the 277 single-pillar names that carry one is 30 chars.
    assert.equal(qualifiesAtParity(descriptor("investment management company")), false);
  });

  it("rejects Cinven's actual description", () => {
    // Cinven's Wikidata description, in full, is the single word "company".
    assert.equal(qualifiesAtParity(descriptor("company")), false);
  });

  it("rejects a description one character short of the floor", () => {
    assert.equal(qualifiesAtParity(descriptor("x".repeat(WIKIDATA_PARITY_FLOOR_CHARS - 1))), false);
  });

  it("accepts one at the floor", () => {
    assert.equal(qualifiesAtParity(descriptor("x".repeat(WIKIDATA_PARITY_FLOOR_CHARS))), true);
  });

  it("rejects null", () => {
    assert.equal(qualifiesAtParity(null), false);
  });
});

describe("worthDisplaying", () => {
  it("suppresses a bare category word", () => {
    assert.equal(worthDisplaying(descriptor("company")), false);
    assert.equal(worthDisplaying(descriptor("bank")), false);
  });

  it("shows a description that says something", () => {
    assert.equal(worthDisplaying(descriptor("American private equity firm")), true);
  });

  it("sits far below the parity floor on purpose", () => {
    // Display is "is it worth a line of pixels"; parity is "is it a pillar".
    assert.ok(WIKIDATA_DISPLAY_FLOOR_CHARS < WIKIDATA_PARITY_FLOOR_CHARS);
  });
});

describe("fetchWikidataDescriptor", () => {
  it("labels every descriptor with its source", async () => {
    const d = await fetchWikidataDescriptor(
      stubClient({ wikidata_description: "American private equity firm" }),
      "Thoma Bravo",
    );
    assert.equal(d?.source, "wikidata");
    assert.equal(d?.length, "American private equity firm".length);
  });

  it("returns null for a blank name without reading", async () => {
    assert.equal(await fetchWikidataDescriptor(stubClient(null), "  "), null);
  });

  it("returns null for an empty cached description", async () => {
    assert.equal(
      await fetchWikidataDescriptor(stubClient({ wikidata_description: "   " }), "X"),
      null,
    );
  });

  it("returns null on a read error rather than throwing", async () => {
    assert.equal(await fetchWikidataDescriptor(stubClient(null, { message: "boom" }), "X"), null);
  });
});

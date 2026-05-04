// Unit tests for src/lib/normalize.ts - see docs/w2-a-entity-resolution-design.md section 6.
// Fixtures must stay synchronized with backend/tests/test_normalize.py.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLookupKey } from "./normalize.ts";

test("basic uppercase to lowercase", () => {
  assert.equal(normalizeLookupKey("NVIDIA"), "nvidia");
});

test("dedup hint: NVIDIA / Nvidia / NVIDIA Corp", () => {
  // Same key for first two, distinct for the third. The normalizer alone
  // does not solve dedup; alias mapping is the layer that merges variants.
  assert.equal(normalizeLookupKey("Nvidia"), "nvidia");
  assert.equal(normalizeLookupKey("NVIDIA Corp"), "nvidia corp");
});

test("trademark stripped before NFKC", () => {
  // U+2122 decomposes to "TM" under NFKC and would concatenate.
  assert.equal(normalizeLookupKey("Permag\u2122"), "permag");
});

test("registered symbol stripped", () => {
  assert.equal(normalizeLookupKey("Apple\u00ae"), "apple");
});

test("copyright symbol stripped", () => {
  assert.equal(normalizeLookupKey("Acme\u00a9"), "acme");
});

test("curly apostrophe folded to straight", () => {
  assert.equal(
    normalizeLookupKey("Moody\u2019s Analytics"),
    "moody's analytics",
  );
});

test("straight apostrophe passes through", () => {
  assert.equal(
    normalizeLookupKey("Moody's Analytics"),
    "moody's analytics",
  );
});

test("whitespace stripped", () => {
  assert.equal(normalizeLookupKey("  Tesla  "), "tesla");
});

test("accents preserved (Societe Generale)", () => {
  assert.equal(
    normalizeLookupKey("Soci\u00e9t\u00e9 G\u00e9n\u00e9rale"),
    "soci\u00e9t\u00e9 g\u00e9n\u00e9rale",
  );
});

test("accents preserved (Estee Lauder)", () => {
  assert.equal(
    normalizeLookupKey("Est\u00e9e Lauder"),
    "est\u00e9e lauder",
  );
});

test("typo passes through (APPL stays appl)", () => {
  assert.equal(normalizeLookupKey("APPL"), "appl");
});

test("empty string", () => {
  assert.equal(normalizeLookupKey(""), "");
});

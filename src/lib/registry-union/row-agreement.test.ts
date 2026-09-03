/**
 * Unit tests for rowMatchesRegistrant.
 * Run: npx tsx --test src/lib/registry-union/row-agreement.test.ts
 *
 * The fixtures are the real prod rows the guard was written against, measured
 * on the 2026-09-02 dump. The Envu case is the reason the guard exists.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rowMatchesRegistrant } from "./row-agreement";
import { namesAgree } from "@/lib/name-agreement";

test("the Envu mis-stamp is rejected, and the repo's write gate would have accepted it", () => {
  // companies row b757f7fb: name 'Envu', ticker KVUE, sec_cik 1944048.
  assert.equal(rowMatchesRegistrant("Envu", "Kenvue Inc."), false);
  // Documented, not asserted as desirable: the generous write gate says yes,
  // on a difflib ratio of exactly RATIO_ACCEPT.
  assert.equal(namesAgree("Envu", "Kenvue Inc.").agrees, true);
});

test("real prod rows that must anchor", () => {
  const ok: Array<[string, string]> = [
    ["AMD", "ADVANCED MICRO DEVICES INC"],     // acronym
    ["UPS", "UNITED PARCEL SERVICE INC"],      // acronym
    ["HPE", "Hewlett Packard Enterprise Co"],  // acronym
    ["MUFG", "MITSUBISHI UFJ FINANCIAL GROUP INC"],
    ["Cisco", "CISCO SYSTEMS, INC."],          // leading run
    ["Truist", "TRUIST FINANCIAL CORP"],
    ["JPMorgan", "JPMORGAN CHASE & CO"],
    ["American", "AMERICAN EXPRESS CO"],
    ["PDD", "PDD Holdings Inc."],
    ["Booking Holdings", "Booking Holdings Inc."],
    ["Estee Lauder", "ESTEE LAUDER COMPANIES INC"],
  ];
  for (const [row, reg] of ok) assert.equal(rowMatchesRegistrant(row, reg), true, `${row} / ${reg}`);
});

test("the six correct rows the guard costs are rejected on purpose", () => {
  // Each resolves to nothing today, so rejecting them forgoes a gain rather
  // than causing a regression. Listed here so the price stays visible.
  const cost: Array<[string, string]> = [
    ["IBKR", "Interactive Brokers Group, Inc."],
    ["HWM", "Howmet Aerospace Inc."],
    ["Raytheon", "RTX Corp"],
    ["Disney", "Walt Disney Co"],
  ];
  for (const [row, reg] of cost) assert.equal(rowMatchesRegistrant(row, reg), false, `${row} / ${reg}`);
});

test("two-letter acronyms never agree, and empty names never agree", () => {
  assert.equal(rowMatchesRegistrant("HP", "Helmerich & Payne, Inc."), false);
  assert.equal(rowMatchesRegistrant("", "Kenvue Inc."), false);
  assert.equal(rowMatchesRegistrant(null, "Kenvue Inc."), false);
});

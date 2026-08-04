/**
 * brief-call-related tests. Cases mirror REAL production shapes observed on
 * 2026-08-03: graded Jul-31 calls (NVO, MRNA, AXTI, MSFT), open Jul-30 calls
 * (PPA, XLV, AMG, BAX) and emerging trend clusters whose top_sectors arrive
 * as JSON strings.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  callSectorLabel,
  clusterSectors,
  findNextToWatch,
  sectorsOverlap,
  sectorTokens,
  type EmergingCluster,
  type RelatableCall,
} from "./brief-call-related";

const call = (over: Partial<RelatableCall>): RelatableCall => ({
  id: "id",
  claim_text: "claim",
  target_symbol: null,
  claim_type: "ticker",
  brief_date: "2026-07-31",
  resolve_on: "2026-07-31",
  ...over,
});

const SECTORS: Record<string, string> = {
  NVO: "Healthcare & Biotech",
  MRNA: "Healthcare & Biotech",
  AXTI: "Technology",
  MSFT: "Technology",
  AMG: "Financial Services",
};

test("sectorTokens strips connectors and keeps meaningful words", () => {
  assert.deepEqual([...sectorTokens("Healthcare & Biotech")], ["healthcare", "biotech"]);
  assert.deepEqual([...sectorTokens("Financial Services")], ["financial"]);
  assert.equal(sectorTokens(null).size, 0);
});

test("sectorsOverlap matches Signalera labels against grader vocabulary", () => {
  assert.ok(sectorsOverlap("Healthcare & Biotech", "healthcare"));
  assert.ok(sectorsOverlap("healthcare & biotech", "Healthcare & Biotech"));
  assert.ok(!sectorsOverlap("Technology", "healthcare"));
  assert.ok(!sectorsOverlap("", "healthcare"));
});

test("callSectorLabel resolves tickers via companies and ETFs via the map", () => {
  assert.equal(callSectorLabel(call({ target_symbol: "NVO" }), SECTORS), "Healthcare & Biotech");
  assert.equal(
    callSectorLabel(call({ target_symbol: "XLV", claim_type: "sector" }), SECTORS),
    "healthcare",
  );
  // Unknown ticker: honest null, never guessed.
  assert.equal(callSectorLabel(call({ target_symbol: "ZZZZ" }), SECTORS), null);
  // Sector named in words is its own label.
  assert.equal(
    callSectorLabel(call({ target_symbol: "energy", claim_type: "sector" }), SECTORS),
    "energy",
  );
});

test("clusterSectors handles JSONB arrays and legacy JSON strings", () => {
  const c = (top: EmergingCluster["top_sectors"]): EmergingCluster => ({
    id: "c",
    label: "L",
    headline: null,
    top_sectors: top,
    created_at: null,
  });
  assert.deepEqual(clusterSectors(c(["technology"])), ["technology"]);
  assert.deepEqual(clusterSectors(c('["healthcare & biotech"]')), ["healthcare & biotech"]);
  assert.deepEqual(clusterSectors(c("not json")), []);
  assert.deepEqual(clusterSectors(c(null)), []);
});

test("ladder rung 1: same symbol wins over sector matches", () => {
  const closed = call({ id: "closed", target_symbol: "XLV", claim_type: "sector" });
  const sameSym = call({ id: "o1", target_symbol: "XLV", claim_type: "sector", resolve_on: "2026-08-17" });
  const sameSector = call({ id: "o2", target_symbol: "BAX", resolve_on: "2026-08-06" });
  const next = findNextToWatch(closed, [sameSector, sameSym], SECTORS, []);
  assert.ok(next && next.kind === "call");
  assert.equal(next.call.id, "o1");
  assert.equal(next.why, "same symbol");
});

test("ladder rung 2: NVO (Healthcare & Biotech) finds the open XLV sector call", () => {
  const closed = call({ id: "nvo", target_symbol: "NVO" });
  const xlv = call({ id: "xlv", target_symbol: "XLV", claim_type: "sector", resolve_on: "2026-08-06" });
  const ppa = call({ id: "ppa", target_symbol: "PPA", claim_type: "sector", resolve_on: "2026-08-06" });
  const next = findNextToWatch(closed, [ppa, xlv], SECTORS, []);
  assert.ok(next && next.kind === "call");
  assert.equal(next.call.id, "xlv");
  assert.equal(next.why, "same sector");
});

test("ladder rung 3: AXTI (Technology) falls through to an emerging tech cluster", () => {
  const closed = call({ id: "axti", target_symbol: "AXTI" });
  const openXlv = call({ id: "xlv", target_symbol: "XLV", claim_type: "sector" });
  const cluster: EmergingCluster = {
    id: "cl1",
    label: "Sk Hynix: Ai",
    headline: null,
    top_sectors: '["technology"]',
    created_at: "2026-07-29",
  };
  const next = findNextToWatch(closed, [openXlv], SECTORS, [cluster]);
  assert.ok(next && next.kind === "cluster");
  assert.equal(next.cluster.id, "cl1");
});

test("ladder rung 4: nothing real matches, answer is null (never invented)", () => {
  const closed = call({ id: "x", target_symbol: "ZZZZ" });
  assert.equal(findNextToWatch(closed, [], {}, []), null);
  // Known sector but no live object in it: still null.
  const msft = call({ id: "msft", target_symbol: "MSFT" });
  const openFin = call({ id: "amg", target_symbol: "AMG" });
  assert.equal(findNextToWatch(msft, [openFin], SECTORS, []), null);
});

test("a call never relates to itself", () => {
  const closed = call({ id: "same", target_symbol: "XLV", claim_type: "sector" });
  assert.equal(findNextToWatch(closed, [closed], SECTORS, []), null);
});

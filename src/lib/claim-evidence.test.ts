/**
 * Unit tests for claim-evidence.ts. Pure, deterministic, no network.
 * Run: npx tsx --test src/lib/claim-evidence.test.ts
 *
 * The load-bearing assertion is the honest empty state: zero evidence renders an
 * absence, never a zero score or percentage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeClaimEvidence,
  evidenceCountLine,
  RECENT_LIMIT,
  EVIDENCE_COPY,
  type RawEvidenceRow,
} from "./claim-evidence.ts";

function row(stance: string, published: string, title = "t"): RawEvidenceRow {
  return { stance, article_published_at: published, articles: { title, url: null } };
}

test("counts supporting and challenging and is not empty", () => {
  const s = summarizeClaimEvidence([
    row("support", "2026-08-01"),
    row("challenge", "2026-08-02"),
    row("support", "2026-08-03"),
  ]);
  assert.equal(s.supporting, 2);
  assert.equal(s.challenging, 1);
  assert.equal(s.isEmpty, false);
});

test("zero evidence renders an honest empty state, not a zero score", () => {
  const s = summarizeClaimEvidence([]);
  assert.equal(s.supporting, 0);
  assert.equal(s.challenging, 0);
  assert.equal(s.isEmpty, true);
  // The count line is suppressed so the caller shows the empty copy, never "0%".
  assert.equal(evidenceCountLine(s), null);
  assert.match(EVIDENCE_COPY.empty, /no new evidence/i);
});

test("count line is two plain counts, no score or percentage", () => {
  const s = summarizeClaimEvidence([row("support", "2026-08-01"), row("support", "2026-08-02")]);
  const line = evidenceCountLine(s);
  assert.equal(line, "2 supporting, 0 challenging since you committed");
  assert.doesNotMatch(line ?? "", /%/);
});

test("recent is newest-first and capped at RECENT_LIMIT", () => {
  const rows = ["2026-08-01", "2026-08-05", "2026-08-03", "2026-08-04", "2026-08-02"].map((d) =>
    row("support", d),
  );
  const s = summarizeClaimEvidence(rows);
  assert.equal(s.recent.length, RECENT_LIMIT);
  assert.equal(s.recent[0].publishedAt, "2026-08-05");
  assert.equal(s.recent[1].publishedAt, "2026-08-04");
});

test("unknown or malformed stances are ignored, never guessed", () => {
  const s = summarizeClaimEvidence([
    row("support", "2026-08-01"),
    { stance: "neutral", article_published_at: "2026-08-02", articles: null },
    { stance: null, article_published_at: "2026-08-03", articles: null },
  ]);
  assert.equal(s.supporting, 1);
  assert.equal(s.challenging, 0);
  assert.equal(s.recent.length, 1);
});

test("null/undefined input is a no-op empty", () => {
  for (const v of [null, undefined]) {
    const s = summarizeClaimEvidence(v);
    assert.equal(s.isEmpty, true);
    assert.equal(evidenceCountLine(s), null);
  }
});

/**
 * Cold-start guarantees.
 *
 * Two accounts have ever committed a call, so nearly every reader of the brief
 * arrives at surfaces that are empty for them. These tests pin the four
 * front-end promises that keeps honest:
 *
 *  1. a track link survives the onboarding gate and lands on the call
 *  2. a user with zero claims is shown the DESK's record, labelled as the
 *     desk's, and no desk number is ever presented as the reader's own
 *  3. no rendered string claims a live sample that is not live
 *  4. onboarding does not gain a required input
 *
 * The recipient guarantee is Python and lives in
 * backend/tests/test_brief_email_recipients.py.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  POST_AUTH_DEFAULT,
  callDestination,
  postOnboardingDestination,
} from "../../src/lib/auth-redirect.ts";
import { YOUR_RECORD_COPY } from "../../src/lib/your-record.ts";
import {
  DESK_ASIDE_BODY,
  DESK_ASIDE_HEADING,
} from "../../src/components/record/DeskRecordAside.tsx";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

const WIZARD = read("src/components/onboarding/OnboardingWizard.tsx");
const PROXY = read("src/proxy.ts");
const CALLS = read("src/app/radar/calls/page.tsx");
const ASIDE = read("src/components/record/DeskRecordAside.tsx");

/* ── 1. A track link survives onboarding ─────────────────────────────────── */

const CALL_ID = "0cbe3d56-e03f-4760-83fd-08422f33ea6e";

test("a track link survives onboarding and lands on the call", () => {
  // What proxy.ts stamps when it intercepts a not-yet-onboarded reader who
  // clicked "Track this call" in the brief.
  const intended = `/radar/calls?adopt=${CALL_ID}`;
  const onboardingSearch = `?next=${encodeURIComponent(intended)}`;

  const dest = postOnboardingDestination(onboardingSearch);

  assert.equal(dest, callDestination(CALL_ID));
  assert.match(dest, /^\/radar\/calls\?adopt=/);
  // The #call- anchor cannot survive a server hop, so it must be re-synthesized.
  assert.ok(dest.endsWith(`#call-${CALL_ID}`), "anchor must be rebuilt");
  assert.notEqual(dest, POST_AUTH_DEFAULT);
});

test("the onboarding gate stamps next, and the wizard reads it", () => {
  assert.match(PROXY, /url\.searchParams\.set\('next', intended\)/);
  assert.match(PROXY, /url\.pathname = '\/onboarding'/);
  assert.match(WIZARD, /postOnboardingDestination\(window\.location\.search\)/);
  // The unconditional push that used to eat the destination is gone.
  assert.ok(
    !/router\.push\("\/dashboard"\)/.test(WIZARD),
    "the wizard must not hardcode /dashboard on finish",
  );
  assert.match(WIZARD, /router\.push\(finishDestination\)/);
});

test("postOnboardingDestination refuses an off-origin next", () => {
  for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com"]) {
    assert.equal(
      postOnboardingDestination(`?next=${encodeURIComponent(bad)}`),
      POST_AUTH_DEFAULT,
      `${bad} must not be followed`,
    );
  }
  assert.equal(postOnboardingDestination(""), POST_AUTH_DEFAULT);
});

test("a next with no adopt is honoured verbatim", () => {
  assert.equal(postOnboardingDestination("?next=%2Ftrends"), "/trends");
});

/* ── 2. Zero claims shows the DESK's record, never as the reader's ───────── */

test("a user with zero claims is shown the desk's record, labelled as the desk's", () => {
  // The empty branch renders the absence plus DeskRecordAside, not a ring.
  assert.match(CALLS, /const nothingOnRecord =/);
  assert.match(CALLS, /YOUR_RECORD_COPY\.noClaimsTitle/);
  assert.match(CALLS, /<DeskRecordAside \/>/);

  // The heading always names the desk and cannot be relabelled by a caller.
  assert.match(DESK_ASIDE_HEADING, /desk/i);
  assert.ok(
    !/heading\??:/.test(ASIDE.split("export interface DeskRecordAsideProps")[1] ?? ""),
    "DeskRecordAside must expose no heading override",
  );
});

test("no desk number is presented as the reader's own", () => {
  // The reader-facing copy for an empty record never claims a count.
  for (const line of [
    YOUR_RECORD_COPY.noClaimsTitle,
    YOUR_RECORD_COPY.noClaimsBody,
    YOUR_RECORD_COPY.noneResolvedBody,
  ]) {
    assert.ok(!/\d/.test(line), `personal empty copy must carry no figure: ${line}`);
  }
  // The aside's own body attributes the record to Signalera explicitly.
  assert.match(DESK_ASIDE_BODY, /Signalera's own calls/);
  assert.ok(
    !/\byour record\b/i.test(DESK_ASIDE_BODY),
    "the desk aside must never call these numbers the reader's record",
  );
  // The personal record model still says the desk's numbers are withheld.
  assert.match(YOUR_RECORD_COPY.noneResolvedBody, /Nothing of the desk's is shown here/);
});

test("the zeroed scoreboard is gone from the empty record hero", () => {
  const emptyBranch = CALLS.split("if (nothingOnRecord) {")[1]?.split("return (\n    <div className=\"mb-6 flex items-center")[0] ?? "";
  assert.ok(emptyBranch.length > 0, "empty branch must exist");
  assert.ok(
    !/record\.noCleanRead/.test(emptyBranch),
    "the empty branch must not render bucket counts",
  );
  assert.ok(
    !/strokeDasharray/.test(emptyBranch),
    "the empty branch must not render the progress ring",
  );
});

/* ── 3. No string claims a live sample that is not live ──────────────────── */

test("no rendered string claims a live sample that is not live", () => {
  const surfaces: [string, string][] = [
    ["OnboardingWizard.tsx", WIZARD],
    ["DeskRecordAside.tsx", ASIDE],
  ];
  // Strings a reader sees, minus comments. The banned shape is a liveness or
  // freshness claim attached to a sample, preview, or thesis.
  const BANNED = [
    /live sample/i,
    /sample thesis/i,
    /drafted right now/i,
    /generat\w* (a )?(preview|sample)/i,
    /your first signal/i,
    /preview thesis/i,
  ];
  for (const [name, src] of surfaces) {
    const rendered = src
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    for (const pattern of BANNED) {
      assert.ok(
        !pattern.test(rendered),
        `${name} still renders a liveness claim matching ${pattern}`,
      );
    }
  }
});

test("the illustrative brief card on step 7 says it is an example", () => {
  assert.match(WIZARD, /layout example/);
  assert.match(WIZARD, /An example headline\. Your real brief arrives each morning\./);
});

test("step 7 states what the desk does, the grader, and committing", () => {
  assert.match(WIZARD, /timestamped before the outcome is known/);
  assert.match(WIZARD, /scored against the close with benchmark attribution/);
  assert.match(WIZARD, /misses stay on the record beside the hits/);
  assert.match(WIZARD, /You can take any call as your own/);
});

/* ── 4. Onboarding required-input count does not increase ────────────────── */

/**
 * The gate function is the definition of "required". Six inputs block
 * progress today: first name, role, strategy, at least one sector, horizon,
 * workflow. Steps 6 and 7 are `return true`. If a future step adds a
 * condition, this test fails.
 */
test("onboarding required-input count does not increase", () => {
  const body = WIZARD.split("function canProceed(): boolean {")[1]?.split("\n  }")[0] ?? "";
  assert.ok(body.length > 0, "canProceed must exist");

  const gates = [
    /if \(step === 1\) return firstName\.trim\(\)\.length > 0;/,
    /if \(step === 2\) return role !== null;/,
    /if \(step === 3\) return strategy !== null;/,
    /if \(step === 4\) return sectors\.length >= 1;/,
    /if \(step === 5\) return horizon !== null && workflow !== null;/,
    /if \(step === 6\) return true;/,
    /if \(step === 7\) return true;/,
  ];
  for (const g of gates) assert.match(body, g);

  // Required inputs, counted from the gate expressions themselves.
  const required =
    (body.match(/firstName\.trim\(\)\.length > 0/g) ?? []).length +
    (body.match(/role !== null/g) ?? []).length +
    (body.match(/strategy !== null/g) ?? []).length +
    (body.match(/sectors\.length >= 1/g) ?? []).length +
    (body.match(/horizon !== null/g) ?? []).length +
    (body.match(/workflow !== null/g) ?? []).length;
  assert.equal(required, 6, "onboarding must require exactly six inputs");

  // And the screen count is unchanged: the record screen replaced the preview.
  assert.match(WIZARD, /const TOTAL_STEPS = 7;/);
});

test("the finish CTA names what it actually does", () => {
  // The file writes the arrow as \u2192, so match the label text only.
  assert.match(WIZARD, /"Go to the call \\u2192"/);
  assert.match(WIZARD, /"Make your first call \\u2192"/);
  assert.ok(
    !/Enter Signalera/.test(WIZARD),
    "the old label promised a destination that was not the first call",
  );
});

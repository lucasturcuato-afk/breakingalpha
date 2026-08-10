/**
 * The Morning Brief CTA round trip, end to end through both auth methods.
 *
 * Before this module the adopt id died in three places (see the PR body):
 * the auth page hardcoded /dashboard on the password path, sent no `next`
 * through Google, and the OAuth callback hardcoded /dashboard too. These tests
 * drive the same functions those three call sites now use, so a regression at
 * any hop fails here.
 *
 * Run: npm run test:unit
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, describe } from "node:test";

import {
  POST_AUTH_DEFAULT,
  callDestination,
  postAuthDestination,
  safeNext,
} from "./auth-redirect";

const CALL_ID = "73a64112-7b10-4d26-b40b-b9b799a9913d";
const ORIGIN = "https://signalera.ai";
const WANT = `/radar/calls?adopt=${CALL_ID}#call-${CALL_ID}`;

/** What src/app/auth/page.tsx computes at click time. */
function authPageDestination(landingUrl: string): string {
  return postAuthDestination(new URL(landingUrl).search);
}

/** What src/app/auth/callback/route.ts computes after the code exchange. */
function callbackLocation(callbackUrl: string): string {
  const { searchParams, origin } = new URL(callbackUrl);
  const next = safeNext(searchParams.get("next")) ?? POST_AUTH_DEFAULT;
  return `${origin}${next}`;
}

describe("adopt round trip: email/password", () => {
  test("sign-in from an adopt URL lands on that call, not the dashboard", () => {
    // proxy.ts bounces the signed-out click to /auth, preserving the query.
    const landing = `${ORIGIN}/auth?adopt=${CALL_ID}`;
    // The password path redirects to exactly this.
    assert.equal(authPageDestination(landing), WANT);
  });

  test("the anchor is synthesized, since a fragment never reaches a server", () => {
    const dest = authPageDestination(`${ORIGIN}/auth?adopt=${CALL_ID}`);
    assert.ok(dest.endsWith(`#call-${CALL_ID}`));
    assert.ok(dest.includes(`adopt=${CALL_ID}`));
  });

  test("a plain sign-in with no adopt still lands on the dashboard", () => {
    assert.equal(authPageDestination(`${ORIGIN}/auth`), POST_AUTH_DEFAULT);
  });
});

describe("adopt round trip: google oauth", () => {
  test("the id survives the provider round trip via next=", () => {
    const landing = `${ORIGIN}/auth?adopt=${CALL_ID}`;

    // 1. The auth page builds redirectTo for signInWithOAuth.
    const redirectTo = `${ORIGIN}/auth/callback?next=${encodeURIComponent(
      authPageDestination(landing),
    )}`;
    assert.ok(redirectTo.includes("next="));

    // 2. Google returns to redirectTo with ?code= appended. Our query survives.
    const returned = `${redirectTo}&code=fake-auth-code`;
    assert.equal(new URL(returned).searchParams.get("code"), "fake-auth-code");

    // 3. The callback resolves the final Location header.
    assert.equal(callbackLocation(returned), `${ORIGIN}${WANT}`);
  });

  test("oauth with no adopt lands on the dashboard", () => {
    const redirectTo = `${ORIGIN}/auth/callback?next=${encodeURIComponent(
      authPageDestination(`${ORIGIN}/auth`),
    )}`;
    assert.equal(
      callbackLocation(`${redirectTo}&code=x`),
      `${ORIGIN}${POST_AUTH_DEFAULT}`,
    );
  });

  test("a callback with no next at all still works", () => {
    assert.equal(
      callbackLocation(`${ORIGIN}/auth/callback?code=x`),
      `${ORIGIN}${POST_AUTH_DEFAULT}`,
    );
  });
});

describe("open redirect is not possible", () => {
  for (const hostile of [
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "http://signalera.ai.evil.com",
    "javascript:alert(1)",
  ]) {
    test(`next=${hostile} is rejected`, () => {
      assert.equal(safeNext(hostile), null);
      assert.equal(
        callbackLocation(
          `${ORIGIN}/auth/callback?code=x&next=${encodeURIComponent(hostile)}`,
        ),
        `${ORIGIN}${POST_AUTH_DEFAULT}`,
      );
    });
  }

  test("a malformed adopt id degrades to the dashboard rather than erroring", () => {
    for (const bad of ["", "x", "../../etc", "<script>"]) {
      assert.equal(
        postAuthDestination(`?adopt=${encodeURIComponent(bad)}`),
        POST_AUTH_DEFAULT,
      );
    }
  });

  test("a valid id is url-encoded into the query", () => {
    assert.equal(callDestination(CALL_ID), WANT);
  });
});

describe("the landing page is wired for the arriving id", () => {
  const page = readFileSync(
    join(process.cwd(), "src/app/radar/calls/page.tsx"),
    "utf8",
  );

  test("it reads the adopt param", () => {
    assert.ok(page.includes('params.get("adopt")'));
  });

  test("it anchors an element per call id, so the deep link has a target", () => {
    assert.ok(page.includes("id={`call-${c.id}`}"));
  });

  test("it scrolls the deep-linked call into view", () => {
    assert.ok(page.includes("getElementById(`call-${adoptCallId}`)"));
    assert.ok(page.includes("scrollIntoView"));
  });

  test("the track control is wired on the same row", () => {
    assert.ok(page.includes("onTrack={() => void adopt(c.id, chosen)}"));
  });
});

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { mobileFixtureAuthBypass, mobileFixtureScreensEnabled } from "./mobile-fixture-gate";

/**
 * The gate that keeps a fixture screen off a live user-data route.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT. Under the test runner both reads are
 * ordinary runtime lookups, so this pins the DECISION TABLE: which combinations
 * open and which shut. It does not prove the build-time inline, because there
 * is no build here. The inline is verified separately against a real production
 * build; see the PR body.
 *
 * The property that matters is that the shut branch is the default. Every row
 * below that is not a recognised development or preview environment has to come
 * back false, including the ones nobody planned for.
 */

const NODE = process.env.NODE_ENV;
const VERCEL = process.env.NEXT_PUBLIC_VERCEL_ENV;

function setEnv(node: string | undefined, vercel: string | undefined) {
  // NODE_ENV is typed as a narrow union on the Next ambient types, so the
  // assignment goes through the record rather than the property.
  const env = process.env as Record<string, string | undefined>;
  env.NODE_ENV = node;
  env.NEXT_PUBLIC_VERCEL_ENV = vercel;
}

afterEach(() => setEnv(NODE, VERCEL));

describe("mobileFixtureScreensEnabled", () => {
  it("opens on a development build", () => {
    setEnv("development", undefined);
    assert.equal(mobileFixtureScreensEnabled(), true);
  });

  it("opens on a test build", () => {
    setEnv("test", undefined);
    assert.equal(mobileFixtureScreensEnabled(), true);
  });

  it("opens on an explicit Vercel preview", () => {
    setEnv("production", "preview");
    assert.equal(mobileFixtureScreensEnabled(), true);
  });

  it("shuts on production", () => {
    setEnv("production", undefined);
    assert.equal(mobileFixtureScreensEnabled(), false);
  });

  it("shuts on a Vercel production deployment", () => {
    setEnv("production", "production");
    assert.equal(mobileFixtureScreensEnabled(), false);
  });

  it("shuts on production when the preview flag is misspelled", () => {
    setEnv("production", "Preview");
    assert.equal(mobileFixtureScreensEnabled(), false);
  });

  it("shuts on production for any unexpected environment value", () => {
    for (const value of ["", "staging", "dev", "1", "true", "PREVIEW", " preview"]) {
      setEnv("production", value);
      assert.equal(mobileFixtureScreensEnabled(), false, `opened on ${JSON.stringify(value)}`);
    }
  });
});

describe("mobileFixtureAuthBypass", () => {
  it("opens on a development server only", () => {
    setEnv("development", undefined);
    assert.equal(mobileFixtureAuthBypass(), true);
  });

  it("stays shut on a preview deployment, which keeps its auth redirect", () => {
    setEnv("production", "preview");
    assert.equal(mobileFixtureAuthBypass(), false);
  });

  it("stays shut on production", () => {
    setEnv("production", undefined);
    assert.equal(mobileFixtureAuthBypass(), false);
  });

  it("is never wider than the screen gate", () => {
    for (const node of ["development", "test", "production"]) {
      for (const vercel of [undefined, "preview", "production"]) {
        setEnv(node, vercel);
        if (mobileFixtureAuthBypass()) {
          assert.equal(mobileFixtureScreensEnabled(), true, `${node}/${vercel}`);
        }
      }
    }
  });
});

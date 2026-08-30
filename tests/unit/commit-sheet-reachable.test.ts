// The commit sheet stays reachable for a SIGNED-IN reader.
//
// WHY THIS FILE EXISTS, and it is not the reason you would guess.
//
// `DASH-AUDIT.md` reported that "the commit sheet is unreachable for every
// signed-in user", mounted "behind a gate that requires
// `user === null && mobileFixtureScreensEnabled()`". That finding was WRONG,
// and this file is the guard that would have caught it either way.
//
// What is actually true, in `src/app/ledger/page.tsx`: the gate sits on
// `initialTarget`, the forced-open `?sheet=open` preview target that the parity
// harness and the width audits measure. The PROVIDER itself mounts
// unconditionally, inside the plain `return`, for every reader in every
// environment. A signed-in reader opens the sheet by tapping a card, which
// calls `useCommitSheet()?.open(target)`. A second unconditional mount lives at
// `src/app/claim/[id]/page.tsx`.
//
// So the audit conflated "the preview target is gated" with "the sheet is
// gated". Those are one identifier apart in the source and produce opposite
// conclusions about whether the product works.
//
// THE REAL FAILURE MODE THIS DEFENDS. `useCommitSheet()` returns null outside a
// provider, and both consumers are written to degrade quietly when it does:
// `ledger-screen.tsx` passes `onTrack={undefined}` and `claim-screen.tsx` draws
// no action at all. That is good behavior for a missing provider and terrible
// behavior for a missing provider nobody noticed, because the card simply stops
// offering the action and NOTHING fails. No type error, no lint error, no build
// error, no crash. It is the exact shape of the defect the audit hallucinated,
// and it is one deleted line away from being real.
//
// Three tests:
//   1. NO PAGE GATES THE PROVIDER MOUNT on the fixture gate. Reads the pages as
//      TEXT, so it needs no import and cannot care that these are server
//      components.
//   2. EVERY `useCommitSheet` CONSUMER HAS A PROVIDER ABOVE IT. Walks from each
//      consuming component to the pages that render it and requires a mount.
//      This is the one that catches a THIRD surface added later.
//   3. The preview target IS still gated, so the fix for a defect that did not
//      exist cannot be "delete the fixture gate".
//
// Both detectors are driven against fixture strings that DO violate as well as
// ones that do not, so a detector that silently stopped matching anything fails
// rather than passes.
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const APP = join(ROOT, "src", "app");
const COMPONENTS = join(ROOT, "src", "components");

const PROVIDER = "CommitSheetProvider";
const HOOK = "useCommitSheet";
/** The identifiers that make up the non-production fixture gate. */
const FIXTURE_GATE = ["sampleAllowed", "mobileFixtureScreensEnabled"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".tsx") || full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * Is the PROVIDER MOUNT (not the target) gated on the fixture gate?
 *
 * Reads the span between the component's `return (` and the `<CommitSheetProvider`
 * tag. A gate wrapping the mount has to appear in that span, because JSX
 * conditionals precede the element they guard. A gate on `initialTarget`
 * appears BEFORE the return, in the const that computes the target, so it is
 * correctly not matched.
 */
function providerMountIsGated(source: string): boolean {
  const mountAt = source.indexOf(`<${PROVIDER}`);
  if (mountAt === -1) return false;
  const returnAt = source.lastIndexOf("return (", mountAt);
  if (returnAt === -1) return false;
  const span = source.slice(returnAt, mountAt);
  return FIXTURE_GATE.some((g) => span.includes(g));
}

/** Files under src/app that mount the provider. */
function pagesMountingProvider(): string[] {
  return walk(APP).filter((f) => readFileSync(f, "utf8").includes(`<${PROVIDER}`));
}

// ---------------------------------------------------------------------------
// 1. No page gates the provider mount.
// ---------------------------------------------------------------------------
test("the commit sheet provider mounts unconditionally on every page that mounts it", () => {
  const pages = pagesMountingProvider();
  assert.ok(
    pages.length >= 2,
    `expected at least two pages to mount ${PROVIDER}, found ${pages.length}. ` +
      `If a mount was removed, a whole surface silently lost its commit action.`,
  );
  for (const page of pages) {
    const src = readFileSync(page, "utf8");
    assert.equal(
      providerMountIsGated(src),
      false,
      `${page.replace(ROOT + "/", "")} gates the ${PROVIDER} MOUNT on the fixture ` +
        `gate. That makes the sheet unreachable for signed-in readers, which is ` +
        `exactly the defect DASH-AUDIT.md wrongly reported. Gate the target, not ` +
        `the provider.`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. Every consumer of the hook has a provider above it. This is the one that
//    catches a third surface added later.
// ---------------------------------------------------------------------------
test("every useCommitSheet consumer is rendered by a page that mounts the provider", () => {
  const consumers = walk(COMPONENTS).filter((f) => {
    const src = readFileSync(f, "utf8");
    // The provider and the barrel define and re-export the hook; they are not
    // consumers of it.
    if (f.includes("commit-sheet-provider") || f.endsWith("commit/index.ts")) return false;
    // BOTH an import and a call. A doc comment that merely NAMES the hook is
    // not a consumer, and matching on the call shape alone picks up
    // `commit-target.ts`, whose header explains the trigger contract in prose.
    const imports = new RegExp(`import[^;]*\\b${HOOK}\\b[^;]*from`, "s").test(src);
    return imports && new RegExp(`${HOOK}\\s*\\(`).test(src);
  });

  assert.ok(
    consumers.length > 0,
    `found no ${HOOK} consumers at all. Either the hook was renamed or the ` +
      `commit action was removed from every surface.`,
  );

  const providerPages = pagesMountingProvider().map((p) => readFileSync(p, "utf8"));

  for (const consumer of consumers) {
    // The exported component name, e.g. LedgerScreen from ledger-screen.tsx.
    const src = readFileSync(consumer, "utf8");
    const named = src.match(/export function ([A-Z][A-Za-z0-9_]*)/);
    assert.ok(
      named,
      `${consumer.replace(ROOT + "/", "")} calls ${HOOK} but exports no named ` +
        `component, so this test cannot verify a provider sits above it.`,
    );
    const component = named[1];
    const rendered = providerPages.some((page) => page.includes(component));
    assert.ok(
      rendered,
      `${component} calls ${HOOK} but no page that mounts ${PROVIDER} renders ` +
        `it. ${HOOK} returns null outside a provider, so ${component} will draw ` +
        `NO commit action and nothing will fail: not tsc, not lint, not the ` +
        `build. Mount ${PROVIDER} on the page that renders ${component}.`,
    );
  }
});

// ---------------------------------------------------------------------------
// 3. The preview target stays gated. The fix for a defect that did not exist
//    must not be to open the fixture path to real readers.
// ---------------------------------------------------------------------------
test("the forced-open preview target is still gated to non-production and signed-out", () => {
  const ledger = readFileSync(join(APP, "ledger", "page.tsx"), "utf8");
  assert.match(
    ledger,
    /const sampleAllowed = user === null && mobileFixtureScreensEnabled\(\);/,
    "the ledger page no longer computes the fixture gate as `user === null && " +
      "mobileFixtureScreensEnabled()`. Sample content and the forced-open sheet " +
      "must stay unreachable to a signed-in reader in every environment.",
  );
  const targetAt = ledger.indexOf("commitPreview");
  const gateInTarget = ledger.slice(targetAt, ledger.indexOf(`<${PROVIDER}`));
  assert.ok(
    gateInTarget.includes("sampleAllowed"),
    "the forced-open `?sheet=open` target is no longer gated on `sampleAllowed`. " +
      "A signed-in reader could be handed a sheet over sample content.",
  );
});

// ---------------------------------------------------------------------------
// Detector proofs. Without these, a detector that stopped matching anything
// would make every test above pass while measuring nothing.
// ---------------------------------------------------------------------------
test("providerMountIsGated detects a gated mount and clears an ungated one", () => {
  const GATED = `
    return (
      <AppShell>
        {sampleAllowed ? (
          <CommitSheetProvider initialTarget={null}>
            <Screen />
          </CommitSheetProvider>
        ) : null}
      </AppShell>
    );
  `;
  const UNGATED_TARGET_ONLY = `
    const commitPreview = sampleAllowed && sheetRaw === "open" ? target : null;
    return (
      <AppShell>
        <CommitSheetProvider initialTarget={commitPreview}>
          <Screen />
        </CommitSheetProvider>
      </AppShell>
    );
  `;
  const GATED_BY_HELPER = `
    return (
      <AppShell>
        {mobileFixtureScreensEnabled() && (
          <CommitSheetProvider initialTarget={null}><Screen /></CommitSheetProvider>
        )}
      </AppShell>
    );
  `;

  assert.equal(providerMountIsGated(GATED), true, "missed a mount gated by sampleAllowed");
  assert.equal(
    providerMountIsGated(GATED_BY_HELPER),
    true,
    "missed a mount gated by the helper call directly",
  );
  assert.equal(
    providerMountIsGated(UNGATED_TARGET_ONLY),
    false,
    "wrongly flagged a mount whose TARGET is gated but whose provider is not. " +
      "That is the shipped and correct shape, and flagging it would push someone " +
      "to delete the fixture gate.",
  );
  assert.equal(
    providerMountIsGated("const x = 1;"),
    false,
    "reported a gate in a file with no provider mount at all",
  );
});

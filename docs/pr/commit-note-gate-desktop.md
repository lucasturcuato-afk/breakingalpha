# Gate the desk footer behind the same note the commit sheet asks for

Ruling 11 (PR #694): the note is part of what adopting a call MEANS, not a
mobile enrichment. The product owner then ruled the brief in too, because
three inconsistent surfaces is worse than a delay.

This wires the morning brief and the evening wrap. `/radar/calls` is the third
surface and is under the /radar sprint fence, so its diff is written out below
marked NOT APPLIED.

Shape (B): gate the existing footer in place. Shape (A), reusing the mobile
commit sheet, was rejected, chief among the reasons that `router.refresh()`
does not re-run a client `load()` on a `"use client"` page
(`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md:46`),
so the card would never flip to tracked; and the brief's provenance telemetry,
built at the tap on purpose, has nowhere to go through `CommitSheetHandle`.

---

## Measured geometry, and why 72px

Everything below is measured off a production build at 1440x900, signed in,
with `/api/radar/claims/adopt` intercepted. Nothing is derived.

| | Radar card | Brief |
|---|---|---|
| card width | 510px | 888px, single column |
| footer content box | **468px** | **846px** |
| untracked footers | 12, in 7 grid rows | 5 live cards, 5 rows |

One line box at 15px/1.6 measures **24.00px at both widths**. So:

- **72px = exactly three line boxes.** One number serves both surfaces, which
  is the whole reason to pick it over a per-surface value.
- It clears the 44px tap floor with room over.
- Measured textarea height on the running build: **72px exactly**, both themes.

Footer height, measured before and after:

| | ungated | gated | delta |
|---|---|---|---|
| brief footer | 31.59px | **169.11px** | **+137.52px per row** |

At 5 live brief cards that is **+687.6px** down the page. Recon predicted
+123.39/row; the measured number is +137.52, and the difference is the field's
own box (20px vertical padding, 2px border, 10px margin) plus the hint line and
its 12px margin. **The measured number is the one to plan with.**

Radar is unchanged at 31.59px because it is not wired. If the proposal below
lands, 12 footers x 137.52 = **+1650px**.

### Tokens

DESK vocabulary only: `border-border-default`, `text-text-muted`,
`var(--gold)`, radius 9px. The `--c-*` family is deliberately NOT used:
`src/styles/tokens.css:50-53` records that those are NEAR-equivalents, identical
in light and divergent in dark, so mixing families on a desk surface is the
token-role error ruling 10 covers.

Measured border colours:

| state | light | dark |
|---|---|---|
| gate unmet | `rgb(237, 228, 211)` | `rgba(255, 255, 255, 0.14)` |
| gate met | `rgb(212, 168, 75)` | `rgb(201, 168, 76)` |
| radius | 9px | 9px |

---

## Three surfaces, one literal

`COMMIT_NOTE_MIN = 12` moved to `src/components/commit/commit-target.ts`,
beside `COMMIT_NOTE_MAX`. That module is pure and imports nothing, which is the
property its own comment already named as why the ceiling lives there; the file
used to say "a ceiling, not a floor" and now stops contradicting itself.

`commit-sheet.tsx` imports and re-exports it, so `index.ts` and every existing
importer keeps working against ONE literal.

`TrackCallControl.tsx` imports the two numbers from the **direct** module path,
never the barrel: `index.ts` re-exports `CommitSheet` and `CommitSheetProvider`,
which would drag `createPortal` and `next/navigation` into three page bundles to
read two integers.

### Copy: zero new strings

Every string is reused verbatim from the sheet, and exported beside
`TRACK_TRUST_LINE` so tests can assert them the way the trust line already is.

- prompt: "What has to be true for this, and what would change your mind."
- hint: "A sentence is enough." / "Timestamped before the outcome is known."
- gated button: "Write your reasoning first"
- aria-label: "Your reasoning"

**Deliberately NOT reused:** the sheet's `Why do you think so?` heading and its
sub-paragraph. In the sheet they appear once over one call. On Radar there are
twelve untracked footers, so they would appear twelve times, which is exactly
the failure `TrackCallControl.tsx` already records for the trust line
("Repeating it above every card turned the strongest sentence in the product
into wallpaper"), plus a heading-outline defect. The desk field carries no
heading; `CallsTrustLine` already sits once above the grid.

**The 700ms timed press is NOT ported.** `COMMIT_PRESS_MS` is a phone
affordance and nobody ruled the desktop gesture changes.

### The note lives in the caller

Hard requirement, and it is the failure contract: the note is held in the
CALLER's state keyed by call id, never inside `UntrackedFooter`, so a failed
POST leaves the sentence on screen. `revert()` clears the optimistic row and
the stamp and deliberately does not touch `noteFor`.

---

## Ruled deviation: the note props are optional, not required

The brief said REQUIRED. They are optional, and this is a ruling, not drift.

The fence makes required impossible:

- required props do not compile against the fenced `src/app/radar/calls/page.tsx`
  (verified: `TS2739: ... is missing the following properties ... note, onNoteChange`)
- a required prop defaulted to `""` would leave that page's Track button
  **permanently disabled**, which is a live regression rather than a deferral

So the pair is a discriminated union, `CallCommitNoteProps`, keyed on an
explicit `noteGate: true`:

```ts
export type CallCommitNoteProps =
  | { noteGate: true; note: string; onNoteChange: (note: string) => void }
  | { noteGate?: false; note?: never; onNoteChange?: never };
```

An earlier version derived the gate from `typeof onNoteChange === "function"`.
That was wrong: a caller passing `note` and forgetting `onNoteChange` got an
ungated footer with a dead read-only field and no type error. Presence is not a
contract. The broken shape can no longer be written down.

When the diff below lands, collapse the union to a plain required pair.

---

## A data-loss path found in review, and fixed

The first version cleared `noteFor[call.id]` on ANY `res.ok`. That is the exact
failure class this PR exists to close.

`adopt/route.ts:111` writes an incoming note to an existing row **only when
that row has none**:

```ts
if (commitNote && !existing.commit_note) { ...update... }
```

So a reader who writes a sentence against a stale card whose call is already
adopted WITH a note has their text silently discarded, gets a 200, and the
client deleted their only copy.

**`noteWritten` cannot separate those cases.** On the already-adopted branch it
is `Boolean(existing.commit_note)` (`:125`), true whenever an OLD note is on the
row. It answers "this row carries a note", not "your note was written". Only on
the insert path (`:208`) is it read back off the row the request just created.

`noteLandedOnRow()` encodes exactly that and only that: a fresh insert with the
note confirmed on the inserted row clears the draft; **every other shape keeps
it**. A stale draft is a nuisance; a vanished sentence is the defect.

Residual, stated plainly: on already-adopted-with-a-note the card correctly
flips to tracked and the discarded sentence stays in component state but is no
longer on screen. Making that case knowable needs a route change, proposed at
the bottom, NOT taken here because the route is shared with the mobile sheet.

---

## Telemetry

`note_length` added to the `*.call.tracked` event. It is the only thing that
proves the gate is live in production without reading the table: a run of
values below 12 means a surface is writing rows the gate never covered.

---

# NOT APPLIED: the proposed `src/app/radar/calls/page.tsx` diff

**This file is under the /radar sprint fence and is NOT touched by this
branch.** Everything below is a proposal. It is two independent changes: the
note wiring, and a real deep-link bug recon found.

## Part 1: wire the note

**`:225`**, beside `adoptWindow`:

```tsx
  /** The reader's note in progress, per call. Held HERE and not in the footer
   *  so a failed adopt leaves the sentence on screen: the failure paths below
   *  deliberately do not touch this record, and only a confirmed write clears
   *  an entry. Ruling 11: the note is part of what adopting means. */
  const [adoptNote, setAdoptNote] = useState<Record<string, string>>({});
```

**`:373`**, the signature:

```tsx
  const adopt = async (callId: string, window: AdoptWindow, note: string) => {
```

**`:386`**, the body:

```tsx
        body: JSON.stringify({
          call_id: callId,
          // Trimmed, the form the column checks and the route stores.
          commit_note: note.trim(),
          ...adoptWindowRequest(window),
        }),
```

**`:389-393` and `:398-401`**, both failure paths: **unchanged**. They must not
touch `adoptNote`.

**`:394`**, success, and note this uses the same predicate as the brief rather
than clearing unconditionally:

```tsx
      setStamped((prev) => new Set(prev).add(callId));
      if (noteLandedOnRow(json)) {
        setAdoptNote((prev) => {
          const next = { ...prev };
          delete next[callId];
          return next;
        });
      }
```

**`:741-756`**, the render:

```tsx
                                noteGate
                                // Empty is not a stand-in for absent data. It
                                // is a true statement about the draft: nothing
                                // typed yet. Same shape as the
                                // `adoptWindow[c.id] ?? ...` default above.
                                note={adoptNote[c.id] ?? ""}
                                onNoteChange={(next: string) =>
                                  setAdoptNote((prev) => ({ ...prev, [c.id]: next }))
                                }
                                onTrack={(note: string) => void adopt(c.id, chosen, note)}
```

Then: collapse `CallCommitNoteProps` to a required pair, and in
`e2e/commit-note-gate.spec.ts` delete the "radar calls is still ungated" test
and move `/radar/calls` into `GATED_SURFACES`.

## Part 2: THE DEEP LINK IS BROKEN TODAY at 1440

Arriving at `/radar/calls?adopt=<id>#call-<id>` signed in, the scroll container
stays at `scrollTop` 0 while the target card sits ~1300px down a 900px
viewport. **The gold ring IS applied** (`:715-719`, measured
`box-shadow rgb(212,168,75) 0 0 0 2px`). So the card is ringed correctly, 1300px
below the fold, and the reader sees the top of the page.

Reproduced in this PR's e2e run. The locator resolves to
`<div id="call-568c87f9-..." class="group scroll-mt-24 rounded-lg ring-2 ring-[var(--gold)]">`
with **viewport ratio 0**.

**Mechanism.** The scroll effect at `:266-272` depends on
`[adoptCallId, briefCalls]`, but the whole card tree is gated on
`{loading ? null : (` at `:526`. The effect fires against a tree with no
`call-<id>` node, `getElementById` gives back null, and nothing re-runs it.

**Fix, one line plus a guard:**

```tsx
  useEffect(() => {
    if (loading) return;
    if (!adoptCallId || briefCalls.length === 0) return;
    const node = document.getElementById(`call-${adoptCallId}`);
    if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [adoptCallId, briefCalls, loading]);
```

**Arrival treatment**, decided by recon:

- keep the gold ring on the CARD unchanged
- focus the note FIELD, not the button. A disabled control cannot take focus,
  and the sheet sets this precedent at `commit-sheet.tsx:173-175`
- the focus ring is already gold via `globals.css:217`
- add NO arrival copy. The hint already says "A sentence is enough."
- do NOT use `.call-handoff-target` (`globals.css:517-527`). It is referenced by
  nothing and its 1.6s transient would fight the persistent ring

## Part 3 (optional, route): make the discard case knowable

Only if the residual above is judged worth it. The route is shared with the
mobile sheet, so this is a contract widening, not a fix.

At `adopt/route.ts:122`, the branch that discards an incoming note, add a field
that answers the caller's actual question:

```tsx
    return NextResponse.json({
      id: existing.id,
      alreadyAdopted: true,
      noteWritten: Boolean(existing.commit_note),
      // NEW: did THIS request's note reach the row. False on this branch
      // whenever a note was supplied, because the row already had one.
      incomingNoteStored: false,
    });
```

with `incomingNoteStored: true` at `:120` and on the insert path. Then
`noteLandedOnRow()` reads that single unambiguous field and the already-adopted
case can clear correctly.

---

# Open decisions

## 1. A 200 with no row id: a real divergence, spec'd not fixed

`/radar/calls` (`:387-393`) and the brief (`:417-437`) both treat any `res.ok`
as success and flip to tracked on `{}`.

The sheet does NOT. `commit-sheet.tsx:145-150` rejects a 200 with no id, with
the comment **"A 200 with no row id is not an acknowledgement."**

That is the same class of inconsistency this ruling is about. It is declared as
an expected-failure in `e2e/commit-note-gate.spec.ts` rather than fixed inside
this PR, because it is a behaviour change on the adopt path and deserves its own
decision. `test.fail()` means it passes while broken and turns red the day it is
fixed.

## 2. Pre-existing: the Track button is 31.59px tall

Below the 44px tap floor. Measured on every surface, in both themes.
**Pre-existing and out of scope**, flagged so it is not lost. The new field was
deliberately NOT built to match it: it is 72px.

---

# Verification

| gate | result |
|---|---|
| `npx tsc --noEmit` | **0 errors** |
| `npm run lint` | **0 errors**, 78 warnings (the pre-existing baseline) |
| `npm run test:unit` | **470 passed, 0 failed** (28 in `TrackCallControl.test.ts`, up from 17) |
| `npm run build` | **success**, turbopack root confirmed as this worktree |
| `design:lint --since origin/main` | **0 new errors**, 2 warnings |

The 2 design-lint warnings are the allowlisted `placeholder` DOM attribute, the
same ruling `commit-sheet.tsx` already relies on.

## e2e

Run against a production build on `:3256`, signed in, with
`/api/radar/claims/adopt` intercepted in a **fixture that overrides `page`**, so
the interception is in place before any `page.goto` in the file and a forgotten
per-test override cannot write a row. The default answer is a refusal, not a
success.

**13 passed, 1 failed.** The one failure is the deliberate deep-link red.
No new failures beyond the known floor.

- Spec 1, the gate, parameterised over the surfaces at 1440x900: 11 disabled,
  12 enabled, `"   abc   "` (9 trimmed) disabled, padded-12 enabled. The trim
  boundary is load-bearing: it is the same semantic
  `sql/proposals/0033` depends on, `length(btrim(commit_note)) > 0`.
- Every locator is scoped `:visible`, because the evening wrap mounts BOTH
  trees and hides one with CSS rather than unmounting it.
- Spec 4, a failed POST leaves the note in the field, in three shapes: 500,
  `route.abort('failed')`, and 200-with-no-row-id.

**One finding about the harness itself:** `test.fail()` does NOT absorb a
TIMEOUT, only an assertion failure. Written as expected-failures, the
`/radar/calls` cases waited out the full 60s timeout on a field that does not
exist and two were reported as hard failures. The ungated surface is now a fast
assertion about today's state that goes red the day the proposal lands.

**Config trap, for whoever runs this next:** `playwright.config.ts:14` switches
to smoke-prod only when `E2E_BASE_URL` starts with `https://`, so
`http://localhost:3256` still starts `npm run dev` on 3000. This was run with a
throwaway config pointed at `next start`. That config must live INSIDE the
worktree: placed in a shared scratchpad it resolved `@playwright/test` out of a
SIBLING worktree's `node_modules` and failed with "No tests found".

## Screenshots

`docs/screens/commit-note-gate/`, 1440x900, both themes:

- `brief-gated-empty-{light,dark}.png` - prompt, "A sentence is enough.",
  disabled "Write your reasoning first"
- `brief-gated-filled-{light,dark}.png` - gold border, "Timestamped before the
  outcome is known.", enabled "Track this call"
- `wrap-gated-empty-{light,dark}.png`
- `radar-ungated-{light,dark}.png` - today's ungated footer, the fence gap made
  visible

---

# Recovery note

`acf7ca64` is **not** a clean floor on its own. The state it captured used
"holds" and "hold the same line" in five comments, and `hold` is a banned
substring, which is why `42d1415d` exists. Anyone recovering from that commit
needs both.

# Make 600 a real mono face, and retune every mono weight to 400/600

## The design consequence, first

**759 mono elements get visibly lighter. 122 get marginally heavier. Nothing else moves at all.**

This is a **lightening**, not a tightening. That is the opposite of what "add a heavier weight" sounds like, and it is the whole point of the change.

| moving | count | ink change | what a reader sees |
|---|---:|---:|---|
| 700 and 800 coming down to 600 | 234 | **minus ~20%** | clearly lighter |
| already declared 600, **zero source edits** | 525 | **minus ~20%** | clearly lighter |
| 500 going up to 600 | 122 | +14.4% | one honest weight step |
| w400 | 1379 | 0% | byte-identical, verified |

Row two is the trap. **"Already 600" did not mean "untouched."** Those 525 elements rendered as the same faux bold as everything else, because 600 had no real face to resolve to. The moment 600 becomes real they lighten by the same ~20%, with no line of source changing.

Counts are elements, from an independent matched-pair sweep of 34 routes in both themes (35,653 matched pairs). In declaration terms the change is 49 edited declarations plus 41 already-600 declarations that shift with no edit.

## Why the bold mono was wrong

IBM Plex Mono loaded only 400 and 500. CSS font matching therefore resolved **600, 700 AND 800 all to the 500 face**, and Chrome synthesised bold on top of it.

Measured in the DOM against the running production build, signed in, isolated integer-aligned captures at DPR 3, md5 of the captured pixels:

The direct test is `font-synthesis-weight: none`. A **synthesised** face collapses onto the real face it matched; a **genuine** face does not move. Same string, 17px, isolated, DPR 3:

```
origin/main, font-synthesis-weight: none, 17px
  w400  df6b1b42  ink 1033270
  w500  10408341  ink 1326356
  w600  10408341  ink 1326356   <- collapsed onto w500
  w700  10408341  ink 1326356   <- collapsed onto w500
  w800  10408341  ink 1326356   <- collapsed onto w500

this branch, font-synthesis-weight: none, 17px
  w400  df6b1b42  ink 1033270
  w500  df6b1b42  ink 1033270   (no 500 face; matches down to the real 400)
  w600  f50728f9  ink 1518352   <- does not move. real face.
  w700  f50728f9  ink 1518352
  w800  f50728f9  ink 1518352
```

That reads synthesis directly rather than inferring it from a render changing. With synthesis left on, the three heavy weights on `origin/main` are byte-identical to each other at 10px, 12px and 17px.

That synthesised face is **+44.6% ink over the 500 face** (I measure +44.4% / +43.8% / +42.3% at 10 / 12 / 17px). A genuine 700 is only +28.8%. **The synthetic bold was heavier than a real bold.**

So the product shipped exactly two mono weights on screen: regular, and one over-inked faux bold doing the work of 600, 700 and 800 at once.

### After

```
AFTER    document.fonts -> IBM Plex Mono loaded weights: [400, 600]
         w600 is a real face. Ink drops 20.8% / 20.5% / 19.5% at 10 / 12 / 17px.
```

`docs/design/mono-real-bold/comparison-17px.png` and `comparison-morning-brief.png` show it. The Morning Brief crop at 2.4x is the one worth looking at: SPY 766.08, QQQ 711.37, 69 active, VIX 15.21 all visibly open up.

### One honest correction to the brief

The brief predicted that after the swap, 600 / 700 / 800 would **no longer** be byte-identical to each other. **They still are, and that is correct behaviour.** With faces {400, 600} loaded, CSS font matching sends 700 and 800 **down** to the real 600 face, and Chrome applies no synthesis because the matched face is already at the bold threshold. Identity is now the *right* outcome reached the *right* way.

The claim that actually matters is proven a different way, and proven harder:

- `document.fonts` lists a **loaded 600 face** after, and only 400 and 500 before. A real face is an entry in the font set; a synthesised one is not.
- The w600 render **changed between builds** and got 20% lighter. A synthesised face would not have moved.

## Bytes: 10x cheaper than the ruling assumed

The ruling budgeted +640 B. Measured against the emitted `.next` output:

| | before | after | delta |
|---|---:|---:|---:|
| IBM Plex Mono, all 10 subsets | 65,516 B | 65,800 B | **+284 B** |
| latin only, the 2 preloaded files | 20,112 B | 20,172 B | **+60 B** |
| all woff2 on disk | 195,268 B | 195,552 B | +284 B |

Only 2 of the 10 mono files are preloaded (the `-s.p.` latin pair). The other 8 are unicode-range gated and a latin reader never fetches them. **A reader pays +60 B.**

Single latin faces: 400 = 10,052 B, 500 = 10,060 B, 600 = 10,120 B, 700 = 10,128 B.

Unchanged, as required: **Fraunces stays `100 900`, 3 files, 81,736 B. Space Grotesk stays `300 700`, 3 files, 48,016 B.** IBM Plex Mono stays at 10 descriptors resolving to 10 distinct files.

## The 700 alternative, as a one-line reversal

If you would rather bold mono stayed closer to what ships today:

```diff
-  weight: ["400", "600"],
+  weight: ["400", "700"],
```

Cost is 10,128 B versus 600's 10,120 B, an **8 byte** difference. On a common baseline of the 500 face: today's synthetic bold is **+44.6%** ink (measured), a real 700 is **+28.8%** (**inferred, not measured**: neither build emits a 700 face, so nobody has rendered one), a real 600 is **+14.4%** (measured). Both real options are lighter than what ships now; 700 is the closer of the two. That is the entire trade. 600 was the ruling and 600 is what is built here.

## No reflow

IBM Plex Mono's advance is 0.6em at every weight and synthetic bold does not widen it. Measured advance for the same string at 400 / 500 / 600 / 700 / 800:

```
10px  102.000px      12px  122.406px      17px  173.406px      identical at every weight, before and after
```

No line-wrap, truncation or ellipsis moves anywhere.

## Weight only, proven mechanically

No font SIZE, no font FAMILY, no colour changed. Verified by extracting every such token from both sides of every changed line:

```
size tokens   (text-[Npx], font-size, fontSize, Npx/N)  : 43 tokens, byte identical on - and + sides
colour/family (var(--x), #hex, text-*, bg-*, font-data|mono|sans|display, MONO consts) : 83 tokens, byte identical
```

## What changed

49 mono weight declarations across 30 files, all to 600, plus `layout.tsx` for 31 files total. `layout.tsx` goes `["400","500"]` to `["400","600"]`, and its weight comment is rewritten to state what is now true.

48 are recon's unfenced table. **One is an addition:** `src/app/deal-flow/page.tsx:782`, the "Save Deal" button, sibling of the "Cancel" button at :791 that recon did list. Both sit in the same `{showForm && ...}` block. Recon's table came from a DOM sweep, and a sweep only sees what rendered; the add-deal form is closed by default. It is plex-resolving, carries 700, and is not fenced, so it was in scope. Flagging it rather than burying it.

## Fenced: 6 proposals, not edits

Per CLAUDE.md propose-only and the sprint `/radar` fence. **All six are `font-bold` to `font-semibold`.** Until they land they will render as the real 600 face anyway (700 matches down), so this is a source-truth cleanup, not a visual one.

```diff
--- a/src/components/memo/MemoModal.tsx	(line 394)
-                "font-data text-[10px] font-bold uppercase border cursor-pointer transition-colors",
+                "font-data text-[10px] font-semibold uppercase border cursor-pointer transition-colors",

--- a/src/components/memo/MemoModal.tsx	(line 408)
-                "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-gold/40 bg-gold-muted text-gold font-data text-[10px] font-bold uppercase cursor-pointer hover:bg-gold/10 transition-colors",
+                "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-gold/40 bg-gold-muted text-gold font-data text-[10px] font-semibold uppercase cursor-pointer hover:bg-gold/10 transition-colors",

--- a/src/components/memo/MemoModal.tsx	(line 418)
-              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-border-base text-text-muted font-data text-[10px] font-bold uppercase cursor-pointer hover:text-text-primary transition-colors"
+              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-border-base text-text-muted font-data text-[10px] font-semibold uppercase cursor-pointer hover:text-text-primary transition-colors"

--- a/src/app/radar/calls/page.tsx	(line 813)
-          <span className="font-mono text-[17px] font-bold">
+          <span className="font-mono text-[17px] font-semibold">

--- a/src/app/radar/watchlist/page.tsx	(line 1620)
-        <span className="font-data text-[13px] font-bold text-text-primary truncate">
+        <span className="font-data text-[13px] font-semibold text-text-primary truncate">

--- a/src/components/radar/WatchlistGallery.tsx	(line 98)
-        className="inline-flex h-9 min-w-9 items-center justify-center rounded-md px-1.5 font-mono text-[13px] font-bold text-cream"
+        className="inline-flex h-9 min-w-9 items-center justify-center rounded-md px-1.5 font-mono text-[13px] font-semibold text-cream"
```

`WatchlistGallery.tsx` is not under `app/radar/` but renders only on radar routes, so it is treated as fenced.

Also flagged, no edit needed but it shifts visually: **`src/app/radar/track-record/page.tsx:376`** is in the already-600 set (`font-data font-semibold`). It lightens ~20% with no source change, on a fenced route.

## Separate finding: the 10px floor is already violated at 7 sites

Independent of this work. **Not fixed here** on purpose: a weight retune that silently also changes sizes is two changes wearing one hat.

| site | rendered size |
|---|---:|
| `dashboard/watchlist-feed.tsx:169` | 8px |
| `dashboard/your-calls-widget.tsx:242` | 8.5px |
| `share/brief/[id]/page.tsx:245` | 9px |
| `thesis/thesis-detail-panel.tsx:488` | 9px |
| `dashboard/competitor-alerts-widget.tsx:67` | 9px |
| `ui/eyebrow.tsx:35` | 9.5px |
| `landing.module.css:345` | 9.5px |

**This makes `design:lint --since origin/main` report 5 new errors, and they are line-attribution artifacts, not regressions.** `--since` attributes a pre-existing violation to whoever last touched the line, and 5 of the 7 sites are on the change list. The size token on each is byte-identical to `origin/main`:

```
page.tsx:245                     main=text-[9px]        branch=text-[9px]
competitor-alerts-widget.tsx:67  main=text-[9px]        branch=text-[9px]
watchlist-feed.tsx:169           main=text-[8px]        branch=text-[8px]
landing.module.css:345           main=font-size: 9.5px  branch=font-size: 9.5px
eyebrow.tsx:35                   main=text-[9.5px]      branch=text-[9.5px]
```

### The 10 `all-caps` warnings are a linter defect, not a judgement call

Not mine to fix, logged here because this PR turned up the ground for it. The rule at `scripts/design-lint.mjs:395` is:

```js
if (UPPERCASE.test(raw) && !/mono|ledger|eyebrow/i.test(raw)) {
  add('WARN', file, n, 'all-caps', 'capitals survive only in the monospace ledger line');
}
```

All ten flagged lines carry `font-data`, which **is** the mono class: `globals.css:146` defines `.font-data { font-family: var(--font-plex-mono), monospace }`. So all ten already satisfy the rule's own stated intent, and the exemption regex simply does not recognise `font-data` as meaning mono. All ten were uppercase on `main`, unchanged by this PR. Worth its own issue against the linter.

## Handoff to X4: JetBrains Mono is not loaded

33 declarations across 15 files hardcode `'JetBrains Mono', monospace`, a family the app never loads. **911 rendered elements fall through to the platform generic monospace** (721 at w400, 190 at w500). Measured identically on both builds, which is what makes it a clean pre-existing defect rather than anything this PR touched.

**X4 must land those on 400/600, not 400/500.** After this PR there is no 500 face, so any of those 190 w500 elements moved onto the real mono stack would silently match down to 400.

`shell/mood-debug-overlay.tsx:48` is deliberately `ui-monospace` and should be left alone.

## Verification

| gate | result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| `eslint` | **0 errors**, pre-existing warnings only, unchanged count on both refs (I measure 78, an independent run measured 81; zero new either way) |
| `next build` | **success** |
| `design:lint --since origin/main` | 5 errors, all proven line-attribution on unchanged sizes (above) |

Live measurement: production build on port 3253, signed in, Playwright at 390x844 DPR 3, awaiting `document.fonts.ready`, `/auth` locators scoped to `form:visible` because that page has two forms in the DOM.

Mono element sweep over 34 shipped routes, before and after with the identical script:

| family / weight | before | after |
|---|---:|---:|
| IBM Plex Mono w400 | 363 | 404 |
| IBM Plex Mono w500 | 21 | **0** |
| IBM Plex Mono w600 | 70 | **190** |
| IBM Plex Mono w700 | 51 | **2** |
| IBM Plex Mono w800 | 15 | **0** |
| JetBrains Mono w400 (system mono) | 721 | 721 |
| JetBrains Mono w500 (system mono) | 190 | 190 |

500, 700 and 800 are gone from the rendered mono surface. The two surviving w700 sites are both fenced: `radar/calls/page.tsx:813` and a 13px `font-bold` fence on `/preview/radar`. The JetBrains counts of **721 / 190 reproduce recon's baseline exactly** in both runs, and w700 = 51 and w800 = 15 reproduce recon's before-state exactly, which cross-validates the harness.

Caveat, stated rather than hidden: per-route counts drift run to run because several routes render async data and the sweep settles on a fixed timer, so my absolute IBM Plex Mono totals are lower than recon's 1561 (route coverage, not a behaviour difference). Every load-bearing claim in this PR rests on the deterministic evidence instead: `document.fonts`, the md5 captures, the emitted byte totals, and the static token diff.

## Screenshots

`docs/design/mono-real-bold/`, three comparison sheets plus the ten isolated `ticker-*` weight captures:

- `comparison-17px.png` the weight ladder, before and after, with the faux bold called out
- `comparison-morning-brief.png` the Morning Brief ticker strip and brief stat row at 2.4x, light theme, where the lightening is legible
- `comparison-dashboard-market-band.png` the dashboard MARKET band before and after, light and dark, at native capture pixels, where the same lightening lands on the largest mono in the app

**Twelve full-page 390x844 plates were removed from this directory in a later commit on this branch.** They were captured signed in and carried account data on a public repository: the greeting and avatar, a personal record row, and the personalization chip row. Four of them were also mislabelled, rendering the Morning Brief reader rather than a ledger. The three sheets above carry the same claim on the same surfaces and carry no account data. See `docs/design/mono-real-bold/README.md` for what came out, what it published, and why the blobs are being left reachable in history by an explicit decision.

# Batch 4 build brief: Ask browse, Ask answer, Search

Scope: the three screens of the Ask pole's entry layer. The destinations they
link to (Deal Flow, Trends, Live Feed, Company Intel) belong to other batches
and are referenced here only as link targets.

Prototype file: `design_handoff_signalera_mobile/Signalera Mobile v3.dc.html`.
All line numbers below are from that file.

---

## Screens

### Ask (browse)

**Flag:** `isAskBrowse`. Confirmed in the prototype at line 742
(`<sc-if value="{{ isAskBrowse }}" ...>`), bound at line 3239
(`isAskBrowse: s.screen === 'ask'`). Per-screen clock `ask: '12:44'` at line 3234.

**Route:** NEW ROUTE NEEDED. Propose `src/app/ask/page.tsx`. Nothing under
`src/app/` corresponds to it; the directory listing of `src/app/` has no `ask`
and no `search` entry. This screen is a tab-bar root: line 3460 reads
`showNav: ['dash', 'ledger', 'watch', 'ask'].includes(s.screen)`, so the bottom
nav renders here and does not render on the other two screens in this batch.

**Repo sources github.md maps to it:** none. github.md marks this screen
designed fresh. See the "Designed fresh" section for the verbatim quote.

Files I opened while confirming that the screen has no repo counterpart and to
establish where it lands in the shell. These are routing facts, not provenance
mappings from github.md:

- `src/components/shell/mobile-bottom-nav.tsx`: the live mobile nav is five
  items plus a `More` details menu (Dashboard, Feed, Radar, Deals, Trends;
  overflow carries Morning Brief, Evening Wrap, Company Intel, Tracked Views,
  Thesis Tracker). There is no Ask item and no Search item. The four-pole model
  replaces this file wholesale.
- `src/components/shell/app-shell.tsx`: mounts `MobileBottomNav` and
  `CommandPalette`; the palette is opened only by the Cmd/Ctrl-K handler at
  lines 74 to 83 and by `Topbar`'s `onCommandOpen`. Nothing on a touch surface
  opens it today.
- `src/app/company/page.tsx`: the destination of the browse screen's recent
  lookup rows (`goCompany`). It is a desktop directory table with a
  `min-w-[900px]` table, j/k keyboard nav, a signed-out lock overlay past row 6,
  and slug navigation via `router.push('/company/' + slugify(name))`. Nothing in
  it stores or renders a per-user recent-lookup list.

**What the screen contains** (prototype lines 744 to 763): H1 "Ask" plus a
subline; a `browse` rule with three rows (Deal Flow / Trends / Live Feed, each
with a mono counter and a one-line summary); a `company intel` rule with three
recent-lookup rows (CEG, NVO, XYL, each with an entry count); a two-chip
suggested-prompt row; and the Ask composer field with a 48px espresso send
button.

### Ask (answer)

**Flag:** `isAskAnswer`. Confirmed at line 2549, bound at line 3239
(`isAskAnswer: s.screen === 'answer'`). Clock `answer: '12:45'` at line 3234.

**Route:** lands at the existing `/intelligence` route. `showNav` at line 3460
excludes `answer`, so this is a pushed detail view with its own back affordance
(line 2551, a chevron labelled "Ask" wired to `goAsk`), not a tab root. If Ask
browse takes `/ask`, the back chevron points at `/ask` while the screen itself
lives at `/intelligence`. That is functional but the URL no longer expresses the
hierarchy. See Open questions.

**Repo sources github.md maps to it:**

- `src/app/intelligence/IntelligenceChat.tsx`: opened. `SUGGESTED_PROMPTS`
  (lines 60 to 64) is exactly three strings: "What are the strongest theses this
  week?", "Summarize recent M&A activity", "Which sectors show the most
  momentum?". The field prompt is "Ask about your market intelligence..." (line
  299) and the framing line is "AI research assistant" (lines 184 to 186). All
  three are what the prototype renders. The file also carries: per-message
  thumbs feedback via `useOutputFeedback` (lines 68 to 95), a react-markdown
  override map (lines 12 to 50), avatar bubbles for both roles (lines 240 to
  267), a `Loader2` spinner thinking bubble (lines 272 to 284), and an in-thread
  error turn that renders the failure as an assistant message (lines 156 to
  161). None of the last four appears in the prototype.

- `src/app/intelligence/page.tsx`: opened. Server component, `force-dynamic`,
  redirects to `/auth` when there is no user, wraps the chat in
  `<AppShell pageTitle="Intelligence">`. The mobile answer screen has no AppShell
  chrome, so this wrapper is the thing that changes.

- `src/app/api/intelligence/route.ts`: opened. Relevant to the states and to
  the citation proposal: 401 when not authenticated (line 74), 400 on bad body
  (lines 87 and 92), 429 with a per-day cap of 15 messages (`RATE_LIMIT_CHAT`,
  line 43; response at lines 103 to 110), 503 when the pgvector RPC is not
  installed (line 174), 500 on embed, search, fetch or generation failure. It
  also carries `EMPTY_KB_RESPONSE` at lines 45 to 46: "I don't have enough
  research data yet. The knowledge base will populate after the next pipeline
  run." **The route already emits a `sources` array** (line 357,
  `{ response, sources, remaining, output_id }`), built from articles and theses
  only (lines 207, 211, 246, 254). `IntelligenceChat.tsx` never reads it.

### Search

**Flag:** `isSearch`. Confirmed at line 1399, bound at line 3653
(`isSearch: s.screen === 'search'`). Clock `search: '12:44'` at line 3234.

**Route:** NEW ROUTE NEEDED. Propose `src/app/search/page.tsx`. There is no
`/search` under `src/app/`. `showNav` excludes `search`, so this is also a
pushed view with a Cancel affordance (line 1406, wired to `goAsk`) rather than a
tab root. A modal overlay owned by `/ask` is the alternative; see Open questions.

**Repo sources github.md maps to it:**

- `src/components/shell/command-palette.tsx`: opened. The `commands` array
  (lines 21 to 34) is twelve items in the order github.md names. Two facts an
  implementer needs that the array order alone hides:
  1. **Array order is not render order.** Grouping happens at lines 79 to 84 via
     a `Map` keyed by `section`, so `Pages` renders first and `Settings` (array
     index 11, section `Pages`) renders as the fifth Pages item, not last
     overall. The prototype's empty state (lines 1411 to 1428) matches the
     rendered order exactly: PAGES = Dashboard, Morning Brief, Evening Wrap,
     Live Feed, Settings; RESEARCH = Radar, Tracked Views, Thesis Tracker, Deal
     Flow, Watchlist, Trends, Company Intel.
  2. **Typing filters the jump list in the palette; it replaces it in the
     design.** The palette filters on `cmd.label.toLowerCase().includes(query)`
     (lines 42 to 44) and shows the surviving Pages/Research rows. The prototype
     hides both groups the moment `query` is non-empty (`queryEmpty:
     !s.query.trim()`, line 3661) and renders entity groups instead. See
     Deviations.
  Also in the file and not in the design: arrow-key selection with a highlighted
  row (lines 58 to 74, 152 to 155), and the footer hint strip for up/down, enter
  and esc (lines 168 to 181).

- `src/components/shell/app-shell.tsx`: opened. Confirms the palette has no
  touch entry point today (Cmd/Ctrl-K plus a Topbar button only), so a mobile
  Search route is genuinely new surface, not a restyle of an existing one.

github.md's own words on the entity half: "Entity results below the jump list
are this project's addition; the palette does not do entity search." I did not
go looking for a substitute source for it.

---

## Shared component to extract first

**The Ask list row.** Working name `AskListRow`.

Every one of the three screens is built out of it, six instances total, and if
it is not extracted first each screen forks its own copy at a different density
and the batch ships three anatomies for one object.

Consumers and what varies:

| Instance | Screen | Line | Height | Left slot | Title | Sub | Right |
|---|---|---|---|---|---|---|---|
| Directory row | Ask browse | 747 to 749 | `min-height:64px`, `padding:15px 0` | 18px stroked SVG icon, `margin-top:2px` | 15px Inter 600 | 12.5px Inter 400, two lines | mono counter on the title baseline ("4 new", "3 moved", "142 today") |
| Recent lookup | Ask browse | 752 to 754 | `min-height:56px` | 44px fixed-width mono ticker | 14px Inter 500 | 10.5px Inter 400 entry count | 14px chevron |
| Jump list row | Search, empty | 1413 to 1427 | `min-height:48px` | none | 13.5px Inter 400 `--c-body` | none | 14px chevron |
| Company result | Search, typed | 1434 to 1435 | `min-height:60px` | 46px fixed-width mono ticker, `letter-spacing:0.045em` | 14px Inter 500 | 11.5px Inter 400, sector plus ledger relation | 14px chevron |
| Deal result | Search, typed | 1442 | `min-height:56px` | none | 14px Inter 500 | 11.5px Inter 400, stage plus size plus date | 14px chevron |
| Ask-the-desk affordance | Search, typed | 1444 | `min-height:52px` | none | 13.5px Inter 400 with a 600 span | none | 15px gold arrow, and this one is a bordered 12px-radius card, not a hairline row |

So the axes are: row height, presence and width of a mono left slot, presence of
an icon slot, presence of a subtitle, and the right-hand affordance (chevron,
mono counter, gold arrow, or nothing). Border treatment is uniform:
`border-top:1px solid var(--c-hair)` on every row with
`border-bottom` added on the last row of a group.

The one instance that is not the row is the ledger result at Search line 1437 to
1440: a stacked state header (dot, state word, date) over Playfair claim text.
That is the scored-object anatomy, not a list row, and it should compose the
existing outcome vocabulary rather than a variant of this row.

Grounding: the closest existing implementation is the palette's item button at
`src/components/shell/command-palette.tsx` lines 142 to 159. It is the right
semantics (a real `<button>` with an icon slot and a label) and the wrong
geometry: `px-4 py-2` at 13px, which does not reach the handoff's 44px tap floor.
The row also needs the accessibility rule from README: a container that already
contains a focusable control must not itself be focusable, so the row is one button,
not a focusable div wrapping one.

Second in build order, not first, is the Ask composer (browse lines 756 to 763
versus answer lines 2567 to 2573). It is byte-identical across both Ask screens,
which makes it a single extraction with no variant axis, so it can follow the row.

---

## Component inventory

| Component | Existing path | Status | Note |
|---|---|---|---|
| `AskListRow` | `src/components/shell/command-palette.tsx` (item button, lines 142 to 159) | Net new | Closest analogue named. Six variants above; palette button is 13px `px-4 py-2` and misses the 44px floor. |
| Ask composer (chip row + field + send) | `src/app/intelligence/IntelligenceChat.tsx` (form, lines 290 to 319) | Needs variant | Source is a flat `<input>` plus a gold icon button. Design is a 48px `--c-surface` field at 12px radius plus a separate 48px square espresso button with a gold up-arrow. Identical on both Ask screens. |
| Suggested prompt chips | `src/app/intelligence/IntelligenceChat.tsx` `SUGGESTED_PROMPTS`, lines 60 to 64 | Strings reusable as-is; chip needs variant | Source chip is `px-3 py-2 rounded-xl text-[12px]`, roughly 34px tall. Design chip is `min-height:44px`, 9px radius, 11.5px Inter. |
| Search field | `src/components/ui/input.tsx` | Needs variant | `Input` is `h-9` (36px), under the 44px floor. Design field is 46px, 12px radius, `1px solid var(--c-gold)` border, with a 15px leading magnifier and no separate submit control. |
| Section eyebrow (PAGES / RESEARCH / COMPANIES / YOUR LEDGER / DEALS / ASK THE DESK) | `src/components/ui/eyebrow.tsx` | Needs variant | Neither existing variant matches. File offers `sans` at 10px / `0.14em` and `mono` at 9.5px / `0.10em`. Design is 10px JetBrains Mono at `0.07em` in `--c-muted`, and 9.5px is under the handoff's 10px scale floor. |
| Italic Playfair section rule (`browse`, `company intel`) | `src/components/ui/eyebrow.tsx` | Net new | Different object from the eyebrow: 12.5px italic Playfair in `--c-secondary` with a 1px `--c-border` rule filling the remaining width. Eyebrow is the closest analogue and is uppercase-only. |
| Answer prose renderer | `src/app/intelligence/IntelligenceChat.tsx` `mdComponents`, lines 12 to 50 | Needs variant | Source: 13px `text-text-secondary` paragraphs, 17/15px display headings. Design: 13.5px/1.65 Inter body in `--c-body`, 16px Playfair 700 subheads in `--c-ink`, `text-wrap:pretty`. |
| Chat turn bubbles | `src/app/intelligence/IntelligenceChat.tsx`, lines 232 to 268 | Needs variant | Design drops both avatars. User turn is a right-aligned `max-width:82%` card on `--c-well` with a `--c-border` hairline at 14px radius; assistant turn is bare prose with no container. |
| Record citation block | `src/lib/your-record.ts` (`YOUR_RECORD_COPY`, `YourRecord`, lines 43 to 86) | Net new | github.md says this block is not in the source. Closest analogue is the user-record model, which already owns the supported / challenged / awaiting vocabulary and the counts the block would read from. Prototype instance at lines 2560 to 2564. |
| Outcome state chip (dot + word) | `src/components/thesis/OutcomeBadge.tsx` | Needs variant | Source is an uppercase rounded-full data pill with a lucide icon at 8 or 10px, below the 10px floor at `sm`. Design is a 7px dot plus a 11px Inter 600 sentence-case word in `--c-redink`, no icon, no pill. Search typed state, line 1438. |
| No-result empty state | `src/components/ui/empty-state.tsx` | Needs variant | Source is icon + 15px display title + 12px body, centred, `py-16`. Design is no icon, 16px Playfair 500 title, 13px/1.6 body, `padding:44px 8px 0`. The palette's own inline "No results found" (`command-palette.tsx` lines 129 to 132) is the string github.md adopted. |
| Bottom tab bar | `src/components/shell/mobile-bottom-nav.tsx` | Needs variant | Six items to four poles, and it must not render on Search or Ask answer (`showNav`, prototype line 3460). Current file renders on every route under `AppShell`. |
| Per-message thumbs feedback | `src/app/intelligence/IntelligenceChat.tsx` `ChatMessageFeedback`, lines 68 to 95 | Reusable as-is | Has no counterpart anywhere in the prototype. Keeping it or dropping it is a decision, not a port. It is also hover-revealed (`opacity-0 group-hover/msg:opacity-100`), which does nothing on a touch surface. |

---

## States

### Ask (browse)

- **Loading:** UNSPECIFIED. No `isAskBrowse` loading variant exists in the
  prototype, and the dev strip carries lifecycle jumps only for the brief, the
  wrap, the commit failure and the splash (prototype lines 2666 to 2671).
- **Error:** UNSPECIFIED.
- **Empty:** UNSPECIFIED. The three directory rows carry live counters ("4 new",
  "3 moved", "142 today") and the recent-lookup group carries three rows; the
  handoff does not say what either renders at zero.
- **Stale:** UNSPECIFIED.

### Ask (answer)

- **Loading:** UNSPECIFIED in the handoff. Repo-side only, not a handoff spec:
  `IntelligenceChat.tsx` lines 272 to 284 render a spinner bubble.
- **Error:** UNSPECIFIED in the handoff. Repo-side only: the client turns a
  failure into an assistant message reading "Something went wrong: {message}.
  Please try again." (lines 156 to 161), and the route can return 401 / 400 /
  429 / 500 / 503.
- **Empty:** UNSPECIFIED in the handoff for the answer screen itself. Repo-side
  only: `EMPTY_KB_RESPONSE` in `src/app/api/intelligence/route.ts` lines 45 to 46.
  The source component's zero-message empty state (lines 197 to 228) has no
  prototype counterpart, because in the mobile model Ask browse is what the user
  sees before a question.
- **Stale:** UNSPECIFIED.

### Search

README specifies three, and they are carried here exactly:

> Live. Empty state shows the command palette's own two groups (Pages /
> Research) with its real destination labels. Typed state groups results by
> object type — companies, the user's ledger, deals, then an ask-the-desk
> affordance. No-result state names what coverage actually runs to.

- **Empty (no query):** PAGES and RESEARCH jump lists, rendered in the palette's
  own group order. Prototype lines 1409 to 1430. Driven by
  `queryEmpty: !s.query.trim()` (line 3661).
- **Typed (results):** COMPANIES, YOUR LEDGER, DEALS, ASK THE DESK, in that
  order. Prototype lines 1431 to 1446. Driven by `queryTyped` (line 3662).
- **Typed (no result):** "No results found" over "Coverage runs to US and
  European listed names, live deal processes, and the themes the desk tracks."
  Prototype lines 1447 to 1452. Driven by `queryNone` (line 3663).
- **Loading:** UNSPECIFIED. There is no in-flight state between typing and
  results; the prototype resolves synchronously from a prefix regex.
- **Error:** UNSPECIFIED. Note the handoff's own principle, stated for the brief
  and quoted in github.md from `cross-source/page.tsx`, that a failed read must
  not read as an empty one. Search has no error state that honours it.
- **Stale:** UNSPECIFIED.

**Cross-cutting contradiction, flagged not resolved.** README opens with:

> **31 screens**, all reachable, each with its loading, error, empty and stale
> states.

The prototype does not carry those four states for any of this batch's three
screens beyond Search's three query states. Both sides quoted; not resolved here.

---

## Lucas-protected files

Of the four, this batch's sources touch exactly one, and only as a link target.

- **`src/app/trends/page.tsx`**: reached from the Ask browse Trends row
  (prototype line 748, `goTrends`) and the Search RESEARCH jump row (line 1426,
  `goTrends`). Both are navigations to `/trends`. The file is not read, imported
  or edited by anything in this batch. It lands as a `<Link href="/trends">` in
  the new `AskListRow`, exactly as `command-palette.tsx` line 31 already routes
  there today. No diff to the file is required or proposed.

- `src/app/api/briefing/route.ts`: not touched. No screen in this batch reads
  the briefing.
- `src/lib/watchlist-utils.ts`: not touched. The Search RESEARCH jump row
  labelled "Watchlist" navigates to `/radar/watchlist`; it does not read
  watchlist data.
- `src/components/watchlist/WatchlistAddInput.tsx`: not touched.

Also worth stating because it is adjacent and easy to trip over: `src/app/api/memo/route.ts` and `src/components/memo/MemoModal.tsx` are propose-only per CLAUDE.md and are not touched here either; the memo surface belongs to the Company Intel batch.

---

## Designed fresh, no repo counterpart

**Ask directory.** github.md, screen map, verbatim:

> | Ask directory | designed fresh. No mobile browse surface exists in the repo, though `command-palette.tsx` is the desktop jump surface and now grounds the Search screen. |

That is the whole provenance record for the screen. No substitute source was
sought and none is proposed. The screen is net new and its structure is the
design project's own.

The other two screens in this batch are not marked designed fresh: Search maps to
`command-palette.tsx` and Ask / Intelligence maps to `IntelligenceChat.tsx`.

---

## NOT PORTED and deviations

Everything below is scoped to these three screens.

**1. The record-citation block on the answer screen is a proposal, not a port.**
github.md, screen map:

> | Ask / Intelligence | `src/app/intelligence/IntelligenceChat.tsx` — read. Adopted the real SUGGESTED_PROMPTS, the "Ask about your market intelligence" field prompt, and the "AI research assistant" framing. The record-citation block is NOT in the source and is retained as an explicit design proposal. |

The block is prototype lines 2560 to 2564: eyebrow "YOU ALREADY HAVE A CALL HERE
· CALL-0409", the claim in italic Playfair, then "Entered Jul 22, evidence
strengthening, settles Sep 12."

**2. Entity search is the design project's addition.** github.md, screen map:

> | Search | `src/components/shell/command-palette.tsx` — read. Adopted the PAGES / RESEARCH section split, the real destination labels with Dashboard as the first Pages item exactly as the palette orders it (Dashboard, Morning Brief, Evening Wrap, Live Feed, Radar, Tracked Views, Thesis Tracker, Deal Flow, Watchlist, Trends, Company Intel, Settings) and the "No results found" empty state. Entity results below the jump list are this project's addition; the palette does not do entity search. |

Note the wording "below the jump list". In the prototype the entity results do
not sit below the jump list, they **replace** it: `queryEmpty` and `queryTyped`
are mutually exclusive (lines 3661 to 3662), so PAGES and RESEARCH disappear on
the first keystroke. github.md's own sentence and the prototype disagree on the
layout relationship. Flagged, not resolved.

**3. Palette filtering behaviour is not ported.** `command-palette.tsx` lines 42
to 44 filter the twelve jump destinations by label substring, so typing "trend"
narrows to the Trends row. In the design, typing anything hides both groups. A
user who types a page name in the mobile Search gets entity results or the
no-result state, never the page. Not called out anywhere in README or github.md.
Flagged as a behavioural deviation.

**4. Three palette destinations collapse under the four-pole model.** In the
prototype's RESEARCH list: "Radar" and "Watchlist" both fire `goWatch` (lines
1421 and 1425), so two labels reach one destination; and "Tracked Views" fires
`goRecord` (line 1422) rather than the palette's
`/radar/calls?views=open` (`command-palette.tsx` line 27). README states the
cause:

> The desktop product's nine surfaces resolve into these four. `Radar` is
> dismantled: its `Calls` tab becomes the Ledger at top level, `Following` and
> `Watchlist` merge into Watch, and `Desk record` keeps its own screen.

So twelve palette labels no longer map to twelve mobile destinations. The design
keeps all twelve labels anyway. Flagged.

**5. Palette keyboard apparatus not ported.** The arrow-key selection model
(`command-palette.tsx` lines 58 to 74 and the selected-row treatment at lines 152
to 155) and the footer hint strip (lines 168 to 181) have no prototype
counterpart; the mobile screen has a Cancel affordance instead. Not flagged
anywhere in the handoff. Reasonable for a touch surface, but it is an omission,
not an adoption.

**6. Chat apparatus not ported on the answer screen.** Avatars, the spinner
thinking bubble, the in-thread error turn, and the hover-revealed thumbs
feedback all exist in `IntelligenceChat.tsx` and none appears in the prototype.
Not flagged anywhere in the handoff.

**7. The route's `sources` payload is unrendered on both sides.**
`src/app/api/intelligence/route.ts` line 357 emits `sources`;
`IntelligenceChat.tsx` never reads it; the prototype's answer screen cites
nothing except the user's own call. So the design proposes a citation apparatus
while an existing one goes unused. Not a stated deviation, but it is the same
subject and the two should be reconciled before the screen is written.

**8. Design-system deviation that lands on Search's chrome.** README, forbidden
visual treatments:

> Frosted glass, gradients on surfaces, **coloured left borders**, all-caps
> decorative treatments.

`src/app/company/page.tsx` line 701 gives the highlighted directory row
`border-l-2 border-l-gold`. That file is a Search destination rather than a
Search component, so nothing in this batch inherits it, but the same row idiom
must not be carried into `AskListRow`.

---

## Open questions

1. **Does Ask answer keep `/intelligence` or move under `/ask`?** The existing
   route works and is already auth-gated, but the back chevron says "Ask" and the
   URL says intelligence. Options: keep `/intelligence` and treat `/ask` as a
   nav-model parent only; or add `src/app/ask/answer/page.tsx` and leave
   `/intelligence` as the desktop route. This decides whether one component
   serves both viewports or two routes diverge.

2. **Is Search a route or an overlay?** As a route (`src/app/search/page.tsx`)
   it gets a URL, browser back, and shareability. As an overlay owned by `/ask`
   it keeps the Cancel semantics the prototype uses and avoids a back-stack entry
   for a transient surface. README's gesture rule ("nothing bound to the left
   edge, browser back owns it") argues for a real route. Not decided anywhere in
   the handoff.

3. **What backs the entity half of Search?** The design queries companies, the
   user's ledger, and deals in one pass. Today `GET /api/companies?q=` covers
   companies only; `/api/company-search` is a Clearbit autocomplete proxy that
   gives back name and domain and nothing about coverage. There is no endpoint that
   searches `user_claims` or deals. Either a new unified search route is in
   scope for this batch or the typed state ships companies-only at first.

4. **Where do "recent lookups" come from?** Ask browse renders three companies
   with per-name entry counts ("2 of your entries"). Nothing in the repo records
   which companies a user opened; `src/app/company/page.tsx` navigates by slug
   and stores nothing. This needs either a client-side store or a table, and it
   is a data decision, not a styling one.

5. **What are the browse row counters actually counting?** "4 new", "3 moved",
   "142 today". README's rule is that any figure describing state must be read
   from state and never typed, so each of the three needs a defined source and a
   defined interval before the screen can ship. The Deal Flow row goes further
   and names a specific deal ("Largest since yesterday: Hologic, $18.3B, under
   LOI"), which implies a query, not a count.

6. **Does the record-citation block ship?** It is the strongest idea on the
   answer screen and github.md marks it an explicit proposal rather than a port.
   Shipping it means the intelligence route must retrieve the user's own claims,
   which it does not do today; it retrieves articles and theses only. That is a
   backend change, so the answer determines the batch's real size.

7. **Which suggested prompts render, and by what rule?** The source has three.
   Ask browse renders prompts 1 and 3 (lines 757 to 758); Ask answer renders
   prompts 2 and 3 (lines 2568 to 2569) after prompt 1 was asked. Two chips fit
   one line at 390px. Is the rule "the two not yet asked", "the first two
   unasked", or is the prototype just sampling? Browse showing 1 and 3 rather
   than 1 and 2 does not fit any of those cleanly.

8. **Do the twelve palette labels stay twelve on mobile?** Given deviation 4,
   two rows go to the same place and one goes somewhere the palette does not.
   Either the mobile jump list is trimmed to the destinations that actually
   exist, or the duplicates stay for recognisability. This changes the empty
   state, which README specifies as the palette's own two groups with its real
   destination labels.

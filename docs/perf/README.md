# Memo chunk deferral, evidence plates

Captured for the PR that moved `react-markdown` off the first load by putting
`MemoModal` behind `MemoModalLazy`.

All five plates are **390x844, deviceScaleFactor 3, iOS UA, signed OUT**, taken
against a local production build (`npm run build` then `npx next start`).

| plate | what it shows |
| --- | --- |
| `memo-modal-light-390x844.png` | memo open, light theme, markdown rendered |
| `memo-modal-dark-390x844.png` | memo open, dark theme, markdown rendered |
| `memo-loading-scrim-390x844.png` | what a reader sees while the deferred chunk is in flight |
| `memo-chunk-failure-light-390x844.png` | the chunk request failed, light theme |
| `memo-chunk-failure-dark-390x844.png` | the chunk request failed, dark theme |

## Read this before judging the layout

**The page behind the modal is the DESKTOP feed, horizontally clipped.** That is
why the header reads "eed Beta" instead of "Live Feed". It is an artifact of how
these were staged, not a rendering defect, and a real 390 px client never looks
like this.

At 390 px the visible feed is `FeedMobileScreen`, and **it has no memo entry
point at all**. The component that owns the memo trigger is `FeedRow`, which is
rendered into the DOM but CSS hidden behind `hidden md:block`. To reach a real
trigger at this viewport the capture harness injects one stylesheet:

```css
.md\:hidden { display: none !important }
.hidden.md\:block { display: block !important }
```

That override is the only change made to the page. Nothing else is stubbed in
the rendering path, and the modal itself is untouched, which is what these
plates are actually of.

The network layer is stubbed so the proof never calls the model and never writes
to the database: `/api/memo` answers with a fixed markdown fixture, and
`/api/outputs/record` and `/api/user-events` answer with `{}`. Next's `_rsc`
router prefetch is blocked so that a nav link to a route which still ships the
chunk cannot pull it and muddy the causality of "fetched only after the tap".

The failure plates additionally abort every `/_next/static/chunks/*.js` request
issued after the tap, which is how a network blip, a CDN edge miss or a redeploy
retiring a content hashed chunk name presents to the browser.

## Content note

These are signed out renders. No account data appears: no name, no
personalization, no watchlist, no open calls, no record counts. The avatar pill
reads "S" (signed out) rather than an account initial. The article headlines,
desk Signal scores and completeness grades visible behind the modal are product
output about public news items, not account output.

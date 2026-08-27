# Write band: geometry evidence

Six crops. **No full-page render of a signed-in view is committed here**, per
the rule in `docs/ledger-parity/PLATES-REMOVED.md`. An earlier revision of this
branch committed two, and they were replaced rather than amended: between them
they published personalization preferences, the account avatar, the whole
morning-brief lede with its figures, the evening wrap publication time and live
ticker quotes. Deleting them at the tip does not remove the blobs from history;
that question is escalated, not resolved here.

Each crop is cut to contain the band, the tab bar and nothing else that a
reader's account produced.

| file | clip | shows |
|---|---|---|
| `band-flush-390-{light,dark}.png` | y 733-844 | populated record: band flush on the tab bar, zero gap |
| `band-empty-390-{light,dark}.png` | y 543-844 | forced-empty record: band resting on the tab bar with blank headroom |
| `band-empty-430-{light,dark}.png` | y 631-932 | the width where the pre-fix defect was worst |

The empty-record crops are the proof of the fix. Before it, the band was not
pinned on a record too short to scroll: it sat at 339.9 to 391.9 against a tab
bar at 785, a 393px gap, and the page was not scrollable at any of 375, 390 or
430. See the band's comment in `src/components/ledger/ledger-screen.tsx` for
why `position: sticky` alone could never pin a last child.

The empty record was forced **at the read layer** through a temporary harness
in `src/app/ledger/page.tsx`, not by using an account that happens to have no
calls. The harness is not committed. The signed-in account this was measured on
carries open desk calls, which is precisely why the defect was invisible until
the record was forced empty.

Theme is flipped through `html.dark` / `html[data-theme="dark"]`
(`src/styles/tokens.css:680-681`). `prefers-color-scheme` does nothing in this
app.

# Three plates were removed from this branch, deliberately

`desk-wired-390-light.png`, `desk-wired-390-dark.png` and
`desk-wired-390-tail.png` were committed here and have been stripped from this
branch's history.

They were captures of `/desk-record` **signed in against production**, and this
repository is public. Between them they published the desk's real graded record
and **individual graded calls with their tickers, dates, thesis text and price
attributions**.

That is a narrower exposure than the plates removed from `wire/evening-wrap-data`
and `wire/ledger-data`, which carried OPEN calls with future review dates. These
are already-graded historical calls. It is still auth-gated product output on a
public repository.

## How these were found, which is the point

Three name-based sweeps passed this branch. Every filename here reads as a
fixture or a lifecycle state, and `desk-wired-*` looks like exactly the kind of
plate a wiring PR should carry.

They were found by **enumerating every image blob on the branch and opening
them**. That same enumeration is what found
`ledger-390-signed-in-wired-full.png`, which three sweeps had also missed
despite having "signed-in" in its name, because the pattern used did not
anticipate the `-full` suffix.

**A plate is what it is regardless of what it is called.**

## What stays, and why

Everything else on this branch was opened and checked:

- `desk-390-light/dark.png` are the design-versus-built parity plates. Both
  sides are the FIXTURE: the fabricated 64 / 39 / 18 / 22 record and the
  invented CEG, MSFT and SOFI calls. That fabricated record is the defect this
  PR exists to remove.
- `defect-fixture-record-390.png` and `defect-radar-record-390.png` are the
  evidence the defect was real, showing the two surfaces disagreeing. The Radar
  capture carries aggregate counts only, no call text.
- `desk-state-*` and `watch-state-*` are `?stage=` lifecycle states.
- `watch-*` and `pole-radar-watchlist-390.png` are the E2E account, whose
  watchlist is empty: "Your feed is empty", 0 articles.

## Note on removal

Stripping these from history required a force push, done by a human. The blobs
may remain reachable by commit SHA on GitHub until garbage collection, which
needs a request to GitHub Support.

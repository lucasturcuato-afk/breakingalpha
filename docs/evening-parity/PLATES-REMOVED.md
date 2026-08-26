# Three plates were removed from this branch, deliberately

`wired-after-390-prod-signed-in-full.png`, `wired-after-390-prod-signed-in.png`
and `wired-before-390-prod-desk-page-on-a-phone.png` were committed here and
have been stripped from this branch's history.

They were full-page renders of the Evening Wrap **signed in against production**.
The Evening Wrap is auth-gated product output, and this repository is public.
Between them the plates published:

- an OPEN desk call, still `Awaiting`, with its target and its review date
- the note that three further calls from that session were still open
- the full close narrative for the session
- the next session's setup

An unresolved position thesis is not something to publish, and a complete render
of a paid product is not evidence worth its cost. Removed rather than cropped,
because a crop of a screenshot is not a durable guarantee.

The verification those plates supported is unchanged and is still evidenced:
the fixture parity plates (`evening-390-light.png`, `evening-390-dark.png`) show
design against built on invented data, the `wired-state-*` plates show the
absent states driven through `?stage=` on a dev server, and
`wired-desk-1440-pixel-diff.png` carries the desk-unchanged proof.

**If a signed-in production plate is needed again, it belongs somewhere private,
not in a public repository, and it should be of an account with no open calls.**

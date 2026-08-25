# Two plates were removed from this branch, deliberately

`ledger-390-signed-in-claims.png` and `ledger-390-signed-in-wired.png` were
committed here and removed. They were renders of `/ledger` **signed in against
production**, and this repository is public.

Between them they published **live desk calls with their review dates**, all
unresolved at the time of capture. An open call is a position thesis. It is not
something to publish, and a render of auth-gated product output is not evidence
worth its cost.

This is the second instance tonight; see `docs/evening-parity/PLATES-REMOVED.md`.

## The rule this establishes

**Do not commit a screenshot of a signed-in view of this product to this
repository while it is public.** Not for parity, not for a wiring proof, not as
"evidence I actually observed it".

Observing the running app signed in is still REQUIRED, and it is still the only
thing that counts as verification. What changes is where the artifact lives:

- **Fixture and `?stage=` plates are fine** and carry most of the proof. They
  render invented data by construction.
- **Structural evidence is fine**: node counts, request counts, byte counts,
  computed styles, geometry, pixel-diff summaries. These demonstrate the same
  claims without reproducing the content.
- **A signed-in plate belongs somewhere private**, and should be of an account
  with no open calls.

## Note on removal

Deleting these files at the branch tip does not remove the blobs from history.
They stay reachable by commit SHA until the branch history is rewritten and
GitHub garbage-collects. That needs a force push and probably a request to
GitHub Support. Escalated for a human; this commit is not the remediation.

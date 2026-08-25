# Signed-in production plates removed, for consistency rather than severity

Removed: `390-light-top.png`, `390-light-bottom.png`, `390-dark-top.png`,
`1440-desktop-before.png`, `1440-desktop-after.png`.

**These were the least sensitive of the three sets removed tonight**, and that is
worth recording accurately rather than flattening. They showed public market
data, public news headlines, the account's own EMPTY record, and the desk's
aggregate counts. They contained **no open call, no thesis, no target and no
review date** — unlike the Evening Wrap and Ledger plates, which did.

They are removed anyway, because the rule written in
`docs/ledger-parity/PLATES-REMOVED.md` is a blanket one: do not commit a
screenshot of a signed-in view of this product to this repository while it is
public. A rule with a case-by-case exemption is not a rule, and the judgement
call it would require is exactly what failed twice tonight.

`390-data-absent.png` is KEPT. It renders the absent state and shows no account
data, which is the point of it.

## The evidence is not lost

This PR's claims were independently reproduced by a tester that did not write
the code: every claimed-real field cross-checked against the desktop widgets and
the raw payloads on the same account in the same minute, request counts at 1440
equal on both branches with an identical per-endpoint breakdown, and the fixture
chunk measured at 2,245 bytes and never fetched in production.

Structural evidence carries these claims without reproducing content: node
counts, request counts, byte counts, computed styles and geometry. Prefer them.

## Note

Removing at the tip does not remove the blobs from history. Escalated for a
human; this commit is not the remediation.

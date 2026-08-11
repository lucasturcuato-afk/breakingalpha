"""Recipients must be intersected with beta_allowlist before anything is mailed.

src/proxy.ts signs a non-allowlisted session straight back out and redirects it
to /waitlist. Mailing the brief's "Track this call" CTA to such an account means
the reader clicks, authenticates successfully, and is told they are on a waiting
list. Live at the time of writing: 107 auth users, 89 allowlist rows, 76
intersect, so 31 accounts were in exactly that position.

These tests pin the intersection and print the excluded count.
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from brief_email_send import eligible_recipients  # noqa: E402


def _user(uid: str, email: str) -> dict:
    return {"id": uid, "email": email}


class TestAllowlistIntersection(unittest.TestCase):
    def test_subscribed_but_not_allowlisted_is_excluded(self) -> None:
        users = [
            _user("u1", "in@example.com"),
            _user("u2", "out@example.com"),
            _user("u3", "alsoin@example.com"),
        ]
        # Everyone is subscribed: no profile row means the column default, true.
        profiles: dict[str, dict] = {}
        allowlist = {"in@example.com", "alsoin@example.com"}

        subscribed = eligible_recipients(users, profiles)
        recipients = eligible_recipients(users, profiles, allowlist)
        excluded = len(subscribed) - len(recipients)

        print(
            f"\n[recipients] subscribed={len(subscribed)} "
            f"allowlisted={len(recipients)} excluded={excluded}"
        )
        for u in subscribed:
            if u not in recipients:
                print(f"[recipients] excluded, not on beta_allowlist: {u['email']}")

        self.assertEqual(len(subscribed), 3)
        self.assertEqual(len(recipients), 2)
        self.assertEqual(excluded, 1)
        self.assertNotIn("out@example.com", [r["email"] for r in recipients])

    def test_the_live_shape_excludes_thirty_one(self) -> None:
        """The measured production shape: 107 accounts, 76 on the allowlist."""
        users = [_user(f"u{i}", f"user{i}@example.com") for i in range(107)]
        allowlist = {f"user{i}@example.com" for i in range(76)}

        subscribed = eligible_recipients(users, {})
        recipients = eligible_recipients(users, {}, allowlist)
        excluded = len(subscribed) - len(recipients)

        print(
            f"\n[recipients] live shape: subscribed={len(subscribed)} "
            f"allowlisted={len(recipients)} EXCLUDED={excluded}"
        )
        self.assertEqual(len(subscribed), 107)
        self.assertEqual(len(recipients), 76)
        self.assertEqual(excluded, 31)

    def test_allowlist_match_is_case_insensitive(self) -> None:
        """Allowlist rows are stored lowercased; src/lib/allowlist.ts lowercases
        the email before the lookup. Match that, or a Google account with a
        capitalised address would be dropped."""
        users = [_user("u1", "Mixed.Case@Example.com")]
        recipients = eligible_recipients(users, {}, {"mixed.case@example.com"})
        self.assertEqual(len(recipients), 1)

    def test_unsubscribe_still_wins_over_the_allowlist(self) -> None:
        users = [_user("u1", "in@example.com")]
        profiles = {"u1": {"brief_email_subscribed": False}}
        self.assertEqual(eligible_recipients(users, profiles, {"in@example.com"}), [])

    def test_no_allowlist_argument_preserves_the_old_behaviour(self) -> None:
        """None means "the caller could not read the allowlist", not "allow all
        by policy". _fetch_recipients refuses to send in that case; the pure
        function stays permissive so its two call sites can be compared."""
        users = [_user("u1", "anyone@example.com")]
        self.assertEqual(len(eligible_recipients(users, {})), 1)
        self.assertEqual(len(eligible_recipients(users, {}, None)), 1)

    def test_an_empty_allowlist_excludes_everyone(self) -> None:
        users = [_user("u1", "anyone@example.com")]
        self.assertEqual(eligible_recipients(users, {}, set()), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)

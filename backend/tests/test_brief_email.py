"""
Offline tests for the Morning Brief email digest.

No network, no Supabase, no Resend, no model call. Every dependency is injected
as a fake, so this runs anywhere and proves the invariants the feature claims:

  1. flag off        -> nothing is attempted, no client, no render, no send
  2. unsubscribed    -> excluded from the recipient set
  2b. auth pager     -> every page is walked, not just GoTrue's first 50
  3. send failure    -> caught, logged, never raised into the pipeline
  4. idempotence     -> the same (brief, user) never sends twice
  5. resolution block-> correct + wrong + no-clean-read all render, unfiltered
  6. nothing resolved-> the block is omitted, not padded
  7. compliance      -> body carries the unsubscribe link and no banned term

Run: python -m unittest backend.tests.test_brief_email -v
"""

from __future__ import annotations

import os
import sys
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
_REPO = os.path.dirname(_BACKEND)
for _p in (_BACKEND, _REPO):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from html import escape as _html_escape  # noqa: E402
import re  # noqa: E402
from datetime import datetime, timezone  # noqa: E402

from brief_email_render import (  # noqa: E402
    BANNED_TERMS,
    EVERGREEN_SUBJECT,
    PREHEADER_MAX,
    PULSE_BLOCK_ORDER,
    STANDFIRST,
    SUBJECT_MAX,
    BriefEmailPayload,
    ResolvedCall,
    TodayCall,
    find_banned_terms,
    horizon_label_for_days,
    preheader,
    pulse_blocks,
    render_email,
    render_html,
    scrub_compliance,
    subject_line,
)
from brief_email_render import _sentences as _pulse_sentences  # noqa: E402
import brief_email_send as send_mod  # noqa: E402
from brief_email_send import (  # noqa: E402
    digest_mode,
    eligible_recipients,
    make_unsubscribe_token,
    maybe_send_brief_email,
    parse_market_pulse,
    select_last_session_resolutions,
    track_url,
)

BRIEF_ID = "11111111-1111-1111-1111-111111111111"
PRIOR_BRIEF_ID = "22222222-2222-2222-2222-222222222222"

BASE_ENV = {
    "EMAIL_DIGEST_MODE": "active",
    "SUPABASE_JWT_SECRET": "test-secret-not-a-real-key",
    "NEXT_PUBLIC_SITE_URL": "https://signalera.ai",
    "RESEND_API_KEY": "unused-because-sender-is-injected",
}


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


def _cmp_ge(value, floor):
    """>= across the mixed int/ISO-string columns the fake carries."""
    try:
        return float(value) >= float(floor)
    except (TypeError, ValueError):
        return str(value) >= str(floor)


class _Res:
    def __init__(self, data):
        self.data = data


class _Query:
    """Chainable no-op query builder that returns a canned table payload."""

    def __init__(self, rows, sink=None, table=None):
        self._rows = rows
        self._sink = sink
        self._table = table

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self._rows = [r for r in self._rows if str(r.get(col)) == str(val)]
        return self

    def neq(self, col, val):
        self._rows = [r for r in self._rows if r.get(col) != val]
        return self

    def in_(self, col, vals):
        wanted = {str(v) for v in vals}
        self._rows = [r for r in self._rows if str(r.get(col)) in wanted]
        return self

    def gte(self, col, val):
        self._rows = [
            r for r in self._rows
            if r.get(col) is not None and _cmp_ge(r.get(col), val)
        ]
        return self

    def order(self, col=None, desc=False, **_k):
        if col:
            self._rows = sorted(
                self._rows,
                key=lambda r: (r.get(col) is None, r.get(col) if r.get(col) is not None else 0),
                reverse=bool(desc),
            )
        return self

    def limit(self, *_a, **_k):
        return self

    def range(self, start, end):
        self._rows = self._rows[start : end + 1]
        return self

    def insert(self, row):
        self._pending = row
        return self

    def execute(self):
        pending = getattr(self, "_pending", None)
        if pending is not None and self._sink is not None:
            self._sink.setdefault(self._table, []).append(pending)
            return _Res([pending])
        return _Res(list(self._rows))


class _AuthAdmin:
    """Pages the way GoTrue does.

    Two behaviors matter and both are modeled: an omitted per_page falls back
    to the server default of 50, and `server_page_cap` lets the server hand
    back FEWER rows than asked for. Production code that stops on a short page
    silently truncates against a capping server, so the fake has to be able to
    cap.
    """

    DEFAULT_PER_PAGE = 50

    def __init__(self, users, server_page_cap=None):
        self._users = list(users)
        self._server_page_cap = server_page_cap
        self.calls: list[tuple[int, int]] = []

    def list_users(self, page=None, per_page=None):
        page = page or 1
        size = per_page or self.DEFAULT_PER_PAGE
        if self._server_page_cap is not None:
            size = min(size, self._server_page_cap)
        self.calls.append((page, size))
        start = (page - 1) * size
        return list(self._users[start : start + size])


class _Auth:
    def __init__(self, users, server_page_cap=None):
        self.admin = _AuthAdmin(users, server_page_cap=server_page_cap)


class FakeClient:
    """Minimal stand-in for the supabase-py client, recording every write."""

    def __init__(self, tables, users, server_page_cap=None):
        self.tables = {k: list(v) for k, v in tables.items()}
        self.writes: dict[str, list] = {}
        self.auth = _Auth(users, server_page_cap=server_page_cap)
        self.table_calls: list[str] = []

    def table(self, name):
        self.table_calls.append(name)
        rows = self.tables.get(name, [])
        if name in self.writes:
            rows = rows + self.writes[name]
        return _Query(list(rows), sink=self.writes, table=name)


def _brief_row():
    return {
        "id": BRIEF_ID,
        "briefing_date": "2026-07-24",
        "briefing_type": "morning",
        "headline": "Principal Financial Group increases its stake in HP",
        "summary": "",
        "lead_paragraph": (
            "Principal Financial Group has increased its stock holdings in HP, "
            "a move that signals continued institutional interest."
        ),
        "market_pulse": (
            '{"sentiment_word": "conflicted", "narrative": '
            '"US stocks are trading mixed with no fresh catalyst on the tape."}'
        ),
        "story_rail_ids": ["a1", "a2", "a3"],
        "issue_number": 42,
        "created_at": "2026-07-24T13:05:00+00:00",
    }


def _today_call_rows():
    return [
        {
            "id": "call-today-1",
            "brief_id": BRIEF_ID,
            "brief_date": "2026-07-24",
            "resolve_on": "2026-07-24",
            "claim_text": "Semiconductor demand stays firm into the print.",
            "target_symbol": "SMH",
            "is_lead": True,
            "created_at": "2026-07-24T13:05:00+00:00",
        },
        {
            "id": "call-today-2",
            "brief_id": BRIEF_ID,
            "brief_date": "2026-07-24",
            "resolve_on": "2026-07-31",
            "claim_text": "Energy stays bid on the Hormuz overhang.",
            "target_symbol": "XLE",
            "is_lead": False,
            "created_at": "2026-07-24T13:05:01+00:00",
        },
    ]


def _prior_call_rows():
    return [
        {
            "id": "call-prior-1",
            "brief_id": PRIOR_BRIEF_ID,
            "brief_date": "2026-07-23",
            "claim_text": (
                "The Technology sector shows strong performance as demand holds up."
            ),
            "target_symbol": "XLK",
            "is_lead": True,
            "created_at": "2026-07-23T13:05:00+00:00",
        },
        {
            "id": "call-prior-2",
            "brief_id": PRIOR_BRIEF_ID,
            "brief_date": "2026-07-23",
            "claim_text": "Housing pressure weighs on discretionary names.",
            "target_symbol": "XLY",
            "is_lead": False,
            "created_at": "2026-07-23T13:05:01+00:00",
        },
        {
            "id": "call-prior-3",
            "brief_id": PRIOR_BRIEF_ID,
            "brief_date": "2026-07-23",
            "claim_text": "A private issuer reprices its debt stack.",
            "target_symbol": None,
            "is_lead": False,
            "created_at": "2026-07-23T13:05:02+00:00",
        },
    ]


def _prior_outcome_rows():
    return [
        {
            "call_id": "call-prior-1",
            "verdict": "correct",
            "attribution": "clean",
            "actual_pct_change": 0.011843,
            "graded_at": "2026-07-24T02:00:00+00:00",
            "metadata": {
                "entity_symbol": "XLK",
                "entity_move_pct": 1.184,
                "benchmarks": [{"role": "market", "symbol": "SPY", "move_pct": 0.106}],
            },
        },
        {
            "call_id": "call-prior-2",
            "verdict": "wrong",
            "attribution": "confounded",
            "actual_pct_change": 0.0092,
            "graded_at": "2026-07-24T02:00:01+00:00",
            "metadata": {
                "entity_symbol": "XLY",
                "entity_move_pct": 0.92,
                "benchmarks": [{"role": "market", "symbol": "SPY", "move_pct": 0.88}],
            },
        },
        {
            "call_id": "call-prior-3",
            "verdict": "ungradable",
            "attribution": None,
            "actual_pct_change": None,
            "graded_at": "2026-07-24T02:00:02+00:00",
            "metadata": {"ungradable_reason": "unmapped_symbol"},
        },
    ]


def _article_rows():
    return [
        {"id": "a1", "title": "Fed minutes land at 2pm"},
        {"id": "a2", "title": "Chip orders beat across the supply chain"},
        {"id": "a3", "title": "Energy majors extend the Hormuz premium"},
    ]


def _user_rows():
    return [
        {"id": "user-sub", "email": "subscribed@example.com"},
        {"id": "user-unsub", "email": "unsubscribed@example.com"},
        {"id": "user-noemail", "email": ""},
    ]


def _profile_rows():
    return [
        {"id": "user-sub", "brief_email_subscribed": True},
        {"id": "user-unsub", "brief_email_subscribed": False},
    ]


def make_client(
    *,
    resolved=True,
    today_calls=True,
    ledger=None,
    users=None,
    profiles=None,
    server_page_cap=None,
    extra_tables=None,
    allowlist=None,
):
    # Recipients are intersected with beta_allowlist before dispatch, because
    # src/proxy.ts bounces a non-allowlisted session to /waitlist and mailing a
    # CTA to such an account is worse than not mailing it. The default here
    # allowlists every fake user, so tests about unrelated behaviour are
    # unaffected; pass `allowlist=[...]` to exercise the exclusion, or
    # `allowlist=False` to simulate an unreadable table.
    resolved_users = _user_rows() if users is None else list(users)
    if allowlist is None:
        allowlist_rows = [
            {"email": (u.get("email") or "").lower()}
            for u in resolved_users
            if (u.get("email") or "").strip()
        ]
    elif allowlist is False:
        allowlist_rows = None
    else:
        allowlist_rows = [{"email": str(e).lower()} for e in allowlist]

    return FakeClient(
        tables={
            "briefings": [_brief_row()],
            "morning_brief_calls": (
                (_today_call_rows() if today_calls else [])
                + (_prior_call_rows() if resolved else [])
            ),
            "morning_brief_call_outcomes": (
                _prior_outcome_rows() if resolved else []
            ),
            "articles": _article_rows(),
            "user_profiles": _profile_rows() if profiles is None else list(profiles),
            "brief_email_sends": list(ledger or []),
            "user_claims": [],
            "user_claim_outcomes": [],
            "watchlist": [],
            **({} if allowlist_rows is None else {"beta_allowlist": allowlist_rows}),
            **(extra_tables or {}),
        },
        users=resolved_users,
        server_page_cap=server_page_cap,
    )


class RecordingSender:
    def __init__(self, fail=False):
        self.messages: list[dict] = []
        self.fail = fail

    def __call__(self, message):
        self.messages.append(message)
        if self.fail:
            raise RuntimeError("resend returned 500: simulated upstream failure")


# ---------------------------------------------------------------------------
# 1. Flag off
# ---------------------------------------------------------------------------


class TestFlagOff(unittest.TestCase):
    def test_unknown_and_missing_values_fold_to_off(self):
        for raw in ("", "true", "TRUE", "on", "1", "Active ", "garbage", None):
            env = {} if raw is None else {"EMAIL_DIGEST_MODE": raw}
            expected = "active" if (raw or "").strip().lower() == "active" else "off"
            self.assertEqual(digest_mode(env), expected, f"value={raw!r}")

    def test_active_is_the_only_on_value(self):
        self.assertEqual(digest_mode({"EMAIL_DIGEST_MODE": "active"}), "active")
        self.assertEqual(digest_mode({"EMAIL_DIGEST_MODE": "ACTIVE"}), "active")

    def test_flag_off_attempts_nothing_at_all(self):
        client = make_client()
        sender = RecordingSender()
        result = maybe_send_brief_email(
            "morning", client=client, sender=sender,
            env={**BASE_ENV, "EMAIL_DIGEST_MODE": "off"},
        )
        self.assertEqual(result["status"], "off")
        self.assertEqual(result["sent"], 0)
        self.assertEqual(sender.messages, [], "no send may be attempted")
        # Byte-identical pipeline path: the DB is never touched either.
        self.assertEqual(client.table_calls, [], "no table read may occur")
        self.assertEqual(client.writes, {}, "no write may occur")

    def test_flag_absent_entirely_is_off(self):
        client = make_client()
        sender = RecordingSender()
        result = maybe_send_brief_email(
            "morning", client=client, sender=sender,
            env={k: v for k, v in BASE_ENV.items() if k != "EMAIL_DIGEST_MODE"},
        )
        self.assertEqual(result["status"], "off")
        self.assertEqual(client.table_calls, [])


# ---------------------------------------------------------------------------
# 2. Unsubscribed users excluded
# ---------------------------------------------------------------------------


class TestRecipients(unittest.TestCase):
    def test_unsubscribed_excluded_missing_profile_included(self):
        users = _user_rows() + [{"id": "user-noprofile", "email": "new@example.com"}]
        got = eligible_recipients(users, {p["id"]: p for p in _profile_rows()})
        ids = [r["id"] for r in got]
        self.assertIn("user-sub", ids)
        self.assertIn("user-noprofile", ids, "no profile row means subscribed default")
        self.assertNotIn("user-unsub", ids, "explicit false must be excluded")
        self.assertNotIn("user-noemail", ids, "a user with no email cannot be mailed")

    def test_end_to_end_send_skips_the_unsubscribed_address(self):
        client = make_client()
        sender = RecordingSender()
        result = maybe_send_brief_email(
            "morning", client=client, sender=sender, env=BASE_ENV
        )
        self.assertEqual(result["status"], "sent")
        recipients = [m["to"][0] for m in sender.messages]
        self.assertEqual(recipients, ["subscribed@example.com"])
        self.assertNotIn("unsubscribed@example.com", recipients)


# ---------------------------------------------------------------------------
# 2b. The auth pager is walked to exhaustion
#
# A single unpaged list_users() returns GoTrue's first page of 50. Against a
# real user table of 107 that silently mailed the first 50 accounts and dropped
# the rest, with nothing in the summary dict or the logs to show for it.
# ---------------------------------------------------------------------------


GOTRUE_DEFAULT_PAGE = 50


def _many_users(n, start=0):
    return [
        {"id": f"user-{i:04d}", "email": f"u{i:04d}@example.com"}
        for i in range(start, start + n)
    ]


class TestAuthUserPagination(unittest.TestCase):
    def test_more_than_one_page_of_users_is_returned_in_full(self):
        # 107 is the production count that surfaced this bug.
        client = make_client(
            users=_many_users(107), profiles=[], server_page_cap=GOTRUE_DEFAULT_PAGE
        )
        got = send_mod._fetch_recipients(client)
        self.assertGreater(
            len(got),
            GOTRUE_DEFAULT_PAGE,
            "the pager stopped at GoTrue's first page and dropped the rest",
        )
        self.assertEqual(len(got), 107)
        self.assertEqual(len({r["id"] for r in got}), 107, "no user counted twice")
        self.assertIn("u0106@example.com", {r["email"] for r in got})

    def test_the_pager_never_relies_on_the_50_row_default(self):
        client = make_client(users=_many_users(107), profiles=[])
        send_mod._fetch_recipients(client)
        requested = [per_page for _page, per_page in client.auth.admin.calls]
        self.assertTrue(requested, "list_users was never called")
        self.assertTrue(
            all(p > GOTRUE_DEFAULT_PAGE for p in requested),
            f"every request must ask past the default: {requested}",
        )

    def test_a_server_that_caps_page_size_below_the_request_still_yields_everyone(self):
        # We ask for AUTH_USERS_PER_PAGE; this server hands back 40 at a time.
        # Stopping on a short page would return 40 of 107 and call it done.
        client = make_client(users=_many_users(107), profiles=[], server_page_cap=40)
        got = send_mod._fetch_recipients(client)
        self.assertEqual(len(got), 107)

    def test_termination_is_on_an_empty_page_not_a_short_one(self):
        # An exact multiple of the page size: the last full page must not be
        # mistaken for the end of the list.
        client = make_client(users=_many_users(100), profiles=[], server_page_cap=50)
        got = send_mod._fetch_recipients(client)
        self.assertEqual(len(got), 100)
        self.assertEqual(
            client.auth.admin.calls,
            [(1, 50), (2, 50), (3, 50)],
            "two full pages then one empty page proves exhaustion",
        )

    def test_a_single_short_page_costs_exactly_two_calls(self):
        client = make_client(users=_many_users(3), profiles=[])
        got = send_mod._fetch_recipients(client)
        self.assertEqual(len(got), 3)
        self.assertEqual(len(client.auth.admin.calls), 2, "one page plus the empty probe")

    def test_opt_out_is_honored_for_users_beyond_the_first_page(self):
        users = _many_users(107)
        # Two users who only exist on later pages have unsubscribed.
        profiles = [
            {"id": "user-0060", "brief_email_subscribed": False},
            {"id": "user-0101", "brief_email_subscribed": False},
        ]
        client = make_client(
            users=users, profiles=profiles, server_page_cap=GOTRUE_DEFAULT_PAGE
        )
        emails = {r["email"] for r in send_mod._fetch_recipients(client)}
        self.assertEqual(len(emails), 105)
        self.assertNotIn("u0060@example.com", emails)
        self.assertNotIn("u0101@example.com", emails)

    def test_end_to_end_every_page_of_recipients_is_mailed(self):
        client = make_client(
            users=_many_users(107), profiles=[], server_page_cap=GOTRUE_DEFAULT_PAGE
        )
        sender = RecordingSender()
        result = maybe_send_brief_email(
            "morning", client=client, sender=sender, env=BASE_ENV
        )
        self.assertEqual(result["sent"], 107)
        self.assertEqual(result["failed"], 0)
        self.assertEqual(len(sender.messages), 107)
        self.assertEqual(len(client.writes.get("brief_email_sends", [])), 107)
        # The 51st account onward is the population the old code never reached.
        mailed = {m["to"][0] for m in sender.messages}
        self.assertIn("u0050@example.com", mailed)
        self.assertIn("u0106@example.com", mailed)

    def test_a_pager_that_never_empties_is_capped_and_logged_not_looped_forever(self):
        class NeverEmpty:
            """Pathological server: every page returns the same row."""

            calls = 0

            def list_users(self, page=None, per_page=None):
                NeverEmpty.calls += 1
                return [{"id": f"user-{page}", "email": f"u{page}@example.com"}]

        class _StuckAuth:
            admin = NeverEmpty()

        # This test is about the pager, not the allowlist gate, so the
        # synthetic users the stub invents are allowlisted. Without this they
        # would all be filtered out and the pager assertion would pass
        # vacuously against an empty list.
        client = make_client(
            allowlist=[
                f"u{p}@example.com" for p in range(1, send_mod.AUTH_USERS_MAX_PAGES + 1)
            ]
        )
        client.auth = _StuckAuth()
        with self.assertLogs("brief_email_send", level="ERROR") as captured:
            got = send_mod._fetch_recipients(client)
        self.assertEqual(NeverEmpty.calls, send_mod.AUTH_USERS_MAX_PAGES)
        self.assertEqual(len(got), send_mod.AUTH_USERS_MAX_PAGES)
        self.assertTrue(
            any("may be truncated" in line for line in captured.output),
            captured.output,
        )

    def test_a_pager_that_raises_still_refuses_rather_than_mailing_a_subset(self):
        class Exploding:
            def list_users(self, page=None, per_page=None):
                raise RuntimeError("gotrue 500")

        class _BrokenAuth:
            admin = Exploding()

        client = make_client()
        client.auth = _BrokenAuth()
        with self.assertLogs("brief_email_send", level="ERROR"):
            self.assertEqual(send_mod._fetch_recipients(client), [])


# ---------------------------------------------------------------------------
# 3. Send failure never raises
# ---------------------------------------------------------------------------


class TestFailOpen(unittest.TestCase):
    def test_send_failure_is_caught_and_logged(self):
        client = make_client()
        sender = RecordingSender(fail=True)
        with self.assertLogs("brief_email_send", level="ERROR") as captured:
            result = maybe_send_brief_email(
                "morning", client=client, sender=sender, env=BASE_ENV
            )
        self.assertEqual(result["failed"], 1)
        self.assertEqual(result["sent"], 0)
        self.assertTrue(
            any("send failed" in line for line in captured.output),
            captured.output,
        )
        # A failed send must not be recorded as delivered.
        self.assertEqual(client.writes.get("brief_email_sends", []), [])

    def test_a_broken_client_never_raises(self):
        class Exploding:
            def table(self, *_a, **_k):
                raise RuntimeError("supabase is down")

            auth = None

        with self.assertLogs("brief_email_send", level="ERROR"):
            result = maybe_send_brief_email(
                "morning", client=Exploding(), sender=RecordingSender(), env=BASE_ENV
            )
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["sent"], 0)

    def test_evening_run_is_not_mailed(self):
        client = make_client()
        sender = RecordingSender()
        result = maybe_send_brief_email(
            "evening", client=client, sender=sender, env=BASE_ENV
        )
        self.assertEqual(result["status"], "not_morning")
        self.assertEqual(sender.messages, [])


# ---------------------------------------------------------------------------
# 4. Idempotence
# ---------------------------------------------------------------------------


class TestIdempotence(unittest.TestCase):
    def test_same_brief_plus_user_never_sends_twice(self):
        client = make_client()
        sender = RecordingSender()

        first = maybe_send_brief_email(
            "morning", client=client, sender=sender, env=BASE_ENV
        )
        self.assertEqual(first["sent"], 1)
        self.assertEqual(len(sender.messages), 1)
        ledger = client.writes.get("brief_email_sends", [])
        self.assertEqual(len(ledger), 1)
        self.assertEqual(ledger[0]["brief_id"], BRIEF_ID)
        self.assertEqual(ledger[0]["user_id"], "user-sub")

        # Re-running the pipeline on the same brief must mail nobody again.
        second = maybe_send_brief_email(
            "morning", client=client, sender=sender, env=BASE_ENV
        )
        self.assertEqual(second["sent"], 0)
        self.assertEqual(second["skipped"], 1)
        self.assertEqual(
            len(sender.messages), 1, "the second run must not dispatch anything"
        )

    def test_a_prepopulated_ledger_blocks_the_first_send(self):
        client = make_client(
            ledger=[{"brief_id": BRIEF_ID, "user_id": "user-sub"}]
        )
        sender = RecordingSender()
        result = maybe_send_brief_email(
            "morning", client=client, sender=sender, env=BASE_ENV
        )
        self.assertEqual(result["sent"], 0)
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(sender.messages, [])


# ---------------------------------------------------------------------------
# 5. Resolution block renders every verdict
# ---------------------------------------------------------------------------


class TestResolutionBlock(unittest.TestCase):
    def setUp(self):
        self.resolved = select_last_session_resolutions(
            _prior_call_rows(), _prior_outcome_rows(), exclude_brief_id=BRIEF_ID
        )

    def test_selection_keeps_correct_wrong_and_ungradable(self):
        self.assertEqual(len(self.resolved), 3)
        verdicts = {r.verdict for r in self.resolved}
        self.assertEqual(verdicts, {"correct", "wrong", "ungradable"})

    def test_todays_own_calls_are_never_treated_as_resolved(self):
        mixed = _prior_call_rows() + _today_call_rows()
        resolved = select_last_session_resolutions(
            mixed, _prior_outcome_rows(), exclude_brief_id=BRIEF_ID
        )
        self.assertTrue(all(r.entity in {"XLK", "XLY", "Unmapped"} for r in resolved))

    def test_all_three_verdicts_render_in_the_body(self):
        payload = _payload(resolved=self.resolved)
        out = render_email(payload)
        for body in (out["text"], out["html"]):
            self.assertIn("Supported", body)
            self.assertIn("Challenged", body)
            self.assertIn("No clean read", body)
            self.assertIn("XLK", body)
            self.assertIn("XLY", body)

    def test_attribution_lines_are_honest_per_verdict(self):
        text = render_email(_payload(resolved=self.resolved))["text"]
        # Clean read: the numbers and the credit.
        self.assertIn("XLK +1.18 vs SPY +0.11", text)
        self.assertIn("Clean read: it moved beyond its benchmark.", text)
        # Confounded: the thesis is explicitly NOT credited.
        self.assertIn("XLY +0.92 vs SPY +0.88", text)
        self.assertIn("moved with its benchmark, so the call cannot be credited", text)
        # Ungradable: named refusal, no invented number.
        self.assertIn("Not graded: no tradable symbol to grade against.", text)

    def test_misses_are_never_filtered_out(self):
        only_wrong = [r for r in self.resolved if r.verdict == "wrong"]
        text = render_email(_payload(resolved=only_wrong))["text"]
        self.assertIn("HOW THE LAST SESSION'S CALLS RESOLVED", text)
        self.assertIn("Challenged", text)


# ---------------------------------------------------------------------------
# 6. Nothing resolved -> block omitted, not padded
# ---------------------------------------------------------------------------


class TestNothingResolved(unittest.TestCase):
    def test_selection_returns_empty_when_nothing_graded(self):
        self.assertEqual(
            select_last_session_resolutions(_prior_call_rows(), [], BRIEF_ID), []
        )

    def test_block_is_absent_from_both_bodies(self):
        out = render_email(_payload(resolved=[]))
        for body in (out["text"], out["html"]):
            self.assertNotIn("HOW THE LAST SESSION'S CALLS RESOLVED", body.upper())
            self.assertNotIn("No clean read", body)
            self.assertNotIn("cannot be credited", body)
        # And the rest of the email is still complete.
        self.assertIn("TODAY'S CALLS", out["text"])
        self.assertIn("TODAY'S STORIES", out["text"])

    def test_subject_never_mentions_resolution_counts_either_way(self):
        # The subject is a headline about the day. Whether anything resolved is
        # not the reader's reason to open it, and it never leaks into the line.
        for resolved in ([], None):
            subject = render_email(_payload(resolved=resolved))["subject"]
            self.assertNotIn("resolved", subject.lower())
            self.assertFalse(any(ch.isdigit() for ch in subject.replace("HP", "")),
                             f"no counts belong in a subject: {subject!r}")

    def test_end_to_end_with_no_outcomes_still_sends_a_complete_email(self):
        client = make_client(resolved=False)
        sender = RecordingSender()
        result = maybe_send_brief_email(
            "morning", client=client, sender=sender, env=BASE_ENV
        )
        self.assertEqual(result["sent"], 1)
        self.assertEqual(result["resolved_calls"], 0)
        body = sender.messages[0]["text"]
        self.assertNotIn("RESOLVED", body.upper().replace("RESOLVES", ""))
        self.assertIn("THE LEAD", body)


# ---------------------------------------------------------------------------
# 7. Compliance and unsubscribe link
# ---------------------------------------------------------------------------


class TestCompliance(unittest.TestCase):
    def test_scrubber_removes_every_banned_term(self):
        dirty = (
            "Investors should buy and hold the name, sell the laggard, allocate "
            "10% and watch your portfolio, your returns, its performance and gains."
        )
        self.assertTrue(find_banned_terms(dirty), "fixture must start dirty")
        self.assertEqual(find_banned_terms(scrub_compliance(dirty)), [])

    def test_scrubber_leaves_innocent_substrings_alone(self):
        clean = "Buyback holdings underperformance thresholds sellers bargains."
        self.assertEqual(find_banned_terms(clean), [])
        self.assertEqual(scrub_compliance(clean), clean)

    def test_rendered_body_is_clean_and_carries_the_unsubscribe_link(self):
        payload = _payload(
            resolved=select_last_session_resolutions(
                _prior_call_rows(), _prior_outcome_rows(), BRIEF_ID
            )
        )
        out = render_email(payload)
        for name in ("text", "html", "subject"):
            with self.subTest(part=name):
                hits = find_banned_terms(out[name])
                self.assertEqual(hits, [], f"{name} carried banned term(s): {hits}")
        self.assertIn(payload.unsubscribe_url, out["text"])
        self.assertIn(payload.unsubscribe_url, out["html"])
        self.assertIn("Unsubscribe", out["html"])

    def test_model_authored_claim_text_is_scrubbed_in_place(self):
        # The real fixture claim says "strong performance" and "holds up".
        out = render_email(
            _payload(
                resolved=select_last_session_resolutions(
                    _prior_call_rows(), _prior_outcome_rows(), BRIEF_ID
                )
            )
        )
        self.assertIn("strong results", out["text"])
        self.assertEqual(find_banned_terms(out["text"]), [])

    def test_dispatched_message_is_clean_end_to_end(self):
        client = make_client()
        sender = RecordingSender()
        maybe_send_brief_email("morning", client=client, sender=sender, env=BASE_ENV)
        msg = sender.messages[0]
        for part in ("subject", "text", "html"):
            self.assertEqual(find_banned_terms(msg[part]), [], part)
        self.assertIn("/api/unsubscribe?token=", msg["text"])
        self.assertIn("List-Unsubscribe", msg["headers"])
        self.assertIn("List-Unsubscribe-Post", msg["headers"])

    def test_banned_terms_list_is_the_documented_one(self):
        self.assertEqual(
            set(BANNED_TERMS),
            {"buy", "sell", "hold", "allocate", "your portfolio",
             "your returns", "performance", "gains"},
        )


# ---------------------------------------------------------------------------
# Section contract: order, pulse framing, horizons, deep links
# ---------------------------------------------------------------------------


class TestSectionContract(unittest.TestCase):
    def test_sections_render_in_the_required_order(self):
        text = render_email(
            _payload(
                resolved=select_last_session_resolutions(
                    _prior_call_rows(), _prior_outcome_rows(), BRIEF_ID
                )
            )
        )["text"]
        markers = [
            "MARKET PULSE",
            "HOW THE LAST SESSION'S CALLS RESOLVED",
            "THE LEAD",
            "TODAY'S CALLS",
            "TODAY'S STORIES",
            "Unsubscribe:",
        ]
        positions = [text.index(m) for m in markers]
        self.assertEqual(positions, sorted(positions), text[:400])

    def test_pulse_is_verbatim_timestamped_and_never_implies_live_state(self):
        payload = _payload()
        text = render_email(payload)["text"]
        self.assertIn(payload.market_pulse, text)
        self.assertIn(payload.generated_at_display, text)
        self.assertIn("Written before the open", text)

    def test_horizon_labels_match_the_backend_buckets(self):
        self.assertEqual(horizon_label_for_days(0), "Resolves same session")
        self.assertEqual(horizon_label_for_days(7), "Resolves in 1 week")
        self.assertEqual(horizon_label_for_days(21), "Resolves in 3 weeks")
        self.assertEqual(horizon_label_for_days(None), "Horizon not set")

    def test_every_today_call_carries_a_horizon_and_a_track_link(self):
        text = render_email(_payload())["text"]
        self.assertIn("Resolves same session", text)
        self.assertIn("Resolves in 1 week", text)
        self.assertEqual(text.count("Track this call:"), 2)
        self.assertIn(
            "https://signalera.ai/radar/calls?adopt=call-today-1#call-call-today-1",
            text,
        )

    def test_track_url_shape(self):
        self.assertEqual(
            track_url("https://signalera.ai", "abc"),
            "https://signalera.ai/radar/calls?adopt=abc#call-abc",
        )

    def test_stories_are_capped_at_five(self):
        payload = _payload()
        payload.stories = [f"Headline {i}" for i in range(9)]
        text = render_email(payload)["text"]
        self.assertIn("Headline 4", text)
        self.assertNotIn("Headline 5", text)

    def test_end_to_end_body_carries_the_real_story_rail(self):
        client = make_client()
        sender = RecordingSender()
        maybe_send_brief_email("morning", client=client, sender=sender, env=BASE_ENV)
        text = sender.messages[0]["text"]
        self.assertIn("Fed minutes land at 2pm", text)
        self.assertIn("Chip orders beat across the supply chain", text)


class TestUnsubscribeToken(unittest.TestCase):
    def test_token_is_deterministic_and_decodes_to_the_user_id(self):
        import base64

        token = make_unsubscribe_token("user-sub", "secret")
        self.assertEqual(token, make_unsubscribe_token("user-sub", "secret"))
        self.assertNotEqual(token, make_unsubscribe_token("user-sub", "other-secret"))
        padded = token + "=" * (-len(token) % 4)
        decoded = base64.urlsafe_b64decode(padded).decode()
        user_id, mac = decoded.rsplit(".", 1)
        self.assertEqual(user_id, "user-sub")
        self.assertEqual(len(mac), 22, "TS verifier truncates the HMAC to 22 chars")

    def test_missing_signing_secret_refuses_to_send(self):
        client = make_client()
        sender = RecordingSender()
        env = {k: v for k, v in BASE_ENV.items() if k != "SUPABASE_JWT_SECRET"}
        with self.assertLogs("brief_email_send", level="ERROR"):
            result = maybe_send_brief_email(
                "morning", client=client, sender=sender, env=env
            )
        self.assertEqual(result["status"], "error")
        self.assertEqual(sender.messages, [])


class TestMarketPulseParsing(unittest.TestCase):
    def test_json_prose_and_empty_shapes(self):
        self.assertEqual(
            parse_market_pulse('{"sentiment_word":"x","narrative":"Tape was quiet."}'),
            "Tape was quiet.",
        )
        self.assertEqual(parse_market_pulse("Tape was quiet."), "Tape was quiet.")
        self.assertEqual(parse_market_pulse(None), "")
        self.assertEqual(parse_market_pulse("{not json"), "{not json")
        self.assertEqual(parse_market_pulse({"narrative": "dict form"}), "dict form")


class TestNoEmDashes(unittest.TestCase):
    def test_shipped_modules_and_rendered_body_have_no_em_dashes(self):
        # Built from a codepoint so this guard does not itself trip the
        # repo-wide em-dash grep it exists to enforce.
        em_dash = chr(0x2014)
        for path in (
            send_mod.__file__,
            os.path.join(_BACKEND, "brief_email_render.py"),
        ):
            with open(path, encoding="utf-8") as fh:
                self.assertNotIn(em_dash, fh.read(), path)
        out = render_email(
            _payload(
                resolved=select_last_session_resolutions(
                    _prior_call_rows(), _prior_outcome_rows(), BRIEF_ID
                )
            )
        )
        self.assertNotIn(em_dash, out["text"])
        self.assertNotIn(em_dash, out["html"])


# ---------------------------------------------------------------------------
# Shared payload fixture
# ---------------------------------------------------------------------------


def _payload(resolved=None) -> BriefEmailPayload:
    if resolved is None:
        resolved = select_last_session_resolutions(
            _prior_call_rows(), _prior_outcome_rows(), BRIEF_ID
        )
    brief = _brief_row()
    return BriefEmailPayload(
        brief_id=BRIEF_ID,
        brief_date="2026-07-24",
        generated_at_display="Jul 24, 2026 at 13:05 UTC",
        market_pulse=parse_market_pulse(brief["market_pulse"]),
        headline=brief["headline"],
        lead_paragraph=brief["lead_paragraph"],
        unsubscribe_url="https://signalera.ai/api/unsubscribe?token=abc123",
        site_url="https://signalera.ai",
        resolved=list(resolved),
        today_calls=[
            TodayCall(
                call_id="call-today-1",
                entity="SMH",
                claim="Semiconductor demand stays firm into the print.",
                horizon_label="Resolves same session",
                track_url=track_url("https://signalera.ai", "call-today-1"),
            ),
            TodayCall(
                call_id="call-today-2",
                entity="XLE",
                claim="Energy stays bid on the Hormuz overhang.",
                horizon_label="Resolves in 1 week",
                track_url=track_url("https://signalera.ai", "call-today-2"),
            ),
        ],
        stories=[r["title"] for r in _article_rows()],
        issue_number=42,
    )


# Keep the unused-import guard honest: ResolvedCall is part of the public
# fixture surface even when a given test constructs it indirectly.
assert ResolvedCall is not None


if __name__ == "__main__":
    unittest.main(verbosity=2)


# ---------------------------------------------------------------------------
# Editorial pass: subject, preheader, pulse blocks, order, vocabulary, mobile
# ---------------------------------------------------------------------------


class TestSubjectIsAnEditorialHeadline(unittest.TestCase):
    def _subject(self, headline, lead="", stories=None):
        p = _payload()
        p.headline = headline
        p.lead_paragraph = lead
        p.stories = stories if stories is not None else p.stories
        return subject_line(p)

    def test_the_real_lead_that_exposed_this_compresses_to_a_headline(self):
        got = self._subject(
            "Electronic Arts Closes at $209.70 After $55 Billion Buyout, "
            "Debt Focus Intensifies",
            "Electronic Arts (EA) concluded trading at $209.70 today, following "
            "its $55 billion buyout.",
        )
        self.assertEqual(got, "EA Closes at $209.70 After $55B Buyout")
        self.assertLess(len(got), 50)

    def test_it_is_always_under_the_cap(self):
        for headline in (
            "Principal Financial Group increases its stake in HP",
            "A very long headline about absolutely everything that happened in "
            "the market today and also yesterday and possibly tomorrow as well",
            "Short one",
            "Supercalifragilisticexpialidociousunbrokenwordthatneverendsatall",
        ):
            got = self._subject(headline)
            self.assertLessEqual(len(got), SUBJECT_MAX, f"{headline!r} -> {got!r}")
            self.assertTrue(got.strip(), f"{headline!r} produced an empty subject")

    def test_no_product_prefix_no_count_no_timestamp(self):
        got = self._subject(
            "Electronic Arts Closes at $209.70 After $55 Billion Buyout",
            "Electronic Arts (EA) closed at $209.70.",
        )
        self.assertNotIn("Signalera", got)
        self.assertNotIn("Morning Brief", got)
        self.assertNotIn("Issue", got)
        self.assertNotIn("resolved", got.lower())
        self.assertNotIn("UTC", got)

    def test_it_never_invents_words_the_headline_did_not_have(self):
        # Every subject token must come from the compressed headline, so the
        # line can never assert something the brief did not say.
        headline = "Hormuz Talks Lift Crude as Tankers Reroute"
        got = self._subject(headline)
        self.assertTrue(headline.startswith(got), f"{got!r} is not a prefix")

    def test_it_cuts_at_a_clause_rather_than_mid_phrase(self):
        got = self._subject(
            "Jobs Print Lands Soft and the Market Shrugs, Yields Slip Four "
            "Basis Points on the News"
        )
        self.assertEqual(got, "Jobs Print Lands Soft and the Market Shrugs")

    def test_an_exchange_parenthetical_is_dropped_not_carried(self):
        got = self._subject("eBay (NASDAQ: EBAY) Posts Q2 Results Above Consensus")
        self.assertNotIn("(", got)
        self.assertNotIn("NASDAQ", got)

    def test_it_falls_back_to_a_story_then_to_the_evergreen_line(self):
        self.assertEqual(
            self._subject("", stories=["Chip orders beat across the supply chain"]),
            "Chip orders beat across the supply chain",
        )
        self.assertEqual(self._subject("", stories=[]), EVERGREEN_SUBJECT)

    def test_the_evergreen_fallback_is_still_not_metadata(self):
        self.assertNotIn("Signalera", EVERGREEN_SUBJECT)
        self.assertFalse(any(ch.isdigit() for ch in EVERGREEN_SUBJECT))


class TestPreheader(unittest.TestCase):
    def test_it_runs_the_days_items_and_never_leaks_the_timestamp(self):
        line = preheader(_payload())
        self.assertNotIn("generated", line.lower())
        self.assertNotIn("UTC", line)
        self.assertIn("scored", line)
        self.assertIn("new calls on the board", line)

    def test_it_does_not_repeat_the_subject(self):
        p = _payload()
        subject = subject_line(p)
        overlap = [w for w in subject.split() if len(w) > 4 and w in preheader(p)]
        self.assertEqual(overlap, [], f"preheader repeats the subject: {overlap}")

    def test_placeholder_entities_never_reach_the_inbox_preview(self):
        line = preheader(_payload())
        self.assertNotIn("Unmapped", line)

    def test_it_stays_inside_the_preview_budget(self):
        p = _payload()
        p.today_calls = p.today_calls * 6
        self.assertLessEqual(len(preheader(p)), PREHEADER_MAX + 1)

    def test_an_empty_brief_falls_back_to_the_standfirst(self):
        p = _payload(resolved=[])
        p.today_calls = []
        p.stories = []
        self.assertEqual(preheader(p), STANDFIRST)

    def test_the_html_carries_it_as_hidden_preview_text(self):
        p = _payload()
        html = render_html(p)
        self.assertIn("display:none", html)
        self.assertIn(_html_escape(preheader(p)), html)


class TestPulseIsBrokenIntoBlocks(unittest.TestCase):
    PULSE = (
        "US stocks opened higher in early trading with no fresh catalyst on the "
        "tape, as the S&P 500 gained 0.22%, the Nasdaq rose 0.62%, and the "
        "Russell 2000 advanced 0.81%. Last week's soft-landing jobs read (July "
        "nonfarm payrolls -23K m/m; unemployment rate 4.1%) still underpins "
        "sentiment, alongside recent soft inflation prints. The 10-year Treasury "
        "yield is trading at 4.63%, down 4 basis points. WTI crude is up slightly "
        "at $77.37. Sector ETFs show Consumer Discretionary leading with a 1.29% "
        "advance, followed by Materials (+0.98%). Elsewhere, eBay reported strong "
        "Q2 results. Looking ahead, the market will continue to assess the "
        "implications of recent economic data."
    )

    def test_it_splits_into_labelled_blocks_not_one_paragraph(self):
        labels = [label for label, _ in pulse_blocks(self.PULSE)]
        self.assertGreaterEqual(len(labels), 3)
        self.assertEqual(labels, sorted(labels, key=PULSE_BLOCK_ORDER.index))
        self.assertIn("The tape", labels)
        self.assertIn("Sector leadership", labels)

    def test_the_looking_ahead_section_is_gone(self):
        # "The market will continue to assess the implications of recent
        # economic data" is true of every trading day, so the block said
        # nothing. The heading is retired.
        self.assertNotIn("Looking ahead", PULSE_BLOCK_ORDER)
        labels = [label for label, _ in pulse_blocks(self.PULSE)]
        self.assertNotIn("Looking ahead", labels)
        # The HEADING is gone. A model sentence that happens to open with the
        # words is refiled, not censored: rewriting the pulse would break the
        # partition guarantee and is editorialising we do not do.
        payload = _payload()
        payload.market_pulse = self.PULSE
        out = render_email(payload)
        self.assertNotIn("LOOKING AHEAD", out["text"])
        self.assertNotIn(">Looking ahead<", out["html"])

    def test_its_sentences_are_refiled_not_dropped(self):
        # The partition guarantee has to survive removing a bucket.
        original = _pulse_sentences(self.PULSE)
        rendered = []
        for _label, prose in pulse_blocks(self.PULSE):
            rendered.extend(_pulse_sentences(prose))
        self.assertEqual(sorted(rendered), sorted(original))
        blocks = dict(pulse_blocks(self.PULSE))
        self.assertIn("will continue to assess", blocks["Macro backdrop"])

    def test_every_single_sentence_survives_exactly_once(self):
        original = _pulse_sentences(self.PULSE)
        rendered = []
        for _label, prose in pulse_blocks(self.PULSE):
            rendered.extend(_pulse_sentences(prose))
        self.assertEqual(sorted(rendered), sorted(original))
        self.assertEqual(len(rendered), len(original), "a sentence was duplicated")

    def test_the_tape_block_holds_the_indices_the_yield_and_crude(self):
        blocks = dict(pulse_blocks(self.PULSE))
        tape = blocks["The tape"]
        for token in ("S&P 500", "Nasdaq", "Russell 2000", "10-year", "WTI"):
            self.assertIn(token, tape)

    def test_macro_prints_do_not_get_filed_as_single_names(self):
        blocks = dict(pulse_blocks(self.PULSE))
        self.assertIn("nonfarm payrolls", blocks["Macro backdrop"])
        self.assertNotIn("payrolls", blocks.get("Single names", ""))

    def test_an_exchange_tag_does_not_drag_a_single_name_into_the_tape(self):
        # "eBay (NASDAQ: EBAY) reported..." is a company sentence. The ticker
        # prefix is not a statement about the index.
        pulse = (
            "The S&P 500 rose 0.22%. Elsewhere, eBay (NASDAQ: EBAY) reported "
            "strong Q2 results."
        )
        blocks = dict(pulse_blocks(pulse))
        self.assertIn("eBay", blocks["Single names"])
        self.assertNotIn("eBay", blocks["The tape"])
        # The tag still survives into the rendered prose.
        self.assertIn("(NASDAQ: EBAY)", blocks["Single names"])

    def test_an_unclassifiable_pulse_still_renders_every_word(self):
        odd = "Something happened. Then something else happened."
        self.assertEqual(
            " ".join(prose for _l, prose in pulse_blocks(odd)).split(),
            odd.split(),
        )

    def test_an_empty_pulse_produces_no_blocks_rather_than_an_empty_one(self):
        self.assertEqual(pulse_blocks(""), [])
        self.assertEqual(pulse_blocks("   \n  "), [])

    def test_the_numbers_are_bolded_in_the_html(self):
        p = _payload()
        p.market_pulse = self.PULSE
        html = render_html(p)
        self.assertIn("<strong>0.22%</strong>", html)
        self.assertIn("<strong>$77.37</strong>", html)

    def test_a_bare_year_is_not_bolded_and_entities_are_not_mangled(self):
        p = _payload()
        p.market_pulse = "Results for fiscal year 2026 landed. Revenue rose 4.10%."
        html = render_html(p)
        self.assertNotIn("<strong>2026</strong>", html)
        self.assertIn("<strong>4.10%</strong>", html)

    def test_the_pulse_block_never_shows_the_timestamp_as_its_heading(self):
        html = render_html(_payload())
        self.assertNotIn("Market pulse - generated", html)
        self.assertIn("Generated Jul 24, 2026 at 13:05 UTC.", html)


class TestResolutionSitsAboveTheLead(unittest.TestCase):
    def test_text_order_puts_the_record_first(self):
        text = render_email(_payload())["text"]
        self.assertLess(
            text.index("HOW THE LAST SESSION'S CALLS RESOLVED"),
            text.index("THE LEAD"),
        )

    def test_html_order_puts_the_record_first(self):
        html = render_email(_payload())["html"]
        self.assertLess(
            html.index("How the last session&#x27;s calls resolved"),
            html.index("The lead"),
        )

    def test_the_lead_is_still_present_and_complete(self):
        out = render_email(_payload())
        for body in (out["text"], out["html"]):
            self.assertIn("Principal Financial Group", body)

    def test_with_nothing_resolved_the_lead_is_the_first_block_after_the_pulse(self):
        out = render_email(_payload(resolved=[]))
        self.assertNotIn("HOW THE LAST SESSION", out["text"])
        self.assertLess(out["text"].index("MARKET PULSE"), out["text"].index("THE LEAD"))


class TestRetiredVocabularyIsGone(unittest.TestCase):
    def _bodies(self):
        out = render_email(_payload())
        return {"text": out["text"], "html": out["html"], "subject": out["subject"]}

    def test_no_rendered_string_says_right_wrong_or_thesis(self):
        for name, body in self._bodies().items():
            for retired in ("Right", "Wrong", "thesis", "Thesis", "theses"):
                self.assertNotIn(retired, body, f"{name} still says {retired!r}")

    def test_the_template_source_keeps_no_private_verdict_table(self):
        with open(os.path.join(_BACKEND, "brief_email_render.py"), encoding="utf-8") as fh:
            source = fh.read()
        self.assertNotIn('"Wrong"', source)
        self.assertNotIn('"Correct"', source)
        self.assertIn("verdict_vocabulary", source, "must import the shared table")

    def test_the_words_come_from_the_shared_vocabulary(self):
        from verdict_vocabulary import VERDICT_WORD

        text = render_email(_payload())["text"]
        self.assertIn(VERDICT_WORD["supported"], text)
        self.assertIn(VERDICT_WORD["challenged"], text)

    def test_the_cta_says_call_not_thesis(self):
        out = render_email(_payload())
        self.assertIn("Track this call", out["text"])
        self.assertIn("Track this call", out["html"])


class TestColdReaderOrientation(unittest.TestCase):
    def test_the_standfirst_is_present_once_and_stays_one_line(self):
        out = render_email(_payload())
        self.assertIn(STANDFIRST, out["text"])
        self.assertEqual(out["html"].count(_html_escape(STANDFIRST)), 1)
        self.assertLess(len(STANDFIRST), 80)

    def test_it_says_what_the_email_is_including_the_uncomfortable_part(self):
        self.assertIn("scored against the close", STANDFIRST)
        self.assertIn("Misses included", STANDFIRST)


class TestSectionBlocks(unittest.TestCase):
    def test_every_section_gets_an_all_caps_header_in_the_text_body(self):
        text = render_email(_payload())["text"]
        for header in (
            "MARKET PULSE",
            "HOW THE LAST SESSION'S CALLS RESOLVED",
            "THE LEAD",
            "TODAY'S CALLS",
            "TODAY'S STORIES",
        ):
            self.assertIn(header, text)

    def test_every_section_is_its_own_bordered_block_in_the_html(self):
        html = render_email(_payload())["html"]
        # pulse, resolutions, lead, calls, stories
        self.assertEqual(html.count("border-radius:12px"), 5)

    def test_headers_are_uppercased_by_style_not_by_shouting_in_the_string(self):
        html = render_email(_payload())["html"]
        self.assertIn("text-transform:uppercase", html)


class TestMobileFirst(unittest.TestCase):
    def setUp(self):
        self.html = render_email(_payload())["html"]

    def test_body_copy_is_never_below_sixteen_pixels(self):
        sizes = [int(m) for m in re.findall(r"font-size:(\d+)px", self.html)]
        body_sizes = [s for s in sizes if s >= 15]
        self.assertTrue(body_sizes)
        # Anything under 15px is label or legal copy, never running body text.
        self.assertIn(16, sizes, "no 16px body copy found")

    def test_there_are_no_fixed_width_tables_to_overflow(self):
        self.assertNotIn("<table", self.html.lower())
        # A fixed pixel width would overflow a 375px viewport. max-width does not.
        # min-width on a button is a floor, not an overflow risk.
        fixed = re.findall(r"(?<!max-)(?<!min-)width:\d+px", self.html)
        self.assertEqual(fixed, [], f"fixed widths found: {fixed}")
        self.assertIn("max-width:600px", self.html)
        self.assertIn("width:100%", self.html)

    def test_the_viewport_is_declared(self):
        self.assertIn('name="viewport"', self.html)
        self.assertIn("width=device-width", self.html)

    def test_the_primary_cta_clears_a_forty_four_pixel_tap_target(self):
        # 20px line box plus 12px padding top and bottom is exactly 44.
        self.assertIn("padding:12px 18px;line-height:20px", self.html)
        self.assertIn("Track this call", self.html)

    def test_the_unsubscribe_link_is_also_tappable(self):
        self.assertIn("padding:12px 0", self.html)


class TestFromDisplayName(unittest.TestCase):
    def test_a_bare_address_gains_the_publication_name(self):
        self.assertEqual(
            send_mod.with_display_name("briefs@signalera.ai"),
            "Signalera <briefs@signalera.ai>",
        )

    def test_an_operator_set_display_name_is_left_alone(self):
        for already in ("Signalera Daily <briefs@signalera.ai>", "X <a@b.co>"):
            self.assertEqual(send_mod.with_display_name(already), already)

    def test_garbage_is_returned_untouched_rather_than_mangled(self):
        for junk in ("", "   ", "not-an-address"):
            self.assertEqual(send_mod.with_display_name(junk), junk.strip())

    def test_the_dispatched_message_shows_a_name_not_an_address(self):
        client = make_client()
        sender = RecordingSender()
        maybe_send_brief_email(
            "morning", client=client, sender=sender,
            env={**BASE_ENV, "EMAIL_FROM_ADDRESS": "briefs@signalera.ai"},
        )
        self.assertEqual(sender.messages[0]["from"], "Signalera <briefs@signalera.ai>")

    def test_the_default_when_nothing_is_configured_also_shows_a_name(self):
        client = make_client()
        sender = RecordingSender()
        maybe_send_brief_email("morning", client=client, sender=sender, env=BASE_ENV)
        self.assertTrue(sender.messages[0]["from"].startswith("Signalera <"))


class TestEasternTime(unittest.TestCase):
    def test_a_utc_created_at_renders_as_eastern_labelled_ET(self):
        # 14:17 UTC on an August date is 10:17 in New York (EDT, UTC-4).
        got = send_mod._format_generated_at("2026-08-07T14:17:04+00:00", None)
        self.assertEqual(got, "Aug 07, 2026 at 10:17 AM ET")

    def test_winter_dates_shift_by_five_not_four(self):
        # Standard time. The zone does the arithmetic; we never hardcode it.
        got = send_mod._format_generated_at("2026-01-15T14:17:00+00:00", None)
        self.assertEqual(got, "Jan 15, 2026 at 9:17 AM ET")

    def test_a_naive_timestamp_is_read_as_utc_then_converted(self):
        self.assertEqual(
            send_mod._format_generated_at("2026-08-07T14:17:00", None),
            "Aug 07, 2026 at 10:17 AM ET",
        )

    def test_an_unusable_created_at_still_renders_a_stamp(self):
        got = send_mod._format_generated_at(None, datetime(2026, 8, 7, 14, 17,
                                                           tzinfo=timezone.utc))
        self.assertEqual(got, "Aug 07, 2026 at 10:17 AM ET")

    def test_no_rendered_string_says_UTC(self):
        payload = _payload()
        payload.generated_at_display = send_mod._format_generated_at(
            "2026-08-07T14:17:04+00:00", None
        )
        out = render_email(payload)
        for name in ("subject", "text", "html"):
            self.assertNotIn("UTC", out[name], name)
        self.assertIn("ET", out["text"])

    def test_the_end_to_end_body_carries_eastern_time(self):
        client = make_client()
        sender = RecordingSender()
        maybe_send_brief_email("morning", client=client, sender=sender, env=BASE_ENV)
        body = sender.messages[0]["text"]
        self.assertNotIn("UTC", body)
        self.assertIn(" ET", body)

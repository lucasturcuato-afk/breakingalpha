"""
brief_email_send.py - dispatch the daily Morning Brief email.

Called from run.py AFTER the brief and its calls have persisted. This module
owns everything that touches the outside world: reading the brief, resolving
recipients, enforcing idempotence, and handing bytes to Resend. All rendering
lives in brief_email_render.py and stays pure.

FIVE INVARIANTS, in priority order:

1. FAIL-OPEN. maybe_send_brief_email() catches every exception, logs it loudly,
   and returns a summary dict. It NEVER raises into the pipeline and never
   marks a run degraded. The brief generating correctly is the product; the
   email is a delivery channel on top of it.

2. FLAG-GATED. EMAIL_DIGEST_MODE must be exactly "active" to send. Anything
   else, including unset, garbage, and "true", resolves to "off". When off we
   return before touching the network, the DB, or the renderer, so the pipeline
   path is byte-identical to the pre-change behavior.

3. IDEMPOTENT. Every successful send writes (brief_id, user_id) to
   brief_email_sends, which carries a UNIQUE constraint on that pair. A re-run
   of the same brief reads the ledger first and skips anyone already sent to,
   so a manual workflow_dispatch after a cron run cannot double-send.

4. OPT-OUT HONORED. Recipients are auth users with a non-empty email whose
   user_profiles.brief_email_subscribed is not false. A missing profile row
   defaults to subscribed, matching the column default. The unsubscribe link in
   the footer flips that same column through the existing
   /api/unsubscribe endpoint, so the loop is closed.

5. COMPLIANT. The rendered body passes find_banned_terms() before dispatch. A
   body that somehow carries a banned term is dropped with a loud log rather
   than sent.

No model calls. No em-dashes.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Any, Callable, Iterable

try:  # pragma: no cover - import shim, mirrors backend/synthesize.py
    from brief_email_render import (
        BriefEmailPayload,
        ResolvedCall,
        TodayCall,
        find_banned_terms,
        horizon_label_for_days,
        render_email,
    )
except ImportError:  # pragma: no cover
    from backend.brief_email_render import (
        BriefEmailPayload,
        ResolvedCall,
        TodayCall,
        find_banned_terms,
        horizon_label_for_days,
        render_email,
    )

try:  # pragma: no cover - import shim
    from brief_email_personal import PersonalContext, bucket_by, personal_block
except ImportError:  # pragma: no cover
    from backend.brief_email_personal import (
        PersonalContext,
        bucket_by,
        personal_block,
    )

logger = logging.getLogger(__name__)

RESEND_ENDPOINT = "https://api.resend.com/emails"

#: Matches NAMESPACE in src/lib/email/unsubscribe-token.ts. Changing one without
#: the other silently invalidates every unsubscribe link we have ever sent.
UNSUBSCRIBE_NAMESPACE = "signalera:unsubscribe:v1"

#: Matches HARDCODED_FALLBACK in src/lib/email/site-url.ts.
SITE_URL_FALLBACK = "https://signalera.ai"

#: The frontend refuses to render this headline; it means synthesize produced a
#: stub. We refuse to mail it for the same reason.
STUB_HEADLINE = "Market Intelligence Unavailable"

SEND_LEDGER_TABLE = "brief_email_sends"

#: The market's own clock. Every timestamp the email renders is converted here
#: and labelled ET, because email cannot detect a recipient timezone.
EASTERN = ZoneInfo("America/New_York")

#: Page size requested from the auth admin pager. GoTrue defaults to 50 per
#: page, and a single unpaged list_users() call therefore capped the recipient
#: set at the first 50 accounts no matter how many existed.
AUTH_USERS_PER_PAGE = 200

#: Runaway guard for the pager loop. At 200 per page this covers 100k users.
#: Hitting it is logged as an error rather than silently truncating.
AUTH_USERS_MAX_PAGES = 500


# ---------------------------------------------------------------------------
# Flag
# ---------------------------------------------------------------------------


def digest_mode(env: dict[str, str] | None = None) -> str:
    """Resolve EMAIL_DIGEST_MODE to exactly "off" or "active".

    Unknown values fold to "off". This is deliberate: an operator typo must
    never be the reason mail goes out to real inboxes.
    """
    source = os.environ if env is None else env
    raw = (source.get("EMAIL_DIGEST_MODE") or "").strip().lower()
    return "active" if raw == "active" else "off"


# ---------------------------------------------------------------------------
# Unsubscribe token (byte-compatible with src/lib/email/unsubscribe-token.ts)
# ---------------------------------------------------------------------------


def make_unsubscribe_token(user_id: str, secret: str) -> str:
    """base64url("<user_id>.<hmac>") where hmac is the first 22 base64url chars
    of HMAC-SHA256(secret, "<namespace>:<user_id>").

    The TS verifier truncates to 22 characters and compares timing-safely; this
    must produce the identical string or the link 400s.
    """
    if not secret:
        raise ValueError("unsubscribe token signing secret is empty")
    mac = hmac.new(
        secret.encode("utf-8"),
        f"{UNSUBSCRIBE_NAMESPACE}:{user_id}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    mac_b64 = base64.urlsafe_b64encode(mac).decode("ascii").rstrip("=")[:22]
    payload = f"{user_id}.{mac_b64}".encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


#: What the inbox shows in the sender column. An address or a bare domain in
#: that slot reads as automated mail; a name reads as a publication.
FROM_DISPLAY_NAME = "Signalera"


def with_display_name(addr: str, name: str = FROM_DISPLAY_NAME) -> str:
    """Guarantee the sender renders as a name, not an address.

    EMAIL_FROM_ADDRESS is configured in Vercel as the bare `briefs@signalera.ai`,
    so every brief so far has arrived from "briefs@signalera.ai" rather than
    from "Signalera". An address that already carries a display name, or that
    we cannot parse, is returned untouched: this only ever adds a name, it
    never rewrites one an operator set deliberately.
    """
    raw = (addr or "").strip()
    if not raw or "<" in raw or ">" in raw:
        return raw
    if "@" not in raw:
        return raw
    return f"{name} <{raw}>"


def site_url(env: dict[str, str] | None = None) -> str:
    source = os.environ if env is None else env
    raw = (source.get("NEXT_PUBLIC_SITE_URL") or source.get("SITE_URL") or "").strip()
    return raw.rstrip("/") if raw else SITE_URL_FALLBACK


def track_url(base: str, call_id: str) -> str:
    """Deep link to the one place a commitment can actually be taken.

    /radar/calls already lists today's brief calls as adoptable rows; ?adopt
    focuses and highlights the specific one, and the hash anchors it if the
    page loads below the fold. The email is complete as a read without this
    click.
    """
    return f"{base}/radar/calls?adopt={call_id}#call-{call_id}"


# ---------------------------------------------------------------------------
# Field extraction from stored brief rows
# ---------------------------------------------------------------------------


def parse_market_pulse(raw: Any) -> str:
    """Return the market pulse narrative as flat prose.

    briefings.market_pulse is a TEXT column holding a JSON object
    ({"sentiment_word": ..., "narrative": ...}). Older and degraded rows can be
    plain prose or null. All three shapes are handled; nothing is fabricated.
    """
    if not raw:
        return ""
    value: Any = raw
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("{"):
            try:
                value = json.loads(stripped)
            except (ValueError, TypeError):
                return stripped
        else:
            return stripped
    if isinstance(value, dict):
        narrative = (value.get("narrative") or "").strip()
        if narrative:
            return narrative
        for key in ("summary", "text", "body"):
            candidate = (value.get(key) or "").strip()
            if candidate:
                return candidate
        return ""
    return str(value).strip()


def _days_between(start: Any, end: Any) -> int | None:
    """Whole calendar days from `start` to `end`, or None if either is unusable."""

    def _to_date(v: Any) -> date | None:
        if isinstance(v, date):
            return v
        if isinstance(v, str) and len(v) >= 10:
            try:
                return date.fromisoformat(v[:10])
            except ValueError:
                return None
        return None

    a, b = _to_date(start), _to_date(end)
    if a is None or b is None:
        return None
    return (b - a).days


def resolved_call_from_row(call: dict, outcome: dict) -> ResolvedCall:
    """Map a morning_brief_calls row plus its outcome row onto a ResolvedCall.

    Everything is read straight from the grader's persisted output. The stored
    LLM `confidence` is never read, and verdict_notes is deliberately excluded:
    it is free-form model prose we cannot bound, and the deterministic
    attribution line already carries the honest explanation.
    """
    meta = outcome.get("metadata") or {}
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except (ValueError, TypeError):
            meta = {}
    benchmarks = meta.get("benchmarks") or []
    benchmark = benchmarks[0] if isinstance(benchmarks, list) and benchmarks else {}

    entity_move = meta.get("entity_move_pct")
    if entity_move is None and outcome.get("actual_pct_change") is not None:
        # actual_pct_change is stored as a fraction; metadata carries percent.
        try:
            entity_move = float(outcome["actual_pct_change"]) * 100.0
        except (TypeError, ValueError):
            entity_move = None

    return ResolvedCall(
        entity=(
            meta.get("entity_symbol")
            or call.get("target_symbol")
            or "Unmapped"
        ),
        claim=(call.get("claim_text") or "").strip(),
        verdict=outcome.get("verdict") or "",
        attribution=outcome.get("attribution"),
        entity_move_pct=_as_float(entity_move),
        benchmark_symbol=benchmark.get("symbol") if isinstance(benchmark, dict) else None,
        benchmark_move_pct=(
            _as_float(benchmark.get("move_pct")) if isinstance(benchmark, dict) else None
        ),
        ungradable_reason=meta.get("ungradable_reason"),
    )


def _as_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def today_call_from_row(call: dict, base_url: str) -> TodayCall:
    days = _days_between(call.get("brief_date"), call.get("resolve_on"))
    return TodayCall(
        call_id=str(call.get("id")),
        entity=(call.get("target_symbol") or "Market"),
        claim=(call.get("claim_text") or "").strip(),
        horizon_label=horizon_label_for_days(days),
        track_url=track_url(base_url, str(call.get("id"))),
    )


def select_last_session_resolutions(
    calls: Iterable[dict],
    outcomes: Iterable[dict],
    exclude_brief_id: str | None,
) -> list[ResolvedCall]:
    """Pick the most recent fully-resolved session and return ALL of its calls.

    Selection is by the newest brief_date present among graded calls, not by
    verdict. Wrong and ungradable calls are first-class members of the result
    set; there is no filtering step that could ever drop a miss. Today's own
    calls are excluded because they have not resolved yet.
    """
    by_id = {str(c.get("id")): c for c in calls if c.get("id")}

    # Latest outcome per call. morning_brief_call_outcomes has no unique
    # constraint on call_id, so a regrade leaves two rows behind.
    latest: dict[str, dict] = {}
    for o in outcomes:
        cid = str(o.get("call_id") or "")
        if not cid or cid not in by_id:
            continue
        prev = latest.get(cid)
        if prev is None or (o.get("graded_at") or "") > (prev.get("graded_at") or ""):
            latest[cid] = o

    graded_dates = {
        str(by_id[cid].get("brief_date") or "")
        for cid in latest
        if str(by_id[cid].get("brief_id") or "") != str(exclude_brief_id or "")
    }
    graded_dates.discard("")
    if not graded_dates:
        return []
    session = max(graded_dates)

    rows: list[tuple[bool, str, ResolvedCall]] = []
    for cid, outcome in latest.items():
        call = by_id[cid]
        if str(call.get("brief_id") or "") == str(exclude_brief_id or ""):
            continue
        if str(call.get("brief_date") or "") != session:
            continue
        rows.append(
            (
                not bool(call.get("is_lead")),
                str(call.get("created_at") or ""),
                resolved_call_from_row(call, outcome),
            )
        )
    # Lead call first, then creation order. Stable and independent of verdict.
    rows.sort(key=lambda r: (r[0], r[1]))
    return [r[2] for r in rows]


def eligible_recipients(
    users: Iterable[dict],
    profiles_by_id: dict[str, dict],
) -> list[dict]:
    """Users with a real email who have not unsubscribed.

    A user with no user_profiles row is treated as subscribed, matching the
    column default (brief_email_subscribed boolean NOT NULL DEFAULT true).
    Only an explicit false excludes.
    """
    out: list[dict] = []
    for u in users:
        email = (u.get("email") or "").strip()
        uid = str(u.get("id") or "")
        if not email or not uid:
            continue
        profile = profiles_by_id.get(uid) or {}
        if profile.get("brief_email_subscribed") is False:
            continue
        out.append({"id": uid, "email": email})
    return out


# ---------------------------------------------------------------------------
# Resend dispatch
# ---------------------------------------------------------------------------


def resend_sender(api_key: str) -> Callable[[dict], None]:
    """Return a callable that POSTs one email to Resend and raises on failure.

    Kept as a factory so the orchestrator holds only a plain callable and every
    test can inject a fake without monkeypatching the network.
    """
    import requests  # imported lazily so an import of this module stays cheap

    def _send(message: dict) -> None:
        response = requests.post(
            RESEND_ENDPOINT,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=message,
            timeout=20,
        )
        if response.status_code >= 300:
            raise RuntimeError(
                f"resend returned {response.status_code}: {response.text[:400]}"
            )

    return _send


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def maybe_send_brief_email(
    brief_type: str = "morning",
    *,
    client: Any = None,
    sender: Callable[[dict], None] | None = None,
    env: dict[str, str] | None = None,
    now: datetime | None = None,
) -> dict:
    """Send today's brief to every eligible recipient. Never raises.

    Returns a summary dict for logging: {"status", "sent", "skipped", "failed"}.
    A "status" of "off", "no_brief", "no_recipients" or "error" all mean nothing
    was mailed, and every one of them is a normal, non-fatal outcome.
    """
    try:
        return _send_digest(
            brief_type, client=client, sender=sender, env=env, now=now
        )
    except Exception as exc:  # noqa: BLE001 - fail-open is the whole point
        logger.exception("[EMAIL DIGEST] send failed (pipeline unaffected): %s", exc)
        return {
            "status": "error",
            "error": str(exc),
            "sent": 0,
            "skipped": 0,
            "failed": 0,
        }


def _send_digest(
    brief_type: str,
    *,
    client: Any,
    sender: Callable[[dict], None] | None,
    env: dict[str, str] | None,
    now: datetime | None,
) -> dict:
    source = os.environ if env is None else env

    # Invariant 2: return before ANY side effect when the flag is not active.
    mode = digest_mode(env)
    if mode != "active":
        logger.info("[EMAIL DIGEST] EMAIL_DIGEST_MODE=%s, skipping send", mode)
        return {"status": "off", "sent": 0, "skipped": 0, "failed": 0}

    if brief_type != "morning":
        logger.info("[EMAIL DIGEST] brief_type=%s is not mailed", brief_type)
        return {"status": "not_morning", "sent": 0, "skipped": 0, "failed": 0}

    sb = client if client is not None else _make_client(source)
    if sb is None:
        logger.error("[EMAIL DIGEST] Supabase env missing; cannot send")
        return {"status": "error", "error": "no supabase client", "sent": 0,
                "skipped": 0, "failed": 0}

    brief = _fetch_brief(sb, brief_type)
    if not brief:
        logger.warning("[EMAIL DIGEST] no mailable brief found; nothing sent")
        return {"status": "no_brief", "sent": 0, "skipped": 0, "failed": 0}

    brief_id = str(brief.get("id"))
    base_url = site_url(env)

    today_rows = _fetch_calls_for_brief(sb, brief_id)
    prior_calls, prior_outcomes = _fetch_recent_resolutions(sb)
    resolved = select_last_session_resolutions(prior_calls, prior_outcomes, brief_id)

    generated_at = _format_generated_at(brief.get("created_at"), now)

    story_rows = _fetch_story_rows(sb, brief)
    stories = [str(r.get("title") or "").strip() for r in story_rows]
    # One fetch for the whole run. The per-recipient pass below is pure dict
    # work over these rows and makes NO model call and no extra query.
    personal_ctx = _fetch_personal_context(sb, story_rows)
    personal_now = now or datetime.now(timezone.utc)

    secret = (
        source.get("SUPABASE_JWT_SECRET")
        or source.get("SUPABASE_SERVICE_ROLE_KEY")
        or ""
    )
    if not secret:
        # Without a signing secret the footer link cannot work, and an email
        # with a dead unsubscribe link is worse than no email.
        logger.error(
            "[EMAIL DIGEST] no SUPABASE_JWT_SECRET/SERVICE_ROLE_KEY; refusing to send "
            "an email whose unsubscribe link would not work"
        )
        return {"status": "error", "error": "no signing secret", "sent": 0,
                "skipped": 0, "failed": 0}

    recipients = _fetch_recipients(sb)
    if not recipients:
        logger.warning("[EMAIL DIGEST] no eligible recipients")
        return {"status": "no_recipients", "sent": 0, "skipped": 0, "failed": 0}

    already = _fetch_already_sent(sb, brief_id)

    dispatch = sender
    if dispatch is None:
        api_key = source.get("RESEND_API_KEY") or ""
        if not api_key:
            logger.error("[EMAIL DIGEST] RESEND_API_KEY missing; nothing sent")
            return {"status": "error", "error": "no resend key", "sent": 0,
                    "skipped": 0, "failed": 0}
        dispatch = resend_sender(api_key)

    from_addr = with_display_name(
        source.get("EMAIL_FROM_ADDRESS") or "briefs@signalera.ai"
    )
    reply_to = source.get("EMAIL_REPLY_TO") or "admin@signalera.ai"

    sent = skipped = failed = 0
    for recipient in recipients:
        uid, email = recipient["id"], recipient["email"]

        # Invariant 3: the ledger is consulted before every single send.
        if uid in already:
            skipped += 1
            continue

        try:
            unsubscribe_url = (
                f"{base_url}/api/unsubscribe?"
                f"token={make_unsubscribe_token(uid, secret)}"
            )
            payload = BriefEmailPayload(
                brief_id=brief_id,
                brief_date=str(brief.get("briefing_date") or ""),
                generated_at_display=generated_at,
                market_pulse=parse_market_pulse(brief.get("market_pulse")),
                headline=(brief.get("headline") or "").strip(),
                lead_paragraph=(brief.get("lead_paragraph") or brief.get("summary") or "").strip(),
                unsubscribe_url=unsubscribe_url,
                site_url=base_url,
                resolved=resolved,
                today_calls=[today_call_from_row(c, base_url) for c in today_rows],
                stories=stories,
                issue_number=brief.get("issue_number"),
                personal=personal_block(uid, personal_ctx, now=personal_now),
            )
            rendered = render_email(payload)

            # Invariant 5: last-mile compliance guard.
            banned = find_banned_terms(rendered["text"]) + find_banned_terms(
                rendered["html"]
            )
            if banned:
                logger.error(
                    "[EMAIL DIGEST] refusing send to %s: body carried banned term(s) %s",
                    _mask(email),
                    sorted(set(banned)),
                )
                failed += 1
                continue

            dispatch(
                {
                    "from": from_addr,
                    "to": [email],
                    "reply_to": reply_to,
                    "subject": rendered["subject"],
                    "html": rendered["html"],
                    "text": rendered["text"],
                    "headers": {
                        "List-Unsubscribe": (
                            f"<{unsubscribe_url}>, "
                            f"<mailto:{reply_to}?subject=unsubscribe>"
                        ),
                        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                    },
                }
            )
            _record_send(sb, brief_id, uid)
            sent += 1
        except Exception as exc:  # noqa: BLE001 - one bad recipient never stops the run
            failed += 1
            logger.exception(
                "[EMAIL DIGEST] send failed for %s (continuing): %s", _mask(email), exc
            )

    logger.info(
        "[EMAIL DIGEST] brief=%s sent=%d skipped=%d failed=%d resolved_calls=%d",
        brief_id, sent, skipped, failed, len(resolved),
    )
    return {
        "status": "sent",
        "brief_id": brief_id,
        "sent": sent,
        "skipped": skipped,
        "failed": failed,
        "resolved_calls": len(resolved),
    }


def _mask(email: str) -> str:
    """Log-safe email. We log deliverability, not address books."""
    if "@" not in email:
        return "***"
    name, domain = email.split("@", 1)
    return f"{name[:2]}***@{domain}"


def _format_generated_at(created_at: Any, now: datetime | None) -> str:
    """Human timestamp for the market pulse header, always Eastern.

    Email cannot detect a recipient timezone: there is no client-side hook and
    no header that carries one. UTC was the honest-but-useless answer, because
    a reader in New York had to do arithmetic to learn whether a pre-open note
    was written this morning. Eastern is the market's own clock, so it is right
    for the content even when it is not the reader's local time, and it is
    always labelled ET so nobody has to guess which zone they are reading.

    No timezone column and no per-user logic: one conversion, one label.

    Falls back to `now` (or the current time) when the brief row has no usable
    created_at, so the header can never render blank and imply live state.
    """
    raw = created_at
    dt: datetime | None = None
    if isinstance(raw, datetime):
        dt = raw
    elif isinstance(raw, str) and raw.strip():
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            dt = None
    if dt is None:
        dt = now or datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(EASTERN).strftime("%b %d, %Y at %-I:%M %p ET")


# ---------------------------------------------------------------------------
# Supabase IO. Each helper soft-fails to an empty result; the caller decides.
# ---------------------------------------------------------------------------


def _make_client(source) -> Any:
    url = source.get("SUPABASE_URL")
    key = source.get("SUPABASE_SERVICE_ROLE_KEY") or source.get("SUPABASE_ANON_KEY")
    if not url or not key:
        return None
    from supabase import create_client

    return create_client(url, key)


def _rows(response: Any) -> list[dict]:
    data = getattr(response, "data", None)
    return list(data) if isinstance(data, list) else []


def _fetch_brief(sb: Any, brief_type: str) -> dict | None:
    res = (
        sb.table("briefings")
        .select(
            "id, briefing_date, briefing_type, headline, summary, lead_paragraph, "
            "market_pulse, story_rail_ids, issue_number, created_at"
        )
        .eq("briefing_type", brief_type)
        .neq("headline", STUB_HEADLINE)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = _rows(res)
    return rows[0] if rows else None


def _fetch_calls_for_brief(sb: Any, brief_id: str) -> list[dict]:
    res = (
        sb.table("morning_brief_calls")
        .select("id, claim_text, target_symbol, brief_date, resolve_on, is_lead, created_at")
        .eq("brief_id", brief_id)
        .order("is_lead", desc=True)
        .execute()
    )
    return _rows(res)


def _fetch_recent_resolutions(sb: Any) -> tuple[list[dict], list[dict]]:
    """The most recent graded outcomes plus the calls they belong to."""
    outcomes = _rows(
        sb.table("morning_brief_call_outcomes")
        .select("call_id, verdict, attribution, actual_pct_change, metadata, graded_at")
        .order("graded_at", desc=True)
        .limit(120)
        .execute()
    )
    call_ids = [str(o.get("call_id")) for o in outcomes if o.get("call_id")]
    if not call_ids:
        return [], []
    calls = _rows(
        sb.table("morning_brief_calls")
        .select("id, brief_id, brief_date, claim_text, target_symbol, is_lead, created_at")
        .in_("id", call_ids)
        .execute()
    )
    return calls, outcomes


def _fetch_story_rows(sb: Any, brief: dict) -> list[dict]:
    """Three to five article ROWS from the brief's own persisted story rail.

    Returns rows rather than titles so the per-recipient watchlist match can
    read primary_company and companies off the same fetch. One query serves
    both the shared stories section and every user's personal block.

    Reads story_rail_ids so the email shows the same rail the site shows. When
    the rail is absent we return nothing and the section is omitted rather than
    filled with a different set of stories than the brief chose.
    """
    rail = brief.get("story_rail_ids")
    if isinstance(rail, str):
        try:
            rail = json.loads(rail)
        except (ValueError, TypeError):
            rail = None
    if not isinstance(rail, list) or not rail:
        return []
    ids = [str(x) for x in rail[:5] if x]
    if not ids:
        return []
    rows = _rows(
        sb.table("articles")
        .select("id, title, primary_company, companies")
        .in_("id", ids)
        .execute()
    )
    by_id = {str(r.get("id")): r for r in rows}
    return [by_id[i] for i in ids if (by_id.get(i) or {}).get("title")]


def _list_all_auth_users(sb: Any) -> list[dict]:
    """Every auth user, walking the pager to exhaustion.

    Termination is on an EMPTY page, never on a short one. GoTrue is free to
    cap per_page below what we ask for, so treating a short page as the last
    page would reintroduce exactly the silent truncation this function exists
    to prevent. One extra round trip is the price of not guessing.

    Users are keyed by id so a row that shifts across a page boundary between
    requests is counted once rather than twice.
    """
    users: dict[str, dict] = {}
    page = 1
    while page <= AUTH_USERS_MAX_PAGES:
        listed = sb.auth.admin.list_users(page=page, per_page=AUTH_USERS_PER_PAGE)
        raw = listed if isinstance(listed, list) else getattr(listed, "users", []) or []
        if not raw:
            return list(users.values())
        for u in raw:
            uid = getattr(u, "id", None) or (u.get("id") if isinstance(u, dict) else None)
            if not uid:
                continue
            email = getattr(u, "email", None) or (
                u.get("email") if isinstance(u, dict) else None
            )
            users[str(uid)] = {"id": str(uid), "email": email or ""}
        page += 1

    logger.error(
        "[EMAIL DIGEST] auth user pager hit the %d page cap after %d users; "
        "the recipient set may be truncated",
        AUTH_USERS_MAX_PAGES,
        len(users),
    )
    return list(users.values())


def _fetch_personal_context(sb: Any, story_rows: list[dict]) -> PersonalContext:
    """Every row the per-user pass needs, fetched ONCE for the whole run.

    Five reads total regardless of recipient count. Each one soft-fails to
    empty: a personal block is an enhancement, and losing it must never cost
    anybody the brief itself.
    """
    ctx = PersonalContext(story_rows=story_rows)

    try:
        claims = _rows(
            sb.table("user_claims")
            .select(
                "id, user_id, user_claim, target_symbol, status, "
                "resolution_window_end, adopted_from_call_id"
            )
            .execute()
        )
        ctx.claims_by_user = bucket_by(claims, "user_id")
        claim_ids = [str(c.get("id")) for c in claims if c.get("id")]
        if claim_ids:
            for outcome in _rows(
                sb.table("user_claim_outcomes")
                .select("claim_id, verdict, attribution, actual_pct_change, graded_at")
                .in_("claim_id", claim_ids)
                .execute()
            ):
                cid = str(outcome.get("claim_id") or "")
                prev = ctx.outcomes_by_claim.get(cid)
                # Regrades leave more than one row; keep the newest.
                if cid and (
                    prev is None
                    or (outcome.get("graded_at") or "") > (prev.get("graded_at") or "")
                ):
                    ctx.outcomes_by_claim[cid] = outcome
    except Exception as exc:  # noqa: BLE001
        logger.warning("[EMAIL DIGEST] personal claims read failed: %s", exc)

    try:
        ctx.watchlist_by_user = bucket_by(
            _rows(
                sb.table("watchlist")
                .select("user_id, identifier, display_name, type")
                .execute()
            ),
            "user_id",
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[EMAIL DIGEST] personal watchlist read failed: %s", exc)

    try:
        for row in _rows(
            sb.table(SEND_LEDGER_TABLE).select("user_id, sent_at").execute()
        ):
            uid = str(row.get("user_id") or "")
            sent = str(row.get("sent_at") or "")
            if uid and sent > ctx.last_send_by_user.get(uid, ""):
                ctx.last_send_by_user[uid] = sent
    except Exception as exc:  # noqa: BLE001
        logger.warning("[EMAIL DIGEST] personal last-send read failed: %s", exc)

    return ctx


def _fetch_recipients(sb: Any) -> list[dict]:
    """Auth users with an email, minus anyone who unsubscribed."""
    try:
        users = _list_all_auth_users(sb)
    except Exception as exc:  # noqa: BLE001
        logger.error("[EMAIL DIGEST] could not list auth users: %s", exc)
        return []

    profiles_by_id: dict[str, dict] = {}
    try:
        for p in _rows(
            sb.table("user_profiles").select("id, brief_email_subscribed").execute()
        ):
            profiles_by_id[str(p.get("id"))] = p
    except Exception as exc:  # noqa: BLE001
        # A profiles read failure must NOT be interpreted as "everyone is
        # subscribed". Refuse rather than mail someone who opted out.
        logger.error(
            "[EMAIL DIGEST] user_profiles read failed; refusing to send rather than "
            "risk mailing an unsubscribed user: %s", exc
        )
        return []

    return eligible_recipients(users, profiles_by_id)


def _fetch_already_sent(sb: Any, brief_id: str) -> set[str]:
    """User ids already mailed for this brief. Empty set on any read failure.

    A failed read degrades to "send", not "skip". The UNIQUE(brief_id, user_id)
    constraint on the ledger is the hard backstop; this read is the fast path.
    """
    try:
        rows = _rows(
            sb.table(SEND_LEDGER_TABLE)
            .select("user_id")
            .eq("brief_id", brief_id)
            .execute()
        )
        return {str(r.get("user_id")) for r in rows if r.get("user_id")}
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "[EMAIL DIGEST] send-ledger read failed (%s); relying on the unique "
            "constraint for idempotence", exc
        )
        return set()


def _record_send(sb: Any, brief_id: str, user_id: str) -> None:
    try:
        sb.table(SEND_LEDGER_TABLE).insert(
            {
                "brief_id": brief_id,
                "user_id": user_id,
                "sent_at": datetime.now(timezone.utc).isoformat(),
            }
        ).execute()
    except Exception as exc:  # noqa: BLE001
        # The mail already left. Losing the ledger row risks one duplicate on a
        # re-run, which is strictly better than raising after a successful send.
        logger.error(
            "[EMAIL DIGEST] send succeeded but ledger write failed for brief=%s: %s",
            brief_id, exc,
        )

"""One compact, greppable dump of every feature flag the pipeline reads.

Why this exists: on 2026-08-08 an audit found that generate_lead_v2 had NEVER
executed in production. Not because it was broken, but because
.github/workflows/schedule.yml never mapped LEAD_V2 or UNIFIED_LEAD into the
job env, so both sat at their Python defaults forever. Nothing in the log said
so. Answering "is this flag on in prod?" took an archaeology dig through five
runs of grep.

So: print the resolved value of every flag, unconditionally, at the top of every
run, under the stable tag [FLAGS]. `gh run view <id> --log | grep '\\[FLAGS\\]'`
now answers the question in one command.

The read sites in ingest.py / synthesize.py / event_calendar.py etc. remain the
single source of truth. This module MIRRORS their default and their coercion so
it can resolve without importing them (no import side effects, no API keys
needed, runnable as a dry run anywhere). Each row carries its read site so a
drift is one jump away from being seen. Pure: reads os.environ, prints, returns.
It never raises into the caller.
"""

from __future__ import annotations

import os

_TRUTHY = ("1", "true", "yes", "on")

# kind semantics, each mirroring exactly one read-site idiom:
#   enum      -> value must be in `allowed`, anything else (INCLUDING the empty
#                string a missing repo Variable renders) falls back to `fallback`
#   truthy    -> `in _TRUTHY`; empty string is False
#   eq_true   -> `== "true"`; empty string is False
#   not_false -> `!= "false"`; empty string is True
#   presence  -> `if not os.environ.get(...)`; empty string is falsy
#   int/float -> numeric parse of the RAW value. An empty string raises
#                ValueError at import, which is exactly why these flags must
#                NOT be given a `${{ vars.X }}` mapping in the workflow.
#   int_env   -> int() via ingest._int_env: empty string or garbage falls back
#                to the default instead of raising, so these flags ARE safe to
#                map as repo Variables.
#   str       -> used verbatim. Empty string is NOT equivalent to the default,
#                so these must not be mapped either.
_FLAGS = (
    # name, read site, kind, default, allowed, fallback
    ("RELEVANCE_GRADE_MODE", "ingest.py:86", "enum", "shadow", ("legacy", "shadow", "new"), "shadow"),
    ("RELEVANCE_GRADE_MODEL", "ingest.py:91", "str", "<GEMINI_MODEL>", (), ""),
    ("RELEVANCE_NEW_GATE", "ingest.py:156", "int_env", "1", (), ""),
    ("WATCHLIST_GATE_EXCEPTION", "ingest.py:185", "int_env", "0", (), ""),
    ("GRADER_REJECT_LOG_SAMPLE", "ingest.py:211", "int_env", "50", (), ""),
    ("RELEVANCE_GRADE_SHADOW_SAMPLE_RATE", "ingest.py:114", "float", "0.10", (), ""),
    ("GRADER_SKIP_IRRELEVANT", "ingest.py:126", "truthy", "", (), ""),
    ("FILTER_PARALLEL_WORKERS", "ingest.py:153", "int", "50", (), ""),
    ("FILTER_MAX_RATE_RETRIES", "ingest.py:162", "int", "5", (), ""),
    ("FILTER_PROMPT_CACHE", "ingest.py:172", "truthy", "0", (), ""),
    ("FILTER_CACHE_TTL_SEC", "ingest.py:178", "int", "2100", (), ""),
    ("FILTER_PHASE_BUDGET_SEC", "ingest.py:185", "int", "3600", (), ""),
    ("INGEST_PHASE_BUDGET_SEC", "ingest.py:195", "int", "4800", (), ""),
    ("INGEST_BLOCKLIST_MODE", "ingest.py:915", "enum", "shadow", ("legacy", "shadow", "new"), "legacy"),
    ("STORE_CHUNK_SIZE", "ingest.py:1941", "int", "500", (), ""),
    ("TAGGING_PRIMARY_FOLD_ENABLED", "ingest.py:1970", "eq_true", "false", (), ""),
    ("MATERIALITY_RANK_MODE", "synthesize.py:63", "enum", "shadow", ("off", "shadow", "active"), "off"),
    ("UNIFIED_LEAD", "synthesize.py:92", "enum", "off", ("off", "on", "hard"), "off"),
    ("MARKET_PULSE_V2", "synthesize.py:103", "truthy", "", (), ""),
    ("LEAD_V2", "synthesize.py:115", "truthy", "", (), ""),
    ("PERSONALIZATION_MODE", "synthesize.py:128", "enum", "off", ("off", "shadow", "active"), "off"),
    ("LIVE_CALENDAR_ENABLED", "event_calendar.py:325", "not_false", "true", (), ""),
    ("CATALYST_CONSENSUS_ENABLED", "event_calendar.py:326", "eq_true", "false", (), ""),
    ("DISABLE_TICKER_POPULATION", "entity_resolver.py:399", "presence", "", (), ""),
    ("THESIS_GRADER_FORCE", "thesis_grader.py:862", "truthy", "", (), ""),
    ("COST_ABORT_USD", "outcome_evaluator.py:168", "float", "5.0", (), ""),
    ("RUN_BACKFILL", "the pipeline entrypoint:133", "eq_true", "false", (), ""),
    ("WATCHLIST_BOOST_CHUNK", "watchlist.py:18", "int", "200", (), ""),
    ("EMAIL_DIGEST_MODE", "brief_email_send.py:99", "enum", "off", ("off", "active"), "off"),
    ("SEC_USER_AGENT", "edgar/client.py:13", "str", "<Signalera default>", (), ""),
)


def _resolve(kind: str, raw: str | None, default: str, allowed, fallback: str) -> str:
    """Resolve one flag the way its read site would. Never raises."""
    if kind == "int_env":
        # Mirrors ingest._int_env exactly: empty or unparseable -> default.
        candidate = (raw or "").strip()
        if not candidate:
            return f"{default} (default; env empty or unset)"
        try:
            return str(int(candidate))
        except ValueError:
            return f"{default} (default; {candidate!r} is not an int)"
    if kind in ("int", "float"):
        candidate = default if raw is None else raw
        try:
            return str(int(candidate)) if kind == "int" else str(float(candidate))
        except (TypeError, ValueError):
            return f"PARSE-ERROR on {candidate!r} (read site would raise)"
    if kind == "str":
        return default if raw is None else (raw.strip() or "EMPTY (read site uses '')")
    if kind == "presence":
        return "set (feature disabled)" if raw else "unset (feature enabled)"

    value = (default if raw is None else raw).strip().lower()
    if kind == "truthy":
        return "on" if value in _TRUTHY else "off"
    if kind == "eq_true":
        return "on" if value == "true" else "off"
    if kind == "not_false":
        return "off" if value == "false" else "on"
    if kind == "enum":
        return value if value in allowed else f"{fallback} (coerced from {value!r})"
    return value


def build(env: dict | None = None) -> list[str]:
    """Return the [FLAGS] block as a list of lines. Pure, testable, no I/O."""
    source = os.environ if env is None else env
    lines = [
        "[FLAGS] ===== pipeline flag resolution =====",
        "[FLAGS] env= the raw process env value. <unset> means the workflow "
        "passes nothing; EMPTY means it passes an unset repo Variable.",
    ]
    for name, site, kind, default, allowed, fallback in _FLAGS:
        raw = source.get(name)
        if raw is None:
            shown = "<unset>"
        elif raw.strip() == "":
            shown = "EMPTY"
        else:
            shown = raw
        resolved = _resolve(kind, raw, default, allowed, fallback)
        lines.append(
            f"[FLAGS] {name:<36} env={shown:<12} resolved={resolved:<34} "
            f"default={default!r} site={site}"
        )
    lines.append(f"[FLAGS] ===== {len(_FLAGS)} flags =====")
    return lines


def emit(env: dict | None = None) -> None:
    """Print the block unconditionally. Swallows everything: a logging aid must
    never be able to take the pipeline down."""
    try:
        for line in build(env):
            print(line, flush=True)
    except Exception as e:  # pragma: no cover - defensive only
        print(f"[FLAGS] report failed (non-fatal): {e}", flush=True)


if __name__ == "__main__":
    emit()

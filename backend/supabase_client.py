"""Shared Supabase service-role client for backend pipeline writers.

Service-role is required because the content tables (articles, companies,
company_mentions, source_credibility, pattern_library, thesis_verdicts,
watchlist_articles, user_briefings) are being locked to service-role-only
writes. There is intentionally NO anon fallback: if the service-role key is
missing the pipeline must fail loud rather than silently write as anon, which
would break once the RLS lockdown lands.

Connection resilience (run #166): postgrest-py builds its httpx session with
http2=True and supabase-py exposes no option to override it. On a long ingest
run a single long-lived HTTP/2 connection exhausts its stream-id space; the
server sends a graceful GOAWAY (ConnectionTerminated error_code:0), httpx
surfaces it as RemoteProtocolError, and the in-flight write fails, marking
[1/16] INGEST degraded even though the brief is fine. Two defenses live here:
1. get_service_client rebuilds the PostgREST session over HTTP/1.1, which has
   no per-connection stream cap, removing the GOAWAY-on-exhaustion class.
2. execute_with_retry replays a write once the connection is recycled mid-flight
   (belt-and-suspenders for genuinely transient drops). Neither suppresses real
   failures: HTTP status errors (4xx/5xx) are never caught here.
"""

import base64
import functools
import json
import os
import time

import httpx

from supabase import create_client, Client

# A server-side HTTP/2 GOAWAY (graceful connection recycle after the stream-id
# space is exhausted) surfaces through httpx as RemoteProtocolError. ConnectError
# and ReadError cover a connection dropped before/while reading the response.
# These are the ONLY classes execute_with_retry recovers, and only because a
# recycled connection means the server never processed the request (the GOAWAY
# last_stream_id is below the request's stream id), so a replay is safe and not a
# double-write. Status-level failures (PostgREST 4xx/5xx, APIError) are NOT in
# this tuple, so genuine errors still surface and still degrade the run.
_CONN_RECYCLE_ERRORS = (
    httpx.RemoteProtocolError,
    httpx.ConnectError,
    httpx.ReadError,
)


def _disable_http2(client: Client) -> None:
    """Rebuild the PostgREST httpx session over HTTP/1.1.

    postgrest-py hardcodes http2=True when it builds the session and supabase-py
    gives no hook to override it, so the swap happens after construction. The new
    session clones base_url, auth headers (apikey + Authorization), and timeout
    from the original, so only the transport changes. Best-effort: if the swap
    ever fails against a future supabase-py internal, HTTP/2 stays on and
    execute_with_retry still provides resilience, so the pipeline is never broken
    by a transport tweak.
    """
    try:
        old = client.postgrest.session
        client.postgrest.session = httpx.Client(
            base_url=old.base_url,
            headers=old.headers,
            timeout=old.timeout,
            follow_redirects=True,
            http2=False,
        )
    except Exception as e:
        print(f"  ⚠ get_service_client: could not disable HTTP/2 (continuing on HTTP/2): {e}")


def get_service_client() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise RuntimeError(
            "SUPABASE_SERVICE_ROLE_KEY is required for the pipeline writers. "
            "Refusing to fall back to the anon key."
        )
    client = create_client(url, key)
    _disable_http2(client)
    return client


def execute_with_retry(thunk, *, attempts=3, backoff_s=1.0, what="supabase call"):
    """Run a PostgREST `.execute()` thunk, retrying only on a connection recycle.

    `thunk` is a zero-arg callable that performs one PostgREST request (for
    example: `lambda: supabase.table("aliases").update(...).eq("id", x).execute()`).
    On a _CONN_RECYCLE_ERRORS the dead connection is discarded by httpx, so the
    retry runs on a fresh one. Bounded attempts, short linear backoff. Does NOT
    catch HTTP status errors, so real failures still propagate on the first try.
    Re-raises the last connection error if every attempt is recycled.
    """
    last = None
    for i in range(1, attempts + 1):
        try:
            return thunk()
        except _CONN_RECYCLE_ERRORS as e:
            last = e
            print(f"  ⚠ {what}: connection recycled (attempt {i}/{attempts}): {e}")
            if i < attempts:
                time.sleep(backoff_s)
    raise last


@functools.lru_cache(maxsize=1)
def service_client() -> Client:
    """One service-role client per process, for READ sites that a module-level
    anon-keyed client used to serve.

    Those modules (summarize, weekly_summary, brief_feedback_loop, embedding_job,
    thesis_generator, synthesize) read tables that have RLS enabled and no
    policy, so under a genuine anon key the read returns [] with no error. In
    production the secret bound to SUPABASE_ANON_KEY is the service JWT, which
    is why the reads work there; locally it is a publishable key and they read
    empty. Naming the intent at the call site removes the dependence on that
    accident. Memoised so the call sites share one HTTP/1.1 session.
    """
    return get_service_client()


def describe_key_role(key: str | None) -> str:
    """The ROLE a Supabase key carries, never the key.

    Legacy JWT keys carry a `role` claim (anon | service_role). New-style keys
    are opaque with a prefix: sb_publishable_ (anon-equivalent) and sb_secret_
    (service-equivalent). Anything else is 'unknown'. The output is safe to log.
    """
    if not key:
        return "unset"
    if key.startswith("sb_publishable_"):
        return "publishable"
    if key.startswith("sb_secret_"):
        return "secret"
    parts = key.split(".")
    if len(parts) == 3:
        try:
            payload = parts[1] + "=" * (-len(parts[1]) % 4)
            claims = json.loads(base64.urlsafe_b64decode(payload))
            return str(claims.get("role") or "jwt-without-role")
        except Exception:
            return "unparseable-jwt"
    return "unknown"


#: Roles that bypass RLS. describe_key_role() output is compared against this.
_SERVICE_ROLES = ("service_role", "secret")
#: Roles that POSITIVELY do not: a key that reads as one of these in the
#: service slot is refused. An unclassifiable key (a fake in tests, a future
#: format) is logged as a warning instead: the pipeline must not die on a
#: format this helper has not met.
_NON_SERVICE_ROLES = ("anon", "publishable")


def assert_key_roles(env: dict | None = None, log=print) -> dict:
    """Startup assertion: log the role claim of each bound key and refuse to
    run with a service key that is not service-shaped.

    Logs claims only. Returns {env_var: role} for tests. Raises RuntimeError
    when SUPABASE_SERVICE_ROLE_KEY positively carries an anon-class role,
    which is the one configuration that would make every writer fail on the
    first insert while looking configured. A key it cannot classify is
    logged, never fatal. A service-shaped SUPABASE_ANON_KEY
    is logged as a warning, not an error: it is how production runs today.
    """
    env = os.environ if env is None else env
    roles = {
        name: describe_key_role(env.get(name))
        for name in ("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY")
    }
    log("[KEYS] " + ", ".join(f"{k}={v}" for k, v in roles.items()))
    svc = roles["SUPABASE_SERVICE_ROLE_KEY"]
    if svc in _NON_SERVICE_ROLES:
        raise RuntimeError(
            f"SUPABASE_SERVICE_ROLE_KEY carries role {svc!r}, not a service role; "
            "every writer would be rejected by RLS. Refusing to start."
        )
    if svc not in _SERVICE_ROLES and svc != "unset":
        log(f"[KEYS] warning: SUPABASE_SERVICE_ROLE_KEY role could not be classified ({svc}); "
            "not refusing, but check it")
    if roles["SUPABASE_ANON_KEY"] in _SERVICE_ROLES:
        log("[KEYS] warning: SUPABASE_ANON_KEY carries a service role; the name is wrong, "
            "the behaviour is service-role")
    return roles

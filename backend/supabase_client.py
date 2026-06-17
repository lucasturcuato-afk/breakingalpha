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

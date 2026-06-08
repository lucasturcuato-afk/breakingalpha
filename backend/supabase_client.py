"""Shared Supabase service-role client for backend pipeline writers.

Service-role is required because the content tables (articles, companies,
company_mentions, source_credibility, pattern_library, thesis_verdicts,
watchlist_articles, user_briefings) are being locked to service-role-only
writes. There is intentionally NO anon fallback: if the service-role key is
missing the pipeline must fail loud rather than silently write as anon, which
would break once the RLS lockdown lands.
"""

import os

from supabase import create_client, Client


def get_service_client() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise RuntimeError(
            "SUPABASE_SERVICE_ROLE_KEY is required for the pipeline writers. "
            "Refusing to fall back to the anon key."
        )
    return create_client(url, key)

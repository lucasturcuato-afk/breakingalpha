"""Import smoke test: a tripwire, not behavioral coverage.

Each module below imports cleanly with NO network access and NO secrets in the
environment. The test asserts only that the module's top level executes (syntax
is valid, the import graph resolves, no top-level crash). It does NOT exercise
any pipeline behavior.

The set is intentionally restricted to modules that are import-safe with a
scrubbed environment. Modules that construct a Supabase or Gemini client at
module scope (and therefore require secrets to import) are excluded, as are the
protected files. See the PR body for the full exclusion list and rationale.

Membership here was verified empirically: with runtime deps installed and all
SUPABASE_*/GEMINI_API_KEY/FINNHUB_API_KEY vars unset, these 17 import and the
20 excluded secret-at-import modules raise KeyError.
"""

import importlib

import pytest

# Verified import-safe under a scrubbed environment (no secrets, no network).
IMPORT_SAFE_MODULES = [
    "output_constants",
    "normalize",
    "fulltext",
    "market_tape",
    "bea_calendar",
    "macro_calendar",
    "market_data",
    "entity_resolver",
    "finnhub_helper",
    "outputs",
    "lead_preselect",
    "backfill_content",
    "sector_backfill",
    "ingest_sec",
    "ingest_xbrl_facts",
    "outcome_evaluator",
    "supabase_client",
]


@pytest.mark.parametrize("module_name", IMPORT_SAFE_MODULES)
def test_module_imports(module_name):
    """The module imports without network or secrets."""
    mod = importlib.import_module(module_name)
    assert mod is not None

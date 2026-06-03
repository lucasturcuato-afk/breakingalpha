"""SEC EDGAR constants. Item codes, transaction codes, etc."""

ITEM_CODE_DESCRIPTIONS = {
    "1.01": "Material Definitive Agreement",
    "1.02": "Termination of Material Definitive Agreement",
    "1.03": "Bankruptcy or Receivership",
    "2.01": "Completion of Acquisition or Disposition",
    "2.02": "Results of Operations",
    "2.03": "Direct Financial Obligation",
    "2.04": "Triggering Events",
    "2.05": "Costs of Exit/Disposal",
    "2.06": "Material Impairments",
    "3.01": "Notice of Delisting",
    "4.01": "Change in Auditor",
    "4.02": "Non-Reliance on Prior Financial Statements",
    "5.01": "Changes in Control",
    "5.02": "Director/Officer Changes",
    "5.03": "Amendments to Articles/Bylaws",
    "5.07": "Vote of Security Holders",
    "7.01": "Regulation FD Disclosure",
    "8.01": "Other Events",
    "9.01": "Financial Statements and Exhibits",
}

# Items that ALWAYS surface in the brief
MATERIAL_8K_ITEMS = {"1.01", "1.02", "1.03", "2.01", "2.02", "2.05", "2.06", "4.02", "5.01", "5.02"}

TRANSACTION_CODES = {
    "P": "open_market_purchase",
    "S": "open_market_sale",
    "A": "grant",
    "M": "option_exercise",
    "F": "tax_withholding",
    "G": "gift",
    "I": "discretionary",
    "J": "other",
    "K": "swap",
    "L": "small_acquisition",
}

CSUITE_TITLES = {
    "ceo", "chief executive officer",
    "cfo", "chief financial officer",
    "coo", "chief operating officer",
    "president",
    "chairman", "chair",
}

FORMS_OF_INTEREST = ["8-K", "8-K/A", "4", "4/A", "10-Q", "10-K", "10-Q/A", "10-K/A"]

# Only ingest filings from the last N days. Prevents historical backfill
# on first-run-per-CIK. 14 days gives buffer for cron outage recovery
# without years of noise.
FILING_LOOKBACK_DAYS = 14

INSIDER_SALE_THRESHOLD_USD = 1_000_000

# --- 8-K summary self-heal (re-summarize stuck-NULL rows) ------------------
# The cron summarizes an 8-K only on first ingest; a transient Gemini failure
# leaves summary NULL forever (dedup never reprocesses the accession). The
# self-heal pass re-summarizes NULL rows on later runs, bounded so a
# persistently failing row is not hammered every run:
#   - only rows filed within RESUMMARIZE_LOOKBACK_DAYS are eligible
#   - at most MAX_SUMMARY_ATTEMPTS attempts per row, then it is left pending
#   - exponential backoff between attempts (RESUMMARIZE_BASE_BACKOFF_HOURS * 2**attempts)
#   - at most RESUMMARIZE_MAX_PER_RUN rows re-summarized per cron run
RESUMMARIZE_LOOKBACK_DAYS = 7
MAX_SUMMARY_ATTEMPTS = 4
RESUMMARIZE_BASE_BACKOFF_HOURS = 3
RESUMMARIZE_MAX_PER_RUN = 25
RESUMMARIZE_CANDIDATE_LIMIT = 200
RESUMMARIZE_SPACING_SEC = 2.0

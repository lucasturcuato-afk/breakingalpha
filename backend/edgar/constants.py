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

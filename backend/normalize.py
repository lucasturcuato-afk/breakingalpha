"""
Entity name normalization for W2-A alias resolution.
See docs/w2-a-entity-resolution-design.md section 6 for spec.
"""
import unicodedata


def normalize_lookup_key(s: str) -> str:
    """
    Normalize a raw entity surface form into a lookup key for alias resolution.

    Order matters:
    1. Strip TM/R/C symbols first. NFKC decomposes these to ASCII (TM -> "TM")
       which would concatenate to the preceding token (Permag-TM -> permagtm),
       defeating dedup.
    2. NFKC for full-width-to-ASCII and ligature decomposition.
    3. Fold curly quotes (NFKC does not).
    4. Strip whitespace and lowercase.

    Possessives are NOT stripped here; that is semantic cleanup upstream.
    Accented characters are preserved (Societe stays Societe with accents).
    """
    s = s.replace("\u2122", "").replace("\u00ae", "").replace("\u00a9", "")
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("\u2019", "'").replace("\u2018", "'")
    s = s.replace("\u201c", '"').replace("\u201d", '"')
    s = s.strip().lower()
    return s

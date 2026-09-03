"""Normalization shared by the union builder and the offline harness.
   Kept in lockstep with src/lib/registry-union/normalize.ts."""
import re, unicodedata

# EDGAR writes the state/vintage marker into the registrant name:
#   'BANK OF AMERICA CORP /DE/', 'LENNAR CORP /NEW/', 'QUALCOMM INC/DE'
_EDGAR_MARK = re.compile(r"\s*/\s*[A-Za-z]{0,4}\s*/?\s*$")

# Pure legal-form tokens. Carry no identity in any name.
LEGAL = {
    "inc","incorporated","corp","corporation","co","company","companies","cos",
    "ltd","limited","plc","llc","lp","llp","lllp","sa","sab","nv","bv","ag","se",
    "ab","as","asa","oyj","spa","gmbh","kgaa","pte","pty","kk","kabushiki",
    "aktiengesellschaft","sas","srl","ulc","fsb","na","the","cv","oy","aps",
}
# Weak-identity tokens. Real words, but two names sharing only these have not
# agreed. Removed ONLY to form the WEAK key, never the STRONG key.
# Kept deliberately short. An earlier draft included industries / enterprises /
# partners / global, which strips identity rather than structure:
# 'CF Industries Holdings' collapsed all the way to 'cf'.
WEAK_TAIL = {"holdings", "holding", "group", "groupe", "worldwide", "international"}

def strip_marker(s: str) -> str:
    prev = None
    while prev != s:
        prev = s
        s = _EDGAR_MARK.sub("", s).strip()
    return s

def _tokens(name: str):
    s = strip_marker(name or "")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    # '&' collapses to a SPACE, not to the word "and". Expanding it inserts a
    # token that then blocks legal-form stripping at the tail:
    # 'JPMORGAN CHASE & CO' would key as 'jpmorgan chase and' and never match
    # the typed 'JPMorgan Chase'.
    s = s.lower().replace("&", " ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return [t for t in s.split() if t]

def strong_key(name: str) -> str:
    """Legal forms stripped from the tail; identity words all kept."""
    t = _tokens(name)
    while t and t[0] in ("the",):
        t = t[1:]
    while t and t[-1] in LEGAL:
        t = t[:-1]
    return " ".join(t)

def weak_key(name: str) -> str:
    """strong_key minus trailing weak-identity words. Used only for
       multi-token typed names, and only when unique across the tier."""
    t = strong_key(name).split()
    while t and t[-1] in WEAK_TAIL:
        t = t[:-1]
    return " ".join(t)


# ---------------------------------------------------------------------------
# Legal-form CLASS. Two names that each carry an explicit legal form, and carry
# DIFFERENT ones, are not the same registrant. This is the rule that stops
# 'EQT AB' (the Swedish private-equity firm, key 'eqt' once the Swedish form is
# stripped) from landing on 'EQT Corp' (NYSE: EQT, natural gas). When only one
# side names a form, or neither does, the rule stays silent.
# ---------------------------------------------------------------------------
FORM_CLASS = {}
for _cls, _forms in {
    "uscorp": ("inc", "incorporated", "corp", "corporation", "co", "company", "companies", "cos"),
    "llc":    ("llc", "ulc"),
    "lp":     ("lp", "llp", "lllp"),
    "ltd":    ("ltd", "limited"),
    "plc":    ("plc",),
    "sa":     ("sa", "sab", "sas"),
    "nv":     ("nv",),
    "bv":     ("bv",),
    "ag":     ("ag", "aktiengesellschaft", "kgaa"),
    "se":     ("se",),
    "ab":     ("ab",),
    "as":     ("as", "asa", "aps"),
    "oy":     ("oy", "oyj"),
    "spa":    ("spa", "srl"),
    "gmbh":   ("gmbh",),
    "pte":    ("pte",),
    "pty":    ("pty",),
    "kk":     ("kk", "kabushiki"),
    "bank":   ("na", "fsb"),
    "cv":     ("cv",),
}.items():
    for _f in _forms:
        FORM_CLASS[_f] = _cls


def form_class(name: str):
    """The legal-form class named at the tail of `name`, or None."""
    t = _tokens(name)
    while t and t[-1] in ("the",):
        t = t[:-1]
    return FORM_CLASS.get(t[-1]) if t else None

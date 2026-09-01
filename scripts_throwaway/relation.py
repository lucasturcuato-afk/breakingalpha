"""THROWAWAY. Name-relation classifier used by the cross-signal check.

Answers: given two identity name strings, what is their RELATION?
The relation, not the raw string position, is what the check consumes.
"""
import re, sys, difflib, string, unicodedata
sys.path.insert(0, '/Users/noahhanning/td2-crosssignal')
from backend.normalize import normalize_lookup_key          # v1, the STORED key
from backend.company_match import normalize_company_key     # v2, READ-ONLY key

STOP = {
    "inc","incorporated","corp","corporation","co","company","ltd","limited",
    "plc","llc","lp","sa","nv","ag","se","ab","as","spa","holdings","holding",
    "group","the","trust","companies","intl","international","class","common",
    "stock","and","of","&",
}

def toks(n):
    n = re.sub(r"/.*$", " ", (n or "").lower())
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    return [t for t in n.split() if t and t not in STOP]

def flat(n):
    """lowercase alphanumeric only, no spaces. The substring test surface."""
    n = unicodedata.normalize("NFKD", (n or "")).lower()
    return re.sub(r"[^a-z0-9]", "", n)

# Smaller stop set for the acronym test. "International"/"Corporation" are
# legal-form noise for FOLDING but they are load-bearing LETTERS in an acronym
# (IBM = International Business Machines), so they must not be stripped here.
ABBR_STOP = {"the", "of", "and", "&"}

def abbr_toks(n):
    n = re.sub(r"/.*$", " ", (n or "").lower())
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    return [t for t in n.split() if t and t not in ABBR_STOP]

def initials(n):
    return "".join(x[0] for x in abbr_toks(n))

def relate(a, b):
    """Return (relation, ratio). Relations, strongest first.

    EQ      identical after v2 fold
    ABBR    one is the initials of the other (>=2 letters)
    TPREFIX token-prefix: shorter token list is a leading run of the longer
    TSUB    shorter token set (>=2) fully contained in longer, not a prefix
    NEAR    difflib ratio >= 0.60 on stop-stripped tokens
    CPREFIX character-prefix only (no token relation)   -- WEAK
    CSUFFIX character-suffix only                        -- WEAK
    CINNER  character-interior only                      -- WEAK
    NONE    no relation found
    """
    if not a or not b:
        return "UNKNOWN", 0.0
    ka, kb = normalize_company_key(a), normalize_company_key(b)
    ta, tb = toks(a), toks(b)
    sa, sb = " ".join(ta), " ".join(tb)
    ratio = difflib.SequenceMatcher(None, sa, sb).ratio() if sa and sb else 0.0
    if ka == kb or (sa and sa == sb):
        return "EQ", 1.0
    ia, ib = initials(a), initials(b)
    fa, fb = flat(a), flat(b)
    # Exact initials, or a >=3-letter prefix of them. The prefix form is needed
    # because trailing qualifiers do not enter the acronym: LIC = Life Insurance
    # Corporation, whose full initials including "of India" are 'lici'.
    def _abbr_hit(short, ini):
        if len(short) < 2 or not ini: return False
        return short == ini or (len(short) >= 3 and ini.startswith(short))
    if _abbr_hit(fa, ib) or _abbr_hit(fb, ia):
        return "ABBR", ratio
    if ta and tb:
        short, long_ = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
        if len(short) >= 1 and long_[:len(short)] == short and len(short) < len(long_):
            return "TPREFIX", ratio
        if len(short) >= 2 and all(t in long_ for t in short):
            return "TSUB", ratio
        # A SINGLE significant token contained NOT at the head is the ambiguous
        # case and must not fold: 'Vanguard' sits inside 'American Vanguard
        # Corp' (AVD, a different company) exactly as 'Meta' sits inside 'Meta
        # Platforms' (the same company). Head position is the only thing that
        # separates them, and TPREFIX above already took the head case.
        if len(short) == 1 and short[0] in long_:
            return "TINNER", ratio
    # NEAR is difflib, and difflib is unreliable when either side is short:
    # 'AXT'/'Baxter'=0.67, 'Excel'/'Hexcel'=0.91, 'Vanta'/'Novanta'=0.83 are all
    # above the repo's 0.60 bar and all denote DIFFERENT companies. Requiring at
    # least one shared significant token is what separates a spelling variant
    # from a coincidental character overlap.
    if ratio >= 0.60 and (set(ta) & set(tb)) and min(len(ta), len(tb)) >= 2:
        return "NEAR", ratio
    # character-level containment. WEAK by construction: used as remedy
    # evidence, never on its own as the agree/disagree decision.
    if len(fa) >= 3 and len(fb) >= 3:
        sh, lo = (fa, fb) if len(fa) <= len(fb) else (fb, fa)
        i = lo.find(sh)
        if i >= 0:
            if i == 0:            return "CPREFIX", ratio
            if i + len(sh) == len(lo): return "CSUFFIX", ratio
            return "CINNER", ratio
    return "NONE", ratio

# Which relations count as "these two strings denote the SAME company".
# Deliberately generous: the check must under-report, not over-report.
AGREE = {"EQ", "ABBR", "TPREFIX", "TSUB", "NEAR"}
# CPREFIX is agreement-leaning (a short name that is a character prefix of its
# own legal name: CSL / CSL Limited, Vanguard / Vanguard Group) but it also
# covers real collisions (Fidelity / Fidelity National ...). It gets its own
# verdict so the matrix can route it.
def agrees(rel):
    return rel in AGREE

def verdict(a, b):
    rel, ratio = relate(a, b)
    if rel == "UNKNOWN":  return "ABSENT", rel, ratio
    if agrees(rel):       return "AGREE", rel, ratio
    if rel == "CPREFIX":  return "AGREE_WEAK", rel, ratio
    return "DISAGREE", rel, ratio

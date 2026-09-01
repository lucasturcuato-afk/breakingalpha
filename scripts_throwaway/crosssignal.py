"""THROWAWAY. Cross-signal agreement check, measured read-only against prod.
Consumes the JSON snapshots pulled by the sibling scripts. Writes no rows."""
import sys, json, collections, itertools
sys.path.insert(0, '/Users/noahhanning/td2-crosssignal/scripts_throwaway')
from relation import relate, verdict, normalize_lookup_key, normalize_company_key, flat, toks

SP = '/private/tmp/claude-501/-Users-noahhanning-breakingalpha/81e5083c-088c-4660-8410-2dc25d57bc3d/scratchpad/'
comp = json.load(open(SP + 'companies.json'))
ct   = json.load(open(SP + 'cik_tickers.json'))
al   = json.load(open(SP + 'aliases.json'))

# ---- registry indexes -------------------------------------------------------
CIK2NAME, TKR2NAME, TKR2CIK = {}, {}, {}
for r in ct:
    CIK2NAME.setdefault(str(r['cik']), r['company_name'])
    TKR2NAME.setdefault((r['ticker'] or '').upper(), r['company_name'])
    TKR2CIK.setdefault((r['ticker'] or '').upper(), str(r['cik']))

# ---- article tag index ------------------------------------------------------
# articles.companies holds NAMES. articles.primary_company is Gemini's raw
# string off the article text (ingest.py:2757), never canonicalized.
ART = collections.defaultdict(collections.Counter)   # name -> Counter(pc)
ART_TOTAL = collections.Counter()                    # name -> tagged article count
n_art = 0
for line in open(SP + 'articles.jsonl'):
    a = json.loads(line); n_art += 1
    names = a.get('companies') or []
    pc = (a.get('primary_company') or '').strip()
    for nm in names:
        if not nm: continue
        k = nm.strip().lower()
        ART_TOTAL[k] += 1
        if pc: ART[k][pc] += 1
print(f'articles walked {n_art}, distinct tagged names {len(ART_TOTAL)}')

ALIAS_BY_CANON = collections.defaultdict(list)
for a in al:
    ALIAS_BY_CANON[a['canonical_id']].append(a)

MIN_ART = 3          # below this the article signal is ABSENT, not weak
CONC_MIN = 0.50      # modal share below this = AMBIGUOUS

def art_signal(name):
    """Return (claim, support, total, concentration, second_claim, second_n)."""
    k = (name or '').strip().lower()
    c = ART.get(k)
    tot = ART_TOTAL.get(k, 0)
    if not c or tot < MIN_ART:
        return None, 0, tot, 0.0, None, 0
    ranked = c.most_common()
    top, n1 = ranked[0]
    denom = sum(c.values())
    second, n2 = (ranked[1] if len(ranked) > 1 else (None, 0))
    return top, n1, denom, (n1 / denom if denom else 0.0), second, n2

def resolve_claim(s):
    """A claim string may be a bare ticker. Resolve to a registrant name if so."""
    if not s: return s
    t = s.strip().upper()
    if 1 <= len(t) <= 5 and t.isalpha() and t == s.strip() and t in TKR2NAME:
        return TKR2NAME[t]
    return s

ROWS = []
for r in comp:
    name = r['name'] or ''
    cik  = str(r['sec_cik']) if r['sec_cik'] else None
    tkr  = (r['ticker'] or '').upper() or None
    s_reg = CIK2NAME.get(cik) if cik else None
    s_tkr = TKR2NAME.get(tkr) if tkr else None
    raw_art, sup, tot, conc, raw2, n2 = art_signal(name)
    s_art  = resolve_claim(raw_art) if raw_art else None
    s_art2 = resolve_claim(raw2) if raw2 else None
    ROWS.append(dict(
        id=r['id'], name=name, ticker=tkr, cik=cik, mentions=r['mention_count'] or 0,
        k1=normalize_lookup_key(name), k2=normalize_company_key(name),
        s_reg=s_reg, s_tkr=s_tkr, s_art=s_art, art_raw=raw_art, art_sup=sup,
        art_tot=tot, art_conc=conc, s_art2=s_art2, art2_n=n2,
        n_alias=len(ALIAS_BY_CANON.get(r['id'], [])),
    ))

print(f'rows {len(ROWS)}')
print('  with ticker      ', sum(1 for r in ROWS if r['ticker']))
print('  with cik         ', sum(1 for r in ROWS if r['cik']))
print('  with reg claim   ', sum(1 for r in ROWS if r['s_reg']))
print('  with tkr claim   ', sum(1 for r in ROWS if r['s_tkr']))
print('  with art claim   ', sum(1 for r in ROWS if r['s_art']))
print('  art tagged >0    ', sum(1 for r in ROWS if r['art_tot'] > 0))
json.dump(ROWS, open(SP + 'rows.json', 'w'))

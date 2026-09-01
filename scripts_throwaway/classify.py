"""THROWAWAY. Cross-signal agreement check v2. ONE check; remedy read off the
pattern of which signals coalesce. Read-only; writes nothing to prod."""
import sys, json, collections
sys.path.insert(0, '/Users/noahhanning/td2-crosssignal/scripts_throwaway')
from relation import relate, verdict, flat, normalize_lookup_key, normalize_company_key

SP = '/private/tmp/claude-501/-Users-noahhanning-breakingalpha/81e5083c-088c-4660-8410-2dc25d57bc3d/scratchpad/'
comp = json.load(open(SP + 'companies.json'))
ct   = json.load(open(SP + 'cik_tickers.json'))
al   = json.load(open(SP + 'aliases.json'))

CIK2NAME, TKR2NAME = {}, {}
for r in ct:
    CIK2NAME.setdefault(str(r['cik']), r['company_name'])
    TKR2NAME.setdefault((r['ticker'] or '').upper(), r['company_name'])

ART = collections.defaultdict(collections.Counter)
for line in open(SP + 'articles.jsonl'):
    a = json.loads(line); pc = (a.get('primary_company') or '').strip()
    for nm in (a.get('companies') or []):
        if nm and pc: ART[nm.strip().lower()][pc] += 1

ALIASES = collections.defaultdict(list)
for a in al: ALIASES[a['canonical_id']].append(a.get('surface_form') or '')

MIN_SUPPORT = 3   # the ONE threshold in the whole check

def _ticker_form(s):
    t = (s or '').strip().upper()
    return TKR2NAME.get(t) if (1 <= len(t) <= 5 and t.isalpha()) else None

def agree(a, b, resolve_a=False, resolve_b=False):
    """Do claim strings a and b denote the same company?

    resolve_* permits expanding that side through cik_tickers when it is a bare
    symbol. IT IS ALLOWED ONLY ON THE ARTICLE SIDE. Expanding companies.name or
    the registry claim through the ticker table re-imports the registry's own
    opinion and re-creates the tautology this design exists to escape: it would
    make companies.name 'CSL' silently become 'CARLISLE COMPANIES INC' and then
    "agree" with the very CIK stamp under test."""
    if not a or not b: return None
    forms_a = {a} | ({_ticker_form(a)} if resolve_a else set())
    forms_b = {b} | ({_ticker_form(b)} if resolve_b else set())
    for x in filter(None, forms_a):
        for y in filter(None, forms_b):
            if verdict(x, y)[0].startswith('AGREE'): return True
    return False

def frag(a, b):
    """Where flat(a) sits inside flat(b). REMEDY EVIDENCE ONLY, never a detector."""
    fa, fb = flat(a or ''), flat(b or '')
    if len(fa) < 3 or len(fb) < 3 or fa == fb: return 'NA'
    if fa not in fb: return 'NOT_SUBSTR'
    i = fb.find(fa)
    return 'PREFIX' if i == 0 else ('SUFFIX' if i + len(fa) == len(fb) else 'INTERIOR')

OUT = []
for r in comp:
    name = r['name'] or ''
    cik = str(r['sec_cik']) if r['sec_cik'] else None
    tkr = (r['ticker'] or '').upper() or None
    s_reg = CIK2NAME.get(cik) if cik else None
    s_tkr = TKR2NAME.get(tkr) if tkr else None
    reg = s_reg or s_tkr                       # the registry's name for this row
    modes = ART.get(name.strip().lower(), collections.Counter())
    total = sum(modes.values())
    # split the row's own article evidence by whether it corroborates the NAME
    self_modes, other_modes = [], []
    for m, n in modes.most_common():
        (self_modes if agree(name, m, resolve_b=True) else other_modes).append((m, n))
    A_self = sum(n for _, n in self_modes)
    A_other = sum(n for _, n in other_modes)
    top_other = other_modes[0][0] if other_modes else None
    art_present = (A_self >= MIN_SUPPORT) or (A_other >= MIN_SUPPORT)

    reg_vs_name = agree(name, reg) if reg else None   # NEITHER side resolved
    reg_vs_other = agree(reg, top_other, resolve_b=True) if (reg and top_other) else None

    if reg is None and not art_present:
        k, rem = 'UNDECIDABLE_SINGLE_SIGNAL', 'none'
    elif not art_present:                                   # registry vs name only
        k, rem = ('AGREE', 'none') if reg_vs_name else ('TWO_SIGNAL_NAME_VS_REG', 'PROPOSE_DETACH')
    elif A_self >= MIN_SUPPORT and A_other >= MIN_SUPPORT and A_other > A_self:
        k, rem = 'CONTESTED_NAME', 'QUARANTINE'             # the collision class
    elif A_self > A_other:                                  # content corroborates the name
        if reg is None:                    k, rem = 'AGREE', 'none'
        elif reg_vs_name:                  k, rem = 'AGREE', 'none'
        else:                              k, rem = 'REGISTRY_OUTVOTED', 'DETACH'
    else:                                                   # content contradicts the name
        if reg is None:                    k, rem = 'TWO_SIGNAL_NAME_VS_ART', 'PROPOSE_RENAME'
        elif reg_vs_other:                 k, rem = 'NAME_OUTVOTED', 'RENAME'
        elif reg_vs_name:                  k, rem = 'CONTENT_DISAGREES', 'RETAG_REVIEW'
        else:                              k, rem = 'THREE_WAY_SPLIT', 'DETACH_THEN_QUARANTINE'

    def _resolve(x):
        if not x: return x
        t = x.strip().upper()
        return TKR2NAME[t] if (1 <= len(t) <= 5 and t.isalpha() and t in TKR2NAME) else x
    tgt = _resolve(top_other) or reg
    OUT.append(dict(id=r['id'], name=name, ticker=tkr, cik=cik,
                    mentions=r['mention_count'] or 0, klass=k, remedy=rem,
                    k1=normalize_lookup_key(name), k2=normalize_company_key(name),
                    reg=reg, s_reg=s_reg, s_tkr=s_tkr, A_self=A_self, A_other=A_other,
                    art_total=total, top_other=top_other,
                    self_modes=self_modes[:3], other_modes=other_modes[:3],
                    frag=frag(name, tgt) if tgt else 'NA', rename_to=_resolve(top_other) or reg,
                    n_alias=len(ALIASES.get(r['id'], [])),
                    nsig=sum([1, bool(reg), bool(art_present)])))

json.dump(OUT, open(SP + 'verdicts.json', 'w'))
tot = len(OUT); c = collections.Counter(v['klass'] for v in OUT)
print('=== CROSS-SIGNAL CHECK v2, all 5,610 companies rows ===')
for k, n in c.most_common(): print(f'  {k:30} {n:6}  {100*n/tot:5.1f}%')
print(f'  {"TOTAL":30} {tot:6}')
flagged = sum(n for k, n in c.items() if k not in ('AGREE', 'UNDECIDABLE_SINGLE_SIGNAL'))
print(f'\n  in agreement                 {c["AGREE"]:6}')
print(f'  in disagreement (flagged)    {flagged:6}')
print(f'  undecidable (1 signal)       {c["UNDECIDABLE_SINGLE_SIGNAL"]:6}')
print('\nsignal count:', dict(sorted(collections.Counter(v['nsig'] for v in OUT).items())))
print('\nfragment relation on flagged rows:',
      dict(collections.Counter(v['frag'] for v in OUT
           if v['klass'] not in ('AGREE', 'UNDECIDABLE_SINGLE_SIGNAL')).most_common()))

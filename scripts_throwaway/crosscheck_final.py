"""THROWAWAY. Cross-signal agreement check, final form.
ONE check: build each row's identity claims, partition them by agreement.
Agreement -> nothing. Disagreement -> the pattern of which claims coalesce
names the remedy. Read-only. Writes nothing to prod."""
import sys, json, collections
sys.path.insert(0, '/Users/noahhanning/td2-crosssignal/scripts_throwaway')
from relation import relate, verdict, flat, toks, normalize_lookup_key, normalize_company_key

SP = '/private/tmp/claude-501/-Users-noahhanning-breakingalpha/81e5083c-088c-4660-8410-2dc25d57bc3d/scratchpad/'
comp = json.load(open(SP + 'companies.json'))
ct   = json.load(open(SP + 'cik_tickers.json'))
al   = json.load(open(SP + 'aliases.json'))
MIN_SUPPORT = 3

CIK2NAME, TKR2NAME = {}, {}
for r in ct:
    CIK2NAME.setdefault(str(r['cik']), r['company_name'])
    TKR2NAME.setdefault((r['ticker'] or '').upper(), r['company_name'])

ALIASES = collections.defaultdict(set)
for a in al:
    if a.get('surface_form'): ALIASES[a['canonical_id']].add(a['surface_form'].strip().lower())

import re
BARE_TICKER = re.compile(r'^[A-Z]{1,5}(\.[A-Z])?$')

# PROVENANCE GUARD. ingest.py `_resolve_primary_to_canonical` surface 4 is
# companies.ticker: an article whose primary_company is a BARE TICKER is folded
# onto the canonical name of whatever row holds that ticker, and that name is
# written into articles.companies[]. So a bare-ticker tag is the row's own
# ticker stamp restated, not independent evidence. Verified in prod: of 10
# articles tagging 'Ola', 8 carry pc='KO' and ZERO titles contain "coca".
# Only NAME-bearing primary_company values are admitted as identity evidence.
ART = collections.defaultdict(collections.Counter)      # qualifying only
ART_ALL = collections.defaultdict(collections.Counter)  # everything, for the audit
PC = collections.Counter()
for line in open(SP + 'articles.jsonl'):
    a = json.loads(line); pc = (a.get('primary_company') or '').strip()
    if not pc: continue
    qualifies = not BARE_TICKER.match(pc)
    if qualifies: PC[pc] += 1
    for nm in (a.get('companies') or []):
        if not nm: continue
        k = nm.strip().lower()
        ART_ALL[k][pc] += 1
        if qualifies: ART[k][pc] += 1

# corpus ambiguity index: pc strings by leading significant token
PC_BY_TOK = collections.defaultdict(list)
for p, n in PC.items():
    t = toks(p)
    if t and n >= 2: PC_BY_TOK[t[0]].append((p, n))

def _tf(s):
    t = (s or '').strip().upper()
    return TKR2NAME.get(t) if (1 <= len(t) <= 5 and t.isalpha()) else None

STRONG = {'EQ', 'ABBR', 'TPREFIX'}

def agree_strong(a, b):
    """EQ / ABBR / TPREFIX only. NEAR agrees on a shared generic leading token
    ('Applied Materials' vs 'Applied Optoelectronics') and must not be used
    where the whole question is whether one surface form denotes two companies."""
    return bool(a) and bool(b) and relate(a, b)[0] in STRONG

def agree(a, b, resolve_b=False, strict=False):
    """Same company? resolve_b expands a bare symbol through cik_tickers and is
    permitted ONLY on the article side: expanding companies.name or the registry
    claim re-imports the registry's opinion and re-creates the tautology.
    strict=True refuses CPREFIX (character-prefix-only), which is the ambiguous
    short-form relation."""
    if not a or not b: return None
    fb = {b} | ({_tf(b)} if resolve_b else set())
    for y in filter(None, fb):
        v = verdict(a, y)[0]
        if v == 'AGREE' or (v == 'AGREE_WEAK' and not strict): return True
    return False

def frag(a, b):
    fa, fb = flat(a or ''), flat(b or '')
    if len(fa) < 3 or len(fb) < 3 or fa == fb: return 'NA'
    if fa not in fb: return 'NOT_SUBSTR'
    i = fb.find(fa)
    return 'PREFIX' if i == 0 else ('SUFFIX' if i + len(fa) == len(fb) else 'INTERIOR')

def ambiguous(name):
    """Does the CORPUS use this name for two companies that are not each other?
    Widens the article signal from 'articles tagging this row' to 'primary_company
    strings this name could denote'. Still one check: signals disagreeing."""
    t = toks(name)
    if not t: return None
    cands = [(p, n) for p, n in PC_BY_TOK.get(t[0], []) if agree_strong(name, p)]
    for i in range(len(cands)):
        for j in range(i + 1, len(cands)):
            if not agree(cands[i][0], cands[j][0], resolve_b=True):
                return (cands[i], cands[j])
    return None

OUT = []
for r in comp:
    name = r['name'] or ''
    cik = str(r['sec_cik']) if r['sec_cik'] else None
    tkr = (r['ticker'] or '').upper() or None
    s_reg, s_tkr = (CIK2NAME.get(cik) if cik else None), (TKR2NAME.get(tkr) if tkr else None)
    reg = s_reg or s_tkr
    # article evidence: the row's own name PLUS every alias surface form pointing at it
    surfaces = {name.strip().lower()} | ALIASES.get(r['id'], set())
    modes, modes_all = collections.Counter(), collections.Counter()
    for s in surfaces:
        modes.update(ART.get(s, {})); modes_all.update(ART_ALL.get(s, {}))
    n_circular = sum(modes_all.values()) - sum(modes.values())
    self_m, other_m = [], []
    for m, n in modes.most_common():
        (self_m if agree(name, m, resolve_b=True) else other_m).append((m, n))
    A_self, A_other = sum(n for _, n in self_m), sum(n for _, n in other_m)
    top_other = other_m[0][0] if other_m else None
    top_other_n = other_m[0][1] if other_m else 0
    conc = (top_other_n / A_other) if A_other else 0.0
    art = (A_self >= MIN_SUPPORT) or (A_other >= MIN_SUPPORT)
    # A row whose NAME IS ITS OWN TICKER carries no independent identity claim:
    # the name restates the ticker signal. 'AAOI'[AAOI], 'HWM'[HWM], 'DVN'[DVN]
    # can never string-agree with 'APPLIED OPTOELECTRONICS' / 'Howmet Aerospace'
    # / 'DEVON ENERGY' and are all correct. Marking the name ABSENT rather than
    # DISAGREEING is the user's own principle: fewer signals, fewer ways to
    # disagree. Measured: this alone removed 15 of 19 false positives in
    # REGISTRY_OUTVOTED.
    name_is_ticker = bool(tkr and flat(name) == flat(tkr))
    rvn = (True if name_is_ticker else agree(name, reg)) if reg else None
    rvo = agree(reg, top_other, resolve_b=True) if (reg and top_other) else None
    amb = ambiguous(name)

    if reg is None and not art:               k, rem = 'UNDECIDABLE_SINGLE_SIGNAL', 'none'
    elif not art:
        k, rem = ('AGREE', 'none') if rvn else ('TWO_SIGNAL_NAME_VS_REG', 'PROPOSE_DETACH')
    elif A_self >= MIN_SUPPORT and A_other >= MIN_SUPPORT and A_other > A_self:
        # The registry must CORROBORATE the accusation. A row whose own registry
        # stamp still backs its name is a secondary actor being out-shouted by
        # the companies it invests in or advises ('Goldman Sachs' 198 self vs 404
        # other), not a misidentified row. Only when the registry sides with the
        # DISSENT is the name genuinely contested ('AXT Inc.' -> BAX, 'LIC' -> RSG).
        if reg is None:      k, rem = 'CONTESTED_NAME_UNCORROBORATED', 'INFORMATIONAL'
        elif rvn:            k, rem = 'CONTESTED_NAME_UNCORROBORATED', 'INFORMATIONAL'
        else:                k, rem = 'CONTESTED_NAME', 'QUARANTINE'
    elif A_self > A_other:
        if reg is None or rvn:
            k, rem = 'AGREE', 'none'
        else:
            # TINNER (a single significant token contained but not at the head)
            # is the irreducibly ambiguous relation: 'Disney' in 'Walt Disney
            # Co' is the same company, 'Vanguard' in 'American Vanguard Corp'
            # is not. Nothing in the data separates them, so it is flagged but
            # never auto-applied.
            rel = relate(name, reg)[0]
            # A CORPORATE ACTION, not a cross-wire: when the registry's name for
            # this CIK also shows up as a primary_company on the row's OWN
            # articles, the corpus is connecting the two names, which is what an
            # acquisition or a registrant rename looks like from inside the data.
            # 'TopBuild Corp.'[BLD] -> 'QXO Insulation, LLC' with 'QXO' on 48 of
            # its own articles is a merger, not a bad stamp. Detaching it would
            # be wrong.
            echoed = any(n >= MIN_SUPPORT and agree(reg, m, resolve_b=True)
                         for m, n in other_m)
            if rel == 'TINNER':  rem2 = 'QUARANTINE_AMBIGUOUS_TOKEN'
            elif echoed:         rem2 = 'QUARANTINE_CORPORATE_ACTION'
            else:                rem2 = 'DETACH'
            k, rem = 'REGISTRY_OUTVOTED', rem2
    else:
        if reg is None:
            # Without a registry corroborator the article signal alone cannot
            # tell a MISIDENTIFIED row from a SECONDARY ACTOR. articles.companies
            # names investors, advisors and banks by design (ingest.py:934 tells
            # the model primary_company is the main actor, not the investor), so
            # 'Advent International' having 34 articles about other companies is
            # correct behaviour. Concentration of the dissent is the only
            # available discriminator: one specific other company vs many.
            k = 'ARTICLE_ONLY_CONCENTRATED' if (conc >= 0.80 and A_other >= 5) \
                else 'ARTICLE_ONLY_DIFFUSE'
            rem = 'PROPOSE_RENAME' if k == 'ARTICLE_ONLY_CONCENTRATED' else 'INFORMATIONAL' 
        elif rvo:         k, rem = 'NAME_OUTVOTED', 'RENAME'   # qualifying articles corroborate the registry
        elif rvn:         k, rem = 'CONTENT_DISAGREES', 'RETAG_REVIEW'
        else:             k, rem = 'THREE_WAY_SPLIT', 'DETACH_THEN_QUARANTINE'
    if k == 'AGREE' and amb:
        # A short brand name that denotes two listed entities. When the name is
        # a strict TRUNCATION of the identity both independent axes corroborate
        # ('Fidelity' vs registrant AND 130 name-bearing articles saying
        # 'Fidelity National Information Services'), the evidence supports
        # renaming to the full form; but doing so strips the corpus of the only
        # row that could carry the OTHER company, so it is proposed, never applied.
        rel = relate(name, reg)[0] if reg else 'NA'
        if rel in ('TPREFIX', 'CPREFIX') and A_self >= MIN_SUPPORT:
            k, rem = 'AMBIGUOUS_NAME', 'PROPOSE_RENAME_CONTESTED'
        else:
            k, rem = 'AMBIGUOUS_NAME', 'QUARANTINE'
    tgt = (_tf(top_other) or top_other) if top_other else reg
    OUT.append(dict(id=r['id'], name=name, ticker=tkr, cik=cik, mentions=r['mention_count'] or 0,
                    klass=k, remedy=rem, k1=normalize_lookup_key(name), k2=normalize_company_key(name),
                    reg=reg, s_reg=s_reg, s_tkr=s_tkr, A_self=A_self, A_other=A_other,
                    top_other=top_other, top_other_n=top_other_n, conc=round(conc,2), self_modes=self_m[:3], other_modes=other_m[:3],
                    frag=frag(name, tgt) if tgt else 'NA', rename_to=tgt,
                    amb=[list(amb[0]), list(amb[1])] if amb else None,
                    name_is_ticker=name_is_ticker, n_circular=n_circular,
                    art_all=sum(modes_all.values()),
                    nsig=(0 if name_is_ticker else 1) + bool(reg) + bool(art)))

# ---------- CROSS-ROW: the same check, applied across rows sharing an axis ----
BY = {ax: collections.defaultdict(list) for ax in ('k2', 'k1', 'ticker', 'cik')}
for v in OUT:
    for ax in BY:
        if v.get(ax): BY[ax][v[ax]].append(v)

def art_claim(v):
    """The identity the row's own articles point at, majority first."""
    if v['self_modes']: return v['self_modes'][0][0]
    if v['other_modes']: return v['other_modes'][0][0]
    return None

# Rows that share ONE signal must agree on the OTHERS. The grouping axis is the
# signal they share, so it is excluded from the comparison: comparing names
# inside a name-key bucket is a tautology (that is why they are in the bucket),
# and comparing registry claims inside a ticker group is the same tautology
# (Gett holds Rigetti's CIK, so both resolve to 'Rigetti Computing').
COMPARE = {'k1': ('reg', 'art'), 'k2': ('reg', 'art'),
           'ticker': ('name', 'art'), 'cik': ('name', 'art')}

def claim(v, which):
    return {'name': v['name'], 'reg': v['reg'], 'art': art_claim(v)}[which]

GROUPS = []
for ax, buckets in BY.items():
    for key, rows in buckets.items():
        if len(rows) < 2: continue
        disagree = []
        for i in range(len(rows)):
            for j in range(i + 1, len(rows)):
                a, b = rows[i], rows[j]
                for w in COMPARE[ax]:
                    ca, cb = claim(a, w), claim(b, w)
                    if ca and cb and not agree(ca, cb, resolve_b=True) \
                       and not agree(cb, ca, resolve_b=True):
                        disagree.append((w, a['name'], ca, b['name'], cb))
        carriers = [x for x in rows if x['ticker'] or x['cik']]
        GROUPS.append(dict(axis=ax, key=str(key), n=len(rows),
                           names=[x['name'] for x in rows][:6],
                           carriers=len(carriers), disagree=disagree[:3],
                           klass='CONTESTED_GROUP' if disagree else 'DUPLICATE_SPLIT',
                           remedy='QUARANTINE' if disagree else
                                  ('MERGE' if len(carriers) == 1 else
                                   ('MERGE_ELECT' if len(carriers) == 0 else 'MERGE_MULTI_CARRIER')),
                           mentions=sum(x['mentions'] for x in rows)))

json.dump(OUT, open(SP + 'verdicts.json', 'w'))
json.dump(GROUPS, open(SP + 'groups.json', 'w'))

tot = len(OUT); c = collections.Counter(v['klass'] for v in OUT)
print('=== PER-ROW, all 5,610 companies rows ===')
for k, n in c.most_common(): print(f'  {k:30} {n:6}  {100*n/tot:5.1f}%')
flagged = tot - c['AGREE'] - c['UNDECIDABLE_SINGLE_SIGNAL']
print(f'  {"-"*30}\n  agreement {c["AGREE"]}   disagreement {flagged}   undecidable {c["UNDECIDABLE_SINGLE_SIGNAL"]}')
print('\n=== CROSS-ROW groups (>1 row on a shared axis) ===')
for ax in ('k1', 'k2', 'ticker', 'cik'):
    g = [x for x in GROUPS if x['axis'] == ax]
    d = [x for x in g if x['klass'] == 'CONTESTED_GROUP']
    print(f'  axis {ax:7} groups {len(g):5}  rows {sum(x["n"] for x in g):5}  '
          f'CONTESTED {len(d):4}  DUPLICATE {len(g)-len(d):5}')

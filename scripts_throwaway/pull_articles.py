"""THROWAWAY. Read-only KEYSET-paginated pull of article tag evidence.
OFFSET pagination 500s past ~110k rows on this table; keyset does not."""
import sys, json, time
sys.path.insert(0, '/Users/noahhanning/td2-crosssignal/scripts_throwaway')
import _conn
OUT = '/private/tmp/claude-501/-Users-noahhanning-breakingalpha/81e5083c-088c-4660-8410-2dc25d57bc3d/scratchpad/articles.jsonl'
t0 = time.time(); last = None; n = 0
with open(OUT, 'w') as f:
    while True:
        p = {'select': 'id,primary_company,companies', 'order': 'id.asc', 'limit': 1000}
        if last is not None:
            p['id'] = f'gt.{last}'
        for attempt in range(4):
            try:
                rows, _hdr = _conn.get('articles', p, timeout=180); break
            except Exception as e:
                if attempt == 3: raise
                print(f'  retry {attempt} after {e}', flush=True); time.sleep(3)
        if not rows: break
        for r in rows:
            f.write(json.dumps(r) + "\n")
        n += len(rows); last = rows[-1]['id']
        if n % 25000 == 0: print(f'  {n} rows {time.time()-t0:.0f}s', flush=True)
        if len(rows) < 1000: break
print(f'DONE {n} rows, {_conn.REQ_COUNT[0]} requests, {time.time()-t0:.0f}s')

import os, json, urllib.parse, urllib.request, time, sys
_env = {}
for line in open(os.path.join(os.path.dirname(__file__), "..", ".env.local")):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line: continue
    k, v = line.split("=", 1)
    _env[k.strip()] = v.strip().strip('"').strip("'")
URL = _env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
KEY = _env["SUPABASE_SERVICE_ROLE_KEY"]
REQ_COUNT = [0]

def get(path, params=None, headers=None, timeout=120):
    """SELECT-only PostgREST GET. Never any other verb."""
    q = urllib.parse.urlencode(params or {}, safe='*,.():"{}')
    u = f"{URL}/rest/v1/{path}" + (f"?{q}" if q else "")
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Accept": "application/json"}
    h.update(headers or {})
    req = urllib.request.Request(u, headers=h, method="GET")
    REQ_COUNT[0] += 1
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode()), r.headers.get("Content-Range")

def paginate(path, select, page=1000, order="id", extra=None, timeout=180):
    out, off = [], 0
    while True:
        p = {"select": select, "order": order, "limit": page, "offset": off}
        if extra: p.update(extra)
        rows, _ = get(path, p, timeout=timeout)
        out.extend(rows)
        if len(rows) < page: break
        off += page
    return out

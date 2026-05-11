// Yahoo Finance crumb-auth helper for v10 quoteSummary.
//
// Lucas-protected: does NOT modify watchlist-utils.ts, WatchlistAddInput.tsx,
// trends/page.tsx, briefing/route.ts, or MemoModal.tsx.
//
// Two-step flow: (1) GET fc.yahoo.com to harvest Set-Cookie; (2) GET
// query2.../v1/test/getcrumb with that cookie. v10 calls then send both
// Cookie: <cookie> and ?crumb=<crumb>. Pair is cached module-level for
// 30min. On 401/403 the caller should invalidateCrumb() and retry once.

const UA = "Mozilla/5.0 (compatible; Signalera/1.0)";
const TTL_MS = 30 * 60 * 1000; // 30 minutes
const FETCH_TIMEOUT_MS = 5000;

type CachedCrumb = { cookie: string; crumb: string; expiresAt: number };

let cachedCrumb: CachedCrumb | null = null;

export interface CrumbPair {
  cookie: string;
  crumb: string;
}

export async function getCrumb(): Promise<CrumbPair> {
  if (cachedCrumb && cachedCrumb.expiresAt > Date.now()) {
    return { cookie: cachedCrumb.cookie, crumb: cachedCrumb.crumb };
  }

  const cookieResp = await fetch("https://fc.yahoo.com", {
    redirect: "follow",
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const setCookie = cookieResp.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("crumb-auth: no Set-Cookie from fc.yahoo.com");
  }

  const crumbResp = await fetch(
    "https://query2.finance.yahoo.com/v1/test/getcrumb",
    {
      headers: { Cookie: setCookie, "User-Agent": UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );
  if (!crumbResp.ok) {
    throw new Error(`crumb-auth: getcrumb returned ${crumbResp.status}`);
  }
  const crumb = (await crumbResp.text()).trim();
  if (!crumb || crumb.length < 4) {
    throw new Error("crumb-auth: empty or too-short crumb");
  }

  cachedCrumb = {
    cookie: setCookie,
    crumb,
    expiresAt: Date.now() + TTL_MS,
  };
  return { cookie: setCookie, crumb };
}

export function invalidateCrumb(): void {
  cachedCrumb = null;
}

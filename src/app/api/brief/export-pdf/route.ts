/**
 * POST /api/brief/export-pdf
 *
 * Body: { briefing_id?: string; briefing_type?: "morning" | "evening" }
 *
 * Puppeteer-driven PDF export. The route:
 *   1. Authenticates the incoming Next.js request (cookie-based).
 *   2. Forwards the user's Supabase auth cookies into the Puppeteer
 *      browser context via `page.setCookie()` so the headless render
 *      sees the user's session — same auth the live web view uses.
 *   3. Drives Chromium against `/print/[briefing_id]`, which forwards
 *      those same cookies to `/api/briefing`, reproducing the exact
 *      personalized payload the web UI renders (PR #103 watchlist
 *      baking, Lucas's section/sector_breakdown reshaping, V4B
 *      per-user addendum when present).
 *   4. Validates the render before returning. If the page redirected
 *      to /auth, or the title contains "Sign In" / "404" / "Error",
 *      or the expected DOM marker is missing, we return HTTP 500 with
 *      a descriptive body. We never return HTTP 200 with a PDF of an
 *      error or sign-in page — that silent-success-on-broken-auth was
 *      the failure mode that prompted this rewrite.
 *
 * Why Puppeteer: react-pdf can't render the gold→espresso masthead
 * gradient, CSS grid lead cards, the mood bar, or the Morning Review
 * reflection block without a parallel rewrite that drifts from the
 * web UI. Chromium-driven HTML → PDF gives free fidelity. See spec §3.
 *
 * Size note: puppeteer-core + @sparticuz/chromium-min adds ~46–52 MB
 * zipped. Vercel Pro (50 MB) is the target. `next.config` externalises
 * @sparticuz/chromium so its Brotli-packed binary ships alongside the
 * function rather than being inlined into the bundle.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { ptDateSlug } from "@/lib/format-pt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Pro per-function ceiling is 60s. Cold start + render lands
// ~8–16s; 60s gives generous headroom.
export const maxDuration = 60;

type BriefingRow = {
  id: string;
  briefing_type: string | null;
  created_at: string | null;
};

function deriveOrigin(request: NextRequest): string {
  // Prefer the forwarded origin so Puppeteer targets the same deploy
  // this request came from (preview branches, custom domains, etc).
  const proto =
    request.headers.get("x-forwarded-proto") ||
    (request.nextUrl.protocol || "https:").replace(":", "");
  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    request.nextUrl.host;
  if (host) return `${proto}://${host}`;
  return process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
}

async function launchBrowser() {
  // Prod: @sparticuz/chromium-min ships a Linux Chromium binary that
  // Vercel's Lambda base image can exec. Dev on macOS: chromium-min is
  // Linux-only, so fall back to system Chrome.
  const isLocal =
    process.env.NODE_ENV === "development" || process.platform === "darwin";

  const puppeteer = (await import("puppeteer-core")).default;

  if (isLocal) {
    const candidatePaths = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ].filter(Boolean) as string[];
    return puppeteer.launch({
      executablePath: candidatePaths[0],
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }

  // chromium-min (vs full @sparticuz/chromium) keeps the function under
  // Vercel's 50 MB-zipped limit by pulling the 61 MB Brotli pack from a
  // CDN at cold start. PUPPETEER_CHROMIUM_PACK_URL overrides the URL
  // (recommended for cold-start perf — GitHub releases can be slow).
  const chromiumMod = await import("@sparticuz/chromium-min");
  const chromium = chromiumMod.default ?? chromiumMod;
  const packUrl =
    process.env.PUPPETEER_CHROMIUM_PACK_URL ||
    "https://github.com/Sparticuz/chromium/releases/download/v147.0.2/chromium-v147.0.2-pack.x64.tar";

  return puppeteer.launch({
    args: [
      ...chromium.args,
      "--hide-scrollbars",
      "--disable-web-security",
    ],
    executablePath: await chromium.executablePath(packUrl),
    headless: true,
    defaultViewport: { width: 1000, height: 1294 },
  });
}

function headerTemplate(label: string, dateStr: string): string {
  // Tiny repeating strip on pages 2+. Page 1 is skipped via the
  // `@page :first` rule in /print/print.css which reduces the first-page
  // top margin. The full masthead renders inside the document body so
  // this repeating header is intentionally minimal. Heritage Gold
  // updated to #c9922a (newsletter rebuild Q8).
  return `
    <style>
      .ph { font-family: Helvetica, Arial, sans-serif; font-size: 8px; color: #6b5d4a; width: 100%; padding: 4px 32px 0; display: flex; justify-content: space-between; border-bottom: 1px solid #c9922a; }
      .ph .g { color: #c9922a; font-weight: 700; letter-spacing: 0.14em; }
    </style>
    <div class="ph">
      <span><span class="g">SIGNALERA</span> · ${label}</span>
      <span>${dateStr}</span>
    </div>
  `;
}

function footerTemplate(label: string): string {
  // Q6: the AI disclaimer must appear on every page, small and gray.
  // Two-row footer: top row = disclaimer (centered), bottom row =
  // brand · page count (split). The top row is the new addition.
  return `
    <div style="font-family: Helvetica, Arial, sans-serif; font-size: 7.5px; color: #888888; width: 100%; padding: 0 32px 4px; line-height: 1.4;">
      <div style="text-align: center; margin-bottom: 2px;">AI-generated. Not investment advice. Verify before acting.</div>
      <div style="display: flex; justify-content: space-between; color: #6b5d4a;">
        <span>Signalera · ${label}</span>
        <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>
    </div>
  `;
}

/**
 * Forward the user's Supabase auth cookies into the Puppeteer browser
 * context. We carry every `sb-*` cookie verbatim (chunked auth tokens
 * arrive as `sb-<ref>-auth-token.0`, `.1`, etc — forwarding all of them
 * keeps the chunked-payload reassembly intact). The URL-anchored form
 * lets Puppeteer derive `domain` / `secure` from the print URL, which
 * matches the cookie scope set by `@supabase/ssr` for both localhost
 * and `*.vercel.app`.
 */
type ForwardableCookie = { name: string; value: string };
function extractAuthCookies(request: NextRequest): ForwardableCookie[] {
  return request.cookies
    .getAll()
    .filter((c) => c.name.startsWith("sb-"))
    .map((c) => ({ name: c.name, value: c.value }));
}

function isBadTitle(title: string): boolean {
  if (!title) return true;
  const t = title.toLowerCase();
  return (
    t.includes("sign in") ||
    t.includes("404") ||
    t.includes("not found") ||
    t.includes("error")
  );
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { briefing_id?: string; briefing_type?: "morning" | "evening" } = {};
  try {
    body = (await request.json()) ?? {};
  } catch {
    body = {};
  }

  const explicitId = typeof body.briefing_id === "string" ? body.briefing_id : null;
  const type: "morning" | "evening" =
    body.briefing_type === "evening" ? "evening" : "morning";

  // Resolve briefing row (explicit id → latest of type fallback).
  const base = supabase.from("briefings").select("id, briefing_type, created_at");
  const { data, error } = explicitId
    ? await base.eq("id", explicitId).limit(1)
    : await base
        .eq("briefing_type", type)
        .neq("headline", "Market Intelligence Unavailable")
        .order("created_at", { ascending: false })
        .limit(1);

  if (error) {
    console.error("[export-pdf] supabase error:", error.message);
    return NextResponse.json(
      { error: "Failed to fetch briefing" },
      { status: 500 },
    );
  }
  const row = data?.[0] as BriefingRow | undefined;
  if (!row) {
    return NextResponse.json({ error: "Briefing not found" }, { status: 404 });
  }

  const origin = deriveOrigin(request);

  const kindLabel =
    row.briefing_type === "evening" ? "Evening Wrap" : "Morning Brief";
  const dateSlug = ptDateSlug(row.created_at);
  const filename = `signalera-${row.briefing_type === "evening" ? "evening-wrap" : "morning-brief"}-${dateSlug}.pdf`;

  const printUrl = new URL(`/print/${row.id}`, origin);
  printUrl.searchParams.set("type", row.briefing_type ?? type);
  printUrl.searchParams.set("origin", origin);

  const authCookies = extractAuthCookies(request);
  if (authCookies.length === 0) {
    // Cookies should always be present here — getSupabaseWithUser()
    // succeeded above, which means the request carried a valid session.
    // Failing closed protects against any future code path that calls
    // this without a real user request.
    console.error("[export-pdf] authenticated user has no sb-* cookies to forward");
    return NextResponse.json(
      { error: "Auth cookie forwarding failed — cannot personalize PDF" },
      { status: 500 },
    );
  }

  let buffer: Buffer;
  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null;
  let renderError: { status: number; reason: string } | null = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.emulateMediaType("print");
    await page.setViewport({ width: 1000, height: 1294, deviceScaleFactor: 1 });

    // Forward auth cookies BEFORE navigation so the print page sees
    // the user's session on first request.
    await page.setCookie(
      ...authCookies.map((c) => ({
        name: c.name,
        value: c.value,
        url: origin,
      })),
    );

    // On Vercel preview deployments, Deployment Protection (SSO) blocks
    // Puppeteer's same-origin fetch to /print/[id] before our auth check
    // ever runs. Vercel auto-injects VERCEL_AUTOMATION_BYPASS_SECRET as a
    // System Env Var when "Protection Bypass for Automation" is enabled
    // in project settings. Sending it as x-vercel-protection-bypass lets
    // the headless render through; x-vercel-set-bypass-cookie: "true"
    // persists the bypass on the same browser context so subsequent
    // navigations (assets, /api/briefing fetch) don't re-trigger SSO.
    if (process.env.VERCEL_ENV === "preview") {
      const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
      if (bypassSecret) {
        await page.setExtraHTTPHeaders({
          "x-vercel-protection-bypass": bypassSecret,
          "x-vercel-set-bypass-cookie": "true",
        });
      } else {
        console.warn(
          "[export-pdf] VERCEL_AUTOMATION_BYPASS_SECRET missing on preview deployment. This is unexpected — Vercel should auto-inject it as a System Env Var when Protection Bypass for Automation is enabled. SSO will block Puppeteer.",
        );
      }
    }

    // Wait for DOM + network quiet. 20s ceiling covers slow VIX /
    // Supabase latency without ever hanging a 60s function.
    const response = await page.goto(printUrl.toString(), {
      waitUntil: "networkidle0",
      timeout: 20000,
    });

    // ── Real validation: never silently return a PDF of the wrong page ──
    const finalUrl = page.url();
    if (finalUrl.includes("/auth")) {
      renderError = {
        status: 500,
        reason: `Puppeteer redirected to ${finalUrl} — cookie forwarding likely failed`,
      };
    } else if (response && !response.ok()) {
      renderError = {
        status: 500,
        reason: `Print page returned HTTP ${response.status()}`,
      };
    } else {
      const title = await page.title();
      if (isBadTitle(title)) {
        renderError = {
          status: 500,
          reason: `Rendered page title looks like an error/auth page: "${title}"`,
        };
      } else {
        const briefRoot = await page.$("[data-print-brief-root]");
        if (!briefRoot) {
          renderError = {
            status: 500,
            reason:
              "Rendered page is missing the [data-print-brief-root] marker — brief content did not render",
          };
        }
      }
    }

    if (renderError) {
      // Log enough to debug from server logs without leaking session info.
      console.error(
        `[export-pdf] render validation failed: ${renderError.reason} (url=${finalUrl})`,
      );
    }

    // Block until webfonts actually render — otherwise the first few
    // pages ship with Helvetica fallback glyphs.
    if (!renderError) {
      await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());
    }

    if (!renderError) {
      const pdf = await page.pdf({
        format: "Letter",
        printBackground: true,
        preferCSSPageSize: true,
        margin: {
          top: "0.6in",
          right: "0.55in",
          bottom: "0.55in",
          left: "0.55in",
        },
        displayHeaderFooter: true,
        headerTemplate: headerTemplate(kindLabel, dateSlug),
        footerTemplate: footerTemplate(kindLabel),
      });
      buffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
    } else {
      buffer = Buffer.from([]); // unused, but TS needs the assignment
    }
  } catch (e) {
    console.error("[export-pdf] render error:", e);
    return NextResponse.json(
      { error: "Failed to render PDF" },
      { status: 500 },
    );
  } finally {
    try {
      await browser?.close();
    } catch {
      /* ignore close errors */
    }
  }

  if (renderError) {
    return NextResponse.json(
      { error: renderError.reason },
      { status: renderError.status },
    );
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, no-cache",
    },
  });
}

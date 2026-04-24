/**
 * POST /api/brief/export-pdf
 *
 * Body: { briefing_id?: string; briefing_type?: "morning" | "evening" }
 *
 * Puppeteer-driven PDF export (spec Section 4). Previously this route
 * rendered `<BriefPdf />` via `@react-pdf/renderer`; it now drives a
 * headless Chromium against the internal `/print/[briefing_id]` route
 * so the PDF matches the live web UI 1:1.
 *
 * Why Puppeteer: react-pdf can't render the gold→espresso masthead
 * gradient, CSS grid lead cards, the mood bar, or the Morning Review
 * reflection block without a parallel rewrite that drifts from the web
 * UI. Chromium-driven HTML → PDF gives free fidelity. See spec §3.
 *
 * Size note: puppeteer-core + @sparticuz/chromium adds ~46–52 MB zipped.
 * Vercel Pro (50 MB) is the target. If Hobby, fall back to react-pdf
 * per spec §5. `next.config` externalises @sparticuz/chromium so its
 * Brotli-packed binary ships alongside the function rather than being
 * inlined into the bundle.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { mintPrintToken } from "@/lib/print-token";
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
  // Prod: @sparticuz/chromium ships a Linux Chromium binary that
  // Vercel's Lambda base image can exec. Dev on macOS: @sparticuz
  // Chromium is Linux-only, so fall back to system Chrome.
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

  // We use @sparticuz/chromium-min (not @sparticuz/chromium) because
  // the full package ships a 61 MB Brotli-packed Chromium binary that
  // blows past Vercel's 50 MB-zipped function limit. chromium-min is
  // 84 KB and pulls the binary from a CDN URL at cold-start time.
  //
  // The URL points at the matching chromium pack tarball on GitHub
  // releases. Pin to the same MAJOR version as the installed
  // chromium-min to avoid protocol drift vs puppeteer-core.
  //
  // Override with PUPPETEER_CHROMIUM_PACK_URL if you need to serve
  // the tarball from your own CDN (recommended for cold-start perf:
  // GitHub releases can be slow from Lambda regions).
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
  // this repeating header is intentionally minimal.
  return `
    <style>
      .ph { font-family: Inter, sans-serif; font-size: 8px; color: #6b5d4a; width: 100%; padding: 4px 32px 0; display: flex; justify-content: space-between; border-bottom: 1px solid #d4a84b; }
      .ph .g { color: #d4a84b; font-weight: 700; letter-spacing: 0.1em; }
    </style>
    <div class="ph">
      <span><span class="g">SIGNALERA</span> · ${label}</span>
      <span>${dateStr}</span>
    </div>
  `;
}

function footerTemplate(label: string): string {
  return `
    <div style="font-family: Inter, sans-serif; font-size: 8px; color: #6b5d4a; width: 100%; padding: 0 32px 4px; display: flex; justify-content: space-between;">
      <span>Signalera · ${label}</span>
      <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>
  `;
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
  let token: string;
  try {
    token = mintPrintToken(row.id);
  } catch (e) {
    console.error("[export-pdf] token mint failed:", e);
    return NextResponse.json(
      { error: "PDF service misconfigured" },
      { status: 500 },
    );
  }

  const kindLabel =
    row.briefing_type === "evening" ? "Evening Wrap" : "Morning Brief";
  const dateSlug = ptDateSlug(row.created_at);
  const filename = `signalera-${row.briefing_type === "evening" ? "evening-wrap" : "morning-brief"}-${dateSlug}.pdf`;

  const printUrl = new URL(`/print/${row.id}`, origin);
  printUrl.searchParams.set("t", token);
  printUrl.searchParams.set("type", row.briefing_type ?? type);
  printUrl.searchParams.set("origin", origin);

  let buffer: Buffer;
  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.emulateMediaType("print");
    await page.setViewport({ width: 1000, height: 1294, deviceScaleFactor: 1 });

    // Ask Chromium to wait for DOM + network quiet. 20s ceiling covers
    // slow VIX / Supabase latency without ever hanging a 60s function.
    await page.goto(printUrl.toString(), {
      waitUntil: "networkidle0",
      timeout: 20000,
    });

    // Block until webfonts actually render — otherwise the first few
    // pages ship with Helvetica fallback glyphs.
    await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());

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

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, no-cache",
    },
  });
}

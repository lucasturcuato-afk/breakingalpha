/**
 * POST /api/memo/export-pdf
 *
 * Body: { memo: string; title: string; kicker?: string; filename?: string }
 * Returns: application/pdf as an attachment.
 *
 * Replaces the client-side `new Blob([memo], { type: "text/markdown" })`
 * download that the memo surfaces used to offer. The caller posts the exact
 * memo text it is displaying (which, in the deal memo editor, may include the
 * user's in-browser edits), so the PDF and the screen never diverge.
 *
 * Why the memo string and not a structured row: `/api/memo` returns
 * `completion.text` from Gemini and that string is the stored artifact. There
 * is no upstream document model to render from. This route tokenizes the same
 * string the on-screen ReactMarkdown renderer tokenizes; it never reads a
 * downloaded file back in.
 *
 * Runtime is Node because @react-pdf/renderer needs it. No headless Chromium
 * is involved.
 */

import { createElement } from "react";
import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { MemoPdf } from "@/components/memo/memo-pdf";
import { parseMemoBlocks, sanitizePdfFilename } from "@/lib/memo-blocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Generous ceiling. Real memos land well under 20k characters. */
const MAX_MEMO_CHARS = 200_000;

export async function POST(request: NextRequest) {
  const { user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const memo = typeof body.memo === "string" ? body.memo : "";
  if (!memo.trim()) {
    return NextResponse.json({ error: "memo required" }, { status: 400 });
  }
  if (memo.length > MAX_MEMO_CHARS) {
    return NextResponse.json({ error: "memo too large" }, { status: 413 });
  }

  const title = typeof body.title === "string" && body.title.trim()
    ? body.title.trim().slice(0, 200)
    : "Memo";
  const kicker = typeof body.kicker === "string" ? body.kicker.trim().slice(0, 60) : "";
  const filename = sanitizePdfFilename(
    typeof body.filename === "string" ? body.filename : undefined,
  );

  try {
    const buffer = await renderToBuffer(
      createElement(MemoPdf, { title, kicker, blocks: parseMemoBlocks(memo) }),
    );

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, no-cache",
      },
    });
  } catch (e) {
    console.error("[memo/export-pdf] render error:", e);
    return NextResponse.json({ error: "Failed to render PDF" }, { status: 500 });
  }
}

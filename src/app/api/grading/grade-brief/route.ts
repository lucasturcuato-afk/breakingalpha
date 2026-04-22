import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/grading/grade-brief
 *
 * Auth: `x-internal-key` header must match `process.env.INTERNAL_API_KEY`
 * (mirrors the `/api/grading/trigger` shared-secret pattern).
 *
 * Body (JSON, optional): `{ "backfill": boolean }` — default `false`.
 *
 * Behaviour: dispatches a GitHub `repository_dispatch` event of type
 * `grade-brief`, consumed by `.github/workflows/brief-grading.yml`,
 * which invokes `backend/grading/grade_brief_calls.py`.
 */
export async function POST(req: NextRequest) {
  const internalKey = process.env.INTERNAL_API_KEY;
  const dispatchToken = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO ?? "lucasturcuato-afk/breakingalpha";

  if (!internalKey) {
    return NextResponse.json(
      { error: "INTERNAL_API_KEY not configured" },
      { status: 500 },
    );
  }

  const providedKey = req.headers.get("x-internal-key");
  if (providedKey !== internalKey) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!dispatchToken) {
    return NextResponse.json(
      { error: "GITHUB_DISPATCH_TOKEN not configured" },
      { status: 503 },
    );
  }

  let backfill = false;
  try {
    const body = (await req.json()) as { backfill?: unknown } | null;
    if (body && typeof body.backfill === "boolean") {
      backfill = body.backfill;
    }
  } catch {
    // empty / malformed body → leave backfill=false
  }

  const githubRes = await fetch(
    `https://api.github.com/repos/${repo}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dispatchToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "grade-brief",
        client_payload: { backfill },
      }),
    },
  );

  if (githubRes.status === 204) {
    return NextResponse.json(
      { status: "dispatched", backfill },
      { status: 202 },
    );
  }

  let githubBody = "";
  try {
    githubBody = await githubRes.text();
  } catch {
    githubBody = "";
  }

  return NextResponse.json(
    {
      error: "github dispatch failed",
      github_status: githubRes.status,
      github_body: githubBody.slice(0, 500),
    },
    { status: 502 },
  );
}

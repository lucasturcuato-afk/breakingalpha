import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/grading/trigger
 *
 * Auth: `x-internal-key` header must match `process.env.INTERNAL_API_KEY`
 * (same shared-secret pattern as `/api/theses/backfill-tickers`).
 *
 * Body (JSON, optional): `{ "force": boolean }` — default `false`.
 *
 * Behaviour: dispatches a GitHub `repository_dispatch` event of type
 * `grading-trigger` against `lucasturcuato-afk/breakingalpha`, which is
 * consumed by `.github/workflows/grading.yml`. The workflow then invokes
 * `backend/cron/daily_grading.py` with the matching `--force` flag.
 *
 * Note: this endpoint does NOT touch Supabase, so no client is initialised
 * here. If any DB call is added later, init inside the handler per project
 * convention (see recent fix(build): move supabase client init inside handlers).
 */
export async function POST(request: NextRequest) {
  const internalKey = process.env.INTERNAL_API_KEY;
  const dispatchToken = process.env.GITHUB_DISPATCH_TOKEN;

  if (!internalKey) {
    // Do NOT leak whether the header matched.
    return NextResponse.json(
      { error: "INTERNAL_API_KEY not configured" },
      { status: 500 },
    );
  }

  const providedKey = request.headers.get("x-internal-key");
  if (providedKey !== internalKey) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!dispatchToken) {
    return NextResponse.json(
      {
        error: "GITHUB_DISPATCH_TOKEN not configured",
        setup:
          "Provision a fine-grained PAT with contents: read & write on lucasturcuato-afk/breakingalpha (metadata: read is auto-included); set as GITHUB_DISPATCH_TOKEN env var",
      },
      { status: 503 },
    );
  }

  // Parse body — tolerant of empty / malformed JSON (default to force=false).
  let force = false;
  try {
    const body = (await request.json()) as { force?: unknown } | null;
    if (body && typeof body.force === "boolean") {
      force = body.force;
    }
  } catch {
    // No body or invalid JSON → leave `force` as false.
  }

  const githubRes = await fetch(
    "https://api.github.com/repos/lucasturcuato-afk/breakingalpha/dispatches",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dispatchToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "grading-trigger",
        client_payload: { force },
      }),
    },
  );

  if (githubRes.status === 204) {
    return NextResponse.json(
      { status: "dispatched", force },
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
      error: "dispatch failed",
      github_status: githubRes.status,
      github_body: githubBody.slice(0, 500),
    },
    { status: 502 },
  );
}

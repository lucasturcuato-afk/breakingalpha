/**
 * GET /api/health — internal capped-resource status board. Admin-only.
 *
 * Reads ONLY our own data (Supabase tables + the local Tiingo cache
 * file); never calls an external API to check an external API. Each
 * check returns OK / WARNING / OVER with the actual numbers, or
 * UNKNOWN when the underlying signal is unreadable from this process
 * (stated honestly, never guessed). The top-level summary is the worst
 * status plus one line per flagged item.
 *
 * Checks:
 *  - tiingo: request log + bar cache from .cache/tiingo_prices.json
 *    (written by backend/market_data.py). Unique symbols this month is
 *    a LOWER BOUND (observed cached fetches). If the pipeline runs on
 *    a different machine than this server, the file is absent here and
 *    the check reports UNKNOWN.
 *  - grading: user_claims by status; morning_brief_call_outcomes
 *    ungradable rate last 7d vs prior 7d (a spike usually means the
 *    price source is capped or failing).
 *  - pipeline: latest pipeline_runs row + latest success; stale means
 *    the cron is not firing (runs are ~2x daily).
 *  - content: newest real morning/evening briefings row.
 *  - clusters: radar_clusters / radar_cluster_label rows in outputs —
 *    these writes degrade silently to in-memory if rejected, so zero
 *    rows is flagged as unverifiable rather than assumed fine.
 *
 * Usage:
 *   curl -b <auth cookies> https://<host>/api/health | jq .
 *   curl -b <auth cookies> "https://<host>/api/health?format=text"
 */

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { getServiceSupabase } from "@/lib/supabase-service";
import { isAdmin } from "@/lib/admin-emails";

export const dynamic = "force-dynamic";

type Status = "OK" | "WARNING" | "OVER" | "UNKNOWN";

interface Check {
  status: Status;
  detail: string;
  data: Record<string, unknown>;
}

const TIINGO_CAPS = { symbols_month: 500, requests_day: 1000, requests_hour: 50 };
const WARN_RATIO = 0.8;
/** Pipeline runs ~2x daily; one missed run -> warning, two -> over. */
const PIPELINE_WARN_H = 16;
const PIPELINE_OVER_H = 36;
/** Briefs are daily per type. */
const BRIEF_WARN_H = 28;
const BRIEF_OVER_H = 52;

const STATUS_RANK: Record<Status, number> = { OK: 0, UNKNOWN: 1, WARNING: 2, OVER: 3 };

function worst(statuses: Status[]): Status {
  return statuses.reduce((a, b) => (STATUS_RANK[b] > STATUS_RANK[a] ? b : a), "OK");
}

function capStatus(used: number, cap: number): Status {
  if (used >= cap) return "OVER";
  if (used >= cap * WARN_RATIO) return "WARNING";
  return "OK";
}

function hoursAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 3600_000;
}

function fmtH(h: number | null): string {
  if (h === null) return "never";
  return h < 1 ? `${Math.round(h * 60)}m ago` : `${h.toFixed(1)}h ago`;
}

/* ── Tiingo: local cache file written by backend/market_data.py ── */

async function checkTiingo(): Promise<Check> {
  // Path assembled ONLY from runtime env (no process.cwd()/path.join of
  // literals): anything statically foldable makes Turbopack emit a file
  // reference and scan the project dir, which panics on broken symlinks
  // in the untracked local venv/. PWD is set by every POSIX shell; on
  // platforms without it, set TIINGO_CACHE_PATH explicitly.
  const baseDir = process.env.PWD;
  const cachePath =
    process.env.TIINGO_CACHE_PATH ?? (baseDir ? `${baseDir}/.cache/tiingo_prices.json` : null);
  if (!cachePath) {
    return {
      status: "UNKNOWN",
      detail: "No TIINGO_CACHE_PATH and no PWD; cannot locate the Tiingo cache from this process.",
      data: {},
    };
  }
  let raw: string;
  try {
    // Runtime-only fs import (turbopackIgnore): keeps fs out of the
    // static module graph for the same reason.
    const { promises: fs } = await import(/* turbopackIgnore: true */ "fs");
    raw = await fs.readFile(cachePath, "utf8");
  } catch {
    return {
      status: "UNKNOWN",
      detail:
        "Tiingo cache file not readable from this server (pipeline likely runs elsewhere); usage not verifiable here.",
      data: { cache_path: cachePath },
    };
  }
  try {
    const cache = JSON.parse(raw) as { bars?: Record<string, unknown>; requests?: number[] };
    const nowSec = Date.now() / 1000;
    const requests = (cache.requests ?? []).filter((t) => typeof t === "number");

    const utcMidnight = new Date();
    utcMidnight.setUTCHours(0, 0, 0, 0);
    const midnightSec = utcMidnight.getTime() / 1000;
    const requestsToday = requests.filter((t) => t >= midnightSec).length;
    const requestsHour = requests.filter((t) => t >= nowSec - 3600).length;

    // Lower bound: symbols with a cached bar dated in the current
    // UTC month. Failed/empty fetches are not cached, so the true
    // Tiingo-side count can only be higher.
    const monthPrefix = new Date().toISOString().slice(0, 7);
    const symbolsThisMonth = new Set<string>();
    for (const key of Object.keys(cache.bars ?? {})) {
      const [symbol, date] = key.split(":");
      if (symbol && date?.startsWith(monthPrefix)) symbolsThisMonth.add(symbol);
    }

    const symbolStatus = capStatus(symbolsThisMonth.size, TIINGO_CAPS.symbols_month);
    const dayStatus = capStatus(requestsToday, TIINGO_CAPS.requests_day);
    const hourStatus = capStatus(requestsHour, TIINGO_CAPS.requests_hour);
    const status = worst([symbolStatus, dayStatus, hourStatus]);

    return {
      status,
      detail:
        `symbols ${symbolsThisMonth.size}/${TIINGO_CAPS.symbols_month} this month (observed lower bound), ` +
        `requests ${requestsToday}/${TIINGO_CAPS.requests_day} today (UTC), ` +
        `${requestsHour}/${TIINGO_CAPS.requests_hour} this hour`,
      data: {
        unique_symbols_month_observed: symbolsThisMonth.size,
        cap_symbols_month: TIINGO_CAPS.symbols_month,
        requests_today_utc: requestsToday,
        cap_requests_day: TIINGO_CAPS.requests_day,
        requests_last_hour: requestsHour,
        cap_requests_hour: TIINGO_CAPS.requests_hour,
        request_log_entries: requests.length,
        note: "Symbol count is a lower bound from cached bars; pipeline self-caps at 45/h and 950/day.",
      },
    };
  } catch (e) {
    return {
      status: "UNKNOWN",
      detail: "Tiingo cache file unparseable.",
      data: { error: e instanceof Error ? e.message : String(e) },
    };
  }
}

/* ── Grading: claim statuses + ungradable-rate spike detection ── */

async function checkGrading(sb: SupabaseClient): Promise<Check> {
  try {
    const statuses = ["open", "graded", "ungradable", "archived"] as const;
    const claimCounts: Record<string, number> = {};
    await Promise.all(
      statuses.map(async (s) => {
        const { count, error } = await sb
          .from("user_claims")
          .select("id", { count: "exact", head: true })
          .eq("status", s);
        claimCounts[s] = error ? -1 : (count ?? 0);
      }),
    );

    const since = new Date(Date.now() - 14 * 86400_000).toISOString();
    const { data: outcomeRows, error: outcomeError } = await sb
      .from("morning_brief_call_outcomes")
      .select("verdict, graded_at")
      .gte("graded_at", since)
      .order("graded_at", { ascending: false })
      .limit(500);
    if (outcomeError) throw outcomeError;

    const weekAgo = Date.now() - 7 * 86400_000;
    let recentTotal = 0;
    let recentUngradable = 0;
    let priorTotal = 0;
    let priorUngradable = 0;
    for (const row of outcomeRows ?? []) {
      const t = new Date(row.graded_at as string).getTime();
      const ungradable = row.verdict === "ungradable";
      if (t >= weekAgo) {
        recentTotal += 1;
        if (ungradable) recentUngradable += 1;
      } else {
        priorTotal += 1;
        if (ungradable) priorUngradable += 1;
      }
    }
    const recentRate = recentTotal > 0 ? recentUngradable / recentTotal : 0;
    const priorRate = priorTotal > 0 ? priorUngradable / priorTotal : 0;

    // A spike in ungradable outcomes usually means the price source
    // (Tiingo) is capped or a data source is failing.
    const spiked =
      recentTotal >= 5 &&
      (recentRate >= 0.3 || (priorTotal >= 5 && priorRate > 0 && recentRate >= priorRate * 2));

    return {
      status: spiked ? "WARNING" : "OK",
      detail:
        `claims open ${claimCounts.open} / graded ${claimCounts.graded} / ungradable ${claimCounts.ungradable} / archived ${claimCounts.archived}; ` +
        `brief-call ungradable rate ${(recentRate * 100).toFixed(0)}% last 7d (${recentUngradable}/${recentTotal}) vs ${(priorRate * 100).toFixed(0)}% prior 7d` +
        (spiked ? " — SPIKE, check price source" : ""),
      data: {
        user_claims: claimCounts,
        brief_outcomes_last_7d: { total: recentTotal, ungradable: recentUngradable, rate: recentRate },
        brief_outcomes_prior_7d: { total: priorTotal, ungradable: priorUngradable, rate: priorRate },
        spike: spiked,
      },
    };
  } catch (e) {
    return {
      status: "UNKNOWN",
      detail: "Grading tables not readable.",
      data: { error: e instanceof Error ? e.message : String(e) },
    };
  }
}

/* ── Pipeline freshness ── */

async function checkPipeline(sb: SupabaseClient): Promise<Check> {
  try {
    const [latestRes, successRes] = await Promise.all([
      sb
        .from("pipeline_runs")
        .select("brief_type, status, started_at, completed_at")
        .order("started_at", { ascending: false })
        .limit(1),
      sb
        .from("pipeline_runs")
        .select("brief_type, status, started_at, completed_at")
        .eq("status", "success")
        .order("started_at", { ascending: false })
        .limit(1),
    ]);
    if (latestRes.error) throw latestRes.error;
    const latest = latestRes.data?.[0] ?? null;
    const lastSuccess = successRes.data?.[0] ?? null;

    const successAgeH = hoursAgo(lastSuccess?.completed_at ?? lastSuccess?.started_at);
    const status: Status =
      successAgeH === null || successAgeH > PIPELINE_OVER_H
        ? "OVER"
        : successAgeH > PIPELINE_WARN_H
          ? "WARNING"
          : "OK";

    return {
      status,
      detail:
        `last success ${fmtH(successAgeH)}` +
        (lastSuccess ? ` (${lastSuccess.brief_type})` : "") +
        (latest && latest.status !== "success"
          ? `; most recent run: ${latest.status} (${latest.brief_type}, ${fmtH(hoursAgo(latest.started_at))})`
          : ""),
      data: { latest_run: latest, last_success: lastSuccess, last_success_age_hours: successAgeH },
    };
  } catch (e) {
    return {
      status: "UNKNOWN",
      detail: "pipeline_runs not readable.",
      data: { error: e instanceof Error ? e.message : String(e) },
    };
  }
}

/* ── Content freshness: morning brief + evening wrap ── */

async function checkContent(sb: SupabaseClient): Promise<Check> {
  try {
    const latestOf = async (type: string) => {
      const { data, error } = await sb
        .from("briefings")
        .select("created_at, headline")
        .eq("briefing_type", type)
        .neq("headline", "Market Intelligence Unavailable")
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0]?.created_at ?? null;
    };
    const [morning, evening] = await Promise.all([latestOf("morning"), latestOf("evening")]);
    const morningAge = hoursAgo(morning);
    const eveningAge = hoursAgo(evening);
    const ageStatus = (h: number | null): Status =>
      h === null || h > BRIEF_OVER_H ? "OVER" : h > BRIEF_WARN_H ? "WARNING" : "OK";
    const status = worst([ageStatus(morningAge), ageStatus(eveningAge)]);

    return {
      status,
      detail: `morning brief ${fmtH(morningAge)}, evening wrap ${fmtH(eveningAge)}`,
      data: {
        morning_brief: { created_at: morning, age_hours: morningAge },
        evening_wrap: { created_at: evening, age_hours: eveningAge },
        thresholds_hours: { warning: BRIEF_WARN_H, over: BRIEF_OVER_H },
      },
    };
  } catch (e) {
    return {
      status: "UNKNOWN",
      detail: "briefings not readable.",
      data: { error: e instanceof Error ? e.message : String(e) },
    };
  }
}

/* ── Cluster/label cache: are the outputs writes landing? ── */

async function checkClusters(sb: SupabaseClient): Promise<Check> {
  const countOf = async (type: string) => {
    const { data, count, error } = await sb
      .from("outputs")
      .select("created_at", { count: "exact" })
      .eq("output_type", type)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    return { count: count ?? 0, last: data?.[0]?.created_at ?? null };
  };
  try {
    const [trees, labels] = await Promise.all([
      countOf("radar_clusters"),
      countOf("radar_cluster_label"),
    ]);

    // Zero rows cannot distinguish "feature unused" from "inserts
    // rejected and silently degraded to in-memory". Flag as
    // unverifiable, not as fine.
    const status: Status = trees.count === 0 && labels.count === 0 ? "UNKNOWN" : "OK";
    return {
      status,
      detail:
        status === "OK"
          ? `${trees.count} cluster trees (last ${fmtH(hoursAgo(trees.last))}), ${labels.count} labels (last ${fmtH(hoursAgo(labels.last))})`
          : "0 cluster/label rows in outputs — either unused so far, or inserts are being rejected (check server logs for [outputs] failures).",
      data: {
        radar_clusters: trees,
        radar_cluster_label: labels,
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const code = (e as { code?: string } | null)?.code;
    // Known live failure: output_type is a Postgres ENUM that does not
    // include the radar cluster values, so recordOutput inserts are
    // rejected (22P02) and the cache degrades to in-memory only.
    // Surface the cause, not just "unreadable".
    if (code === "22P02" || message.includes("output_type_enum")) {
      return {
        status: "WARNING",
        detail:
          "output_type_enum does not include radar_clusters/radar_cluster_label — cluster and label cache writes are being REJECTED and degrade to in-memory only. Apply sql/0013_output_type_radar_clusters.sql.",
        data: { error: message, code, fix: "sql/0013_output_type_radar_clusters.sql" },
      };
    }
    return {
      status: "UNKNOWN",
      detail: "outputs not readable.",
      data: { error: message },
    };
  }
}

/* ── Route ── */

export async function GET(req: NextRequest) {
  const { user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!isAdmin(user.email)) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  let service: SupabaseClient;
  try {
    service = getServiceSupabase();
  } catch {
    return NextResponse.json({ error: "Service credentials unavailable" }, { status: 503 });
  }

  const [tiingo, grading, pipeline, content, clusters] = await Promise.all([
    checkTiingo(),
    checkGrading(service),
    checkPipeline(service),
    checkContent(service),
    checkClusters(service),
  ]);

  const checks = { tiingo, grading, pipeline, content, clusters };
  const overall = worst(Object.values(checks).map((c) => c.status));
  const flagged = Object.entries(checks).filter(([, c]) => c.status !== "OK");
  const summary =
    overall === "OK"
      ? "ALL OK"
      : `${overall}: ` + flagged.map(([name, c]) => `${name} — ${c.detail}`).join("; ");

  const body = {
    summary,
    status: overall,
    generated_at: new Date().toISOString(),
    checks,
  };

  if (req.nextUrl.searchParams.get("format") === "text") {
    const lines = [
      summary,
      "",
      ...Object.entries(checks).map(([name, c]) => `[${c.status}] ${name}: ${c.detail}`),
      "",
      `generated ${body.generated_at}`,
    ];
    return new NextResponse(lines.join("\n"), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.json(body);
}

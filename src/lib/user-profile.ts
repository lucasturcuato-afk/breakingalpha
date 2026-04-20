/**
 * user-profile.ts — personalization layer utilities.
 *
 * Central helpers for:
 *   - getUserProfile(userId)                — read profile with sensible defaults
 *   - upsertUserProfile(userId, updates)    — whitelisted partial update
 *   - trackEvent(userId, type, payload)     — append to user_events
 *   - updateInferredWeights(userId)         — re-derive sector weights from events
 *   - buildPersonalizationContext(profile)  — prompt-ready paragraph for Gemini
 *
 * All helpers soft-fail: if the Supabase table/column is missing, they return
 * a neutral default so the rest of the app keeps working. The personalization
 * sprint migrations (20260416_*) add the schema these helpers expect.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseWithUser } from "./supabase-server";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type UserRole =
  | "student_analyst"
  | "buy_side"
  | "sell_side"
  | "private_equity"
  | "ria"
  | "family_office"
  | "other";

export type RiskAppetite = "aggressive" | "balanced" | "defensive";

export type StrategyType = "pe" | "equity" | "vc" | "macro" | "credit";

export type InvestmentHorizon = "short" | "medium" | "long";

export type WorkflowStyle = "deep_dive" | "screening" | "monitoring";

export interface UserProfile {
  id: string;
  first_name: string | null;
  role: UserRole | null;
  firm_or_school: string | null;
  sectors: string[];
  risk_appetite: RiskAppetite;
  strategy_type: StrategyType | null;
  investment_horizon: InvestmentHorizon | null;
  workflow_style: WorkflowStyle | null;
  watchlist_tickers: string[];
  onboarding_completed: boolean;
  inferred_sector_weights: Record<string, number>;
  inferred_weights_updated_at: string | null;
  market_cards: string[] | null;
  updated_at: string | null;
}

export type UserEventType =
  | "thesis_viewed"
  | "thesis_dismissed"
  | "thesis_approved"
  | "memo_generated"
  | "morning_brief_opened"
  | "evening_wrap_opened"
  | "pattern_clicked"
  | "watchlist_added"
  | "watchlist_removed"
  | "sector_filter_applied"
  | "onboarding_completed";

export interface UserEvent {
  id: string;
  user_id: string;
  event_type: UserEventType;
  payload: Record<string, unknown>;
  created_at: string;
}

// Inferred weight bounds. Outside this band the signal is probably noise —
// clamp so one vendetta-dismissal cycle can't zero out a whole sector.
const WEIGHT_MIN = 0.3;
const WEIGHT_MAX = 2.5;

const POSITIVE_EVENTS: UserEventType[] = [
  "thesis_viewed",
  "thesis_approved",
  "memo_generated",
  "pattern_clicked",
  "watchlist_added",
];
const NEGATIVE_EVENTS: UserEventType[] = [
  "thesis_dismissed",
  "watchlist_removed",
];

const DEFAULT_PROFILE = (id: string): UserProfile => ({
  id,
  first_name: null,
  role: null,
  firm_or_school: null,
  sectors: [],
  risk_appetite: "balanced",
  strategy_type: null,
  investment_horizon: null,
  workflow_style: null,
  watchlist_tickers: [],
  onboarding_completed: false,
  inferred_sector_weights: {},
  inferred_weights_updated_at: null,
  market_cards: null,
  updated_at: null,
});

// ─────────────────────────────────────────────────────────────────────────────
// Read / write
// ─────────────────────────────────────────────────────────────────────────────

export async function getUserProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserProfile> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.warn("[user-profile] getUserProfile:", error.message);
    return DEFAULT_PROFILE(userId);
  }

  if (!data) return DEFAULT_PROFILE(userId);

  // Fill in any columns the schema might be missing (pre-migration) with
  // defaults so consumers never have to null-check.
  const defaults = DEFAULT_PROFILE(userId);
  return {
    ...defaults,
    ...data,
    sectors: Array.isArray(data.sectors) ? data.sectors : [],
    watchlist_tickers: Array.isArray(data.watchlist_tickers)
      ? data.watchlist_tickers
      : [],
    inferred_sector_weights:
      typeof data.inferred_sector_weights === "object" &&
      data.inferred_sector_weights !== null
        ? (data.inferred_sector_weights as Record<string, number>)
        : {},
  };
}

const UPSERT_WHITELIST = [
  "first_name",
  "role",
  "firm_or_school",
  "sectors",
  "risk_appetite",
  "strategy_type",
  "investment_horizon",
  "workflow_style",
  "watchlist_tickers",
  "onboarding_completed",
  "inferred_sector_weights",
  "inferred_weights_updated_at",
  "market_cards",
] as const;

// DDL to run against Supabase if any of the newer profile columns are missing.
// Printed to the server log on the first upsert that hits a missing column so
// the operator notices and can apply the migration.
const MISSING_COLUMN_DDL = `-- Add missing profile columns:
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS strategy_type TEXT
    CHECK (strategy_type IN ('pe', 'equity', 'vc', 'macro', 'credit'));
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS investment_horizon TEXT
    CHECK (investment_horizon IN ('short', 'medium', 'long'));
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS workflow_style TEXT
    CHECK (workflow_style IN ('deep_dive', 'screening', 'monitoring'));
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS risk_appetite TEXT
    CHECK (risk_appetite IN ('aggressive', 'balanced', 'defensive'))
    DEFAULT 'balanced';`;

const OPTIONAL_COLUMNS = [
  "strategy_type",
  "investment_horizon",
  "workflow_style",
  "inferred_sector_weights",
  "inferred_weights_updated_at",
  "risk_appetite",
];

export async function upsertUserProfile(
  supabase: SupabaseClient,
  userId: string,
  updates: Partial<UserProfile>,
): Promise<{ ok: boolean; error?: string }> {
  const filtered: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  for (const key of UPSERT_WHITELIST) {
    if (key in updates) {
      filtered[key] = updates[key];
    }
  }

  const { error } = await supabase
    .from("user_profiles")
    .upsert({ id: userId, ...filtered }, { onConflict: "id" });

  if (error) {
    // Retry without the columns that might not exist yet (pre-migration env).
    const mentionsOptional = OPTIONAL_COLUMNS.some((c) =>
      error.message.includes(c),
    );
    if (mentionsOptional) {
      console.warn(
        `[user-profile] upsert hit missing column(s): ${error.message}\n` +
          `[user-profile] Apply the migration to unlock full personalization:\n${MISSING_COLUMN_DDL}`,
      );
      const retry = { ...filtered };
      for (const col of OPTIONAL_COLUMNS) delete retry[col];
      const { error: retryErr } = await supabase
        .from("user_profiles")
        .upsert({ id: userId, ...retry }, { onConflict: "id" });
      if (!retryErr) return { ok: true };
      console.warn("[user-profile] upsert retry:", retryErr.message);
      return { ok: false, error: retryErr.message };
    }
    console.warn("[user-profile] upsert:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Event tracking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Append-only write to user_events. Soft-fails (logs only) when the table is
 * missing — caller never needs to catch.
 */
export async function trackEvent(
  supabase: SupabaseClient,
  userId: string,
  eventType: UserEventType,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase
    .from("user_events")
    .insert({ user_id: userId, event_type: eventType, payload });

  if (error) {
    // Most common failure is table-doesn't-exist-yet. Log once, move on.
    if (!/relation.*user_events.*does not exist/.test(error.message)) {
      console.warn("[user-profile] trackEvent:", error.message);
    }
  }
}

/**
 * Convenience wrapper around trackEvent that resolves the current user from
 * Supabase cookies. Use from server actions / route handlers where you don't
 * already have a supabase client.
 */
export async function trackEventForCurrentUser(
  eventType: UserEventType,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return;
  await trackEvent(supabase, user.id, eventType, payload);
}

// ─────────────────────────────────────────────────────────────────────────────
// Inferred weights
// ─────────────────────────────────────────────────────────────────────────────

function clamp(n: number, lo = WEIGHT_MIN, hi = WEIGHT_MAX): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 1.0;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Aggregate the last N days of user_events into sector weights.
 *
 *   positive event  → weight += 0.05
 *   negative event  → weight -= 0.10 (dismissals count heavier)
 *
 * Starting at 1.0 (neutral) and clamped to [WEIGHT_MIN, WEIGHT_MAX].
 * Stored back on user_profiles.inferred_sector_weights.
 */
export async function updateInferredWeights(
  supabase: SupabaseClient,
  userId: string,
  lookbackDays = 30,
): Promise<{ weights: Record<string, number>; eventCount: number }> {
  const since = new Date(
    Date.now() - lookbackDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: events, error } = await supabase
    .from("user_events")
    .select("event_type, payload, created_at")
    .eq("user_id", userId)
    .gte("created_at", since);

  if (error) {
    console.warn("[user-profile] updateInferredWeights read:", error.message);
    return { weights: {}, eventCount: 0 };
  }

  const weights: Record<string, number> = {};
  for (const ev of (events ?? []) as {
    event_type: UserEventType;
    payload: Record<string, unknown> | null;
  }[]) {
    const payload = ev.payload ?? {};
    const sector =
      typeof payload.sector === "string" && payload.sector.trim().length > 0
        ? payload.sector.trim()
        : null;
    if (!sector) continue;

    if (!(sector in weights)) weights[sector] = 1.0;

    if (POSITIVE_EVENTS.includes(ev.event_type)) {
      weights[sector] += 0.05;
    } else if (NEGATIVE_EVENTS.includes(ev.event_type)) {
      weights[sector] -= 0.1;
    }
  }

  for (const k of Object.keys(weights)) {
    weights[k] = Number(clamp(weights[k]).toFixed(3));
  }

  const now = new Date().toISOString();
  const { error: writeErr } = await supabase
    .from("user_profiles")
    .update({
      inferred_sector_weights: weights,
      inferred_weights_updated_at: now,
    })
    .eq("id", userId);

  if (
    writeErr &&
    !/inferred_sector_weights|inferred_weights_updated_at/.test(
      writeErr.message,
    )
  ) {
    console.warn("[user-profile] updateInferredWeights write:", writeErr.message);
  }

  return { weights, eventCount: events?.length ?? 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt context builder
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_LABEL: Record<UserRole, string> = {
  student_analyst: "student analyst learning equity research",
  buy_side: "buy-side analyst at an investment manager",
  sell_side: "sell-side analyst covering public equities",
  private_equity: "private-equity investor evaluating deals",
  ria: "registered investment advisor managing client portfolios",
  family_office: "family-office investor allocating private capital",
  other: "investor",
};

const RISK_LABEL: Record<RiskAppetite, string> = {
  aggressive:
    "comfortable with higher-beta ideas and contrarian positioning",
  balanced:
    "looking for well-supported ideas across the risk spectrum",
  defensive:
    "prefers lower-volatility compounders and downside-protected setups",
};

const STRATEGY_LABEL: Record<StrategyType, string> = {
  pe: "private-equity mandate — durable cash flows, long duration",
  equity: "public-equity mandate — catalyst-driven and valuation-aware",
  vc: "venture mandate — asymmetric upside and runway sensitivity",
  macro: "macro mandate — regime- and policy-aware positioning",
  credit: "credit mandate — coupon safety, spread and downgrade risk",
};

const HORIZON_LABEL: Record<InvestmentHorizon, string> = {
  short: "short horizon (weeks to a few months)",
  medium: "medium horizon (6–18 months)",
  long: "long horizon (multi-year)",
};

const WORKFLOW_LABEL: Record<WorkflowStyle, string> = {
  deep_dive: "works via deep-dive single-name research",
  screening: "works via systematic screening and shortlists",
  monitoring: "works via ongoing monitoring of existing positions",
};

/**
 * Render the profile as a short paragraph suitable for injecting into a
 * Gemini system/user prompt. Returns an empty string when the profile is
 * blank so callers can unconditionally concatenate.
 */
export function buildPersonalizationContext(
  profile: UserProfile | null | undefined,
): string {
  if (!profile) return "";
  const parts: string[] = [];

  const name = profile.first_name?.trim();
  const role = profile.role ? ROLE_LABEL[profile.role] : null;
  const firmOrSchool = profile.firm_or_school?.trim();

  if (role) {
    const whoBits = [name, role, firmOrSchool ? `at ${firmOrSchool}` : null].filter(Boolean);
    parts.push(`Reader: ${whoBits.join(", ")}.`);
  } else if (name) {
    parts.push(`Reader: ${name}.`);
  }

  if (profile.sectors.length > 0) {
    parts.push(`Focus sectors: ${profile.sectors.join(", ")}.`);
  }
  if (profile.watchlist_tickers.length > 0) {
    parts.push(
      `Watchlist tickers: ${profile.watchlist_tickers.join(", ")}.`,
    );
  }
  parts.push(`Risk posture: ${RISK_LABEL[profile.risk_appetite]}.`);

  if (profile.strategy_type) {
    parts.push(`Strategy: ${STRATEGY_LABEL[profile.strategy_type]}.`);
  }
  if (profile.investment_horizon) {
    parts.push(`Horizon: ${HORIZON_LABEL[profile.investment_horizon]}.`);
  }
  if (profile.workflow_style) {
    parts.push(`Workflow: ${WORKFLOW_LABEL[profile.workflow_style]}.`);
  }

  const weights = profile.inferred_sector_weights ?? {};
  const boosted = Object.entries(weights)
    .filter(([, v]) => v >= 1.2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);
  const muted = Object.entries(weights)
    .filter(([, v]) => v <= 0.8)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([k]) => k);

  if (boosted.length) {
    parts.push(`Recently engaged most with: ${boosted.join(", ")}.`);
  }
  if (muted.length) {
    parts.push(`Has been dismissing: ${muted.join(", ")}.`);
  }

  return parts.join(" ");
}

/**
 * Sector weight lookup with neutral fallback. Use in ranking functions.
 */
export function sectorWeight(
  profile: UserProfile | null | undefined,
  sector: string | null | undefined,
): number {
  if (!profile || !sector) return 1.0;
  const s = sector.trim();
  if (!s) return 1.0;

  // Explicit profile sector boost — user picked these during onboarding.
  if (profile.sectors.includes(s)) {
    const inferred = profile.inferred_sector_weights?.[s] ?? 1.0;
    return clamp(inferred * 1.3);
  }
  return clamp(profile.inferred_sector_weights?.[s] ?? 1.0);
}

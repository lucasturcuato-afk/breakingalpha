/**
 * POST /api/brief/send-email
 *
 * Body: {
 *   briefing_id?: string;
 *   briefing_type?: "morning" | "evening";
 *   to: string[];
 *   subject?: string;
 * }
 *
 * Auth required. Renders the <BriefEmail /> component to HTML via react-email
 * and dispatches via Resend. If RESEND_API_KEY is not configured, returns 503.
 */

import { NextRequest, NextResponse } from "next/server";
import { render } from "@react-email/render";
import { Resend } from "resend";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { BriefEmail, type BriefEmailPayload } from "@/components/brief/brief-email";
import {
  fetchWatchlistArticlePool,
  resolveUserWatchlist,
  bulletsFromPool,
  getWatchlistBullets,
  type WatchlistPoolRow,
  type WatchlistBriefSection,
} from "@/lib/watchlist-brief";
import { createElement } from "react";
import { getSiteUrl } from "@/lib/email/site-url";
import { ensureIssueNumber } from "@/lib/email/issue-number";
import { makeUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import { isAdmin } from "@/lib/admin-emails";
import { normalizeSections } from "@/lib/brief-sections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Service-role Supabase client for cross-user reads (watchlist + profiles are
 * RLS-locked to the owner; the sender's session cannot read a recipient's
 * watchlist). Falls back to anon if the service key is absent, in which case
 * RLS yields an empty watchlist and the section soft-fails to nothing.
 */
function makeAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function safeParseJSON(val: unknown) {
  if (!val) return null;
  if (typeof val === "object") return val;
  try {
    return JSON.parse(val as string);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 },
    );
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: "Email service not configured. Contact admin." },
      { status: 503 },
    );
  }

  let body: {
    briefing_id?: string;
    briefing_type?: "morning" | "evening";
    to?: string[];
    subject?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const to = Array.isArray(body.to) ? body.to.map((x) => String(x).trim()).filter(Boolean) : [];
  if (to.length === 0) {
    return NextResponse.json(
      { error: "`to` must be a non-empty array of email addresses" },
      { status: 400 },
    );
  }
  const invalid = to.filter((e) => !EMAIL_RE.test(e));
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Invalid email address(es): ${invalid.join(", ")}` },
      { status: 400 },
    );
  }

  // Recipient guard: a non-admin caller may only send the brief to their own
  // verified email. Admins (ADMIN_EMAILS) may send to any recipient. Without
  // this, any authenticated user could send mail to arbitrary external
  // addresses from our domain, an outbound-spam and reputation risk.
  if (!isAdmin(user.email)) {
    const own = (user.email ?? "").toLowerCase();
    const foreign = to.filter((e) => e.toLowerCase() !== own);
    if (!own || foreign.length > 0) {
      return NextResponse.json(
        { error: "You can only send this brief to your own account email." },
        { status: 403 },
      );
    }
  }

  const briefingId = typeof body.briefing_id === "string" ? body.briefing_id : null;
  const briefingType =
    body.briefing_type === "morning" || body.briefing_type === "evening"
      ? body.briefing_type
      : "morning";

  const query = supabase.from("briefings").select("*");
  const { data, error } = briefingId
    ? await query.eq("id", briefingId).limit(1)
    : await query
        .eq("briefing_type", briefingType)
        .neq("headline", "Market Intelligence Unavailable")
        .order("created_at", { ascending: false })
        .limit(1);

  if (error) {
    console.error("[send-email] supabase error:", error.message);
    return NextResponse.json(
      { error: "Failed to fetch briefing" },
      { status: 500 },
    );
  }
  const raw = data?.[0];
  if (!raw) {
    return NextResponse.json({ error: "Briefing not found" }, { status: 404 });
  }

  // Issue number: compute and cache on first send. Soft-fails to null
  // if the migration hasn't been applied; the email simply omits "Issue #N".
  const issueNumber = await ensureIssueNumber(
    supabase,
    raw.id as string,
    typeof raw.issue_number === "number" ? raw.issue_number : null,
  );

  // Filter out recipients who have opted out of brief emails. We use a
  // service-role client (anon key fallback) because RLS on user_profiles
  // blocks reads of other users' rows from the requester's session.
  // Match by lowercased email against auth.users via the user_profiles
  // join is overkill here: instead we look up profile rows where the
  // user's auth email matches one of the recipients. If we can't resolve
  // a recipient (no profile yet), we keep them in the send list.
  const filteredTo = await filterUnsubscribed(to);
  if (filteredTo.length === 0) {
    return NextResponse.json(
      {
        ok: true,
        skipped: to,
        reason: "All recipients have unsubscribed.",
        to: [],
      },
      { status: 200 },
    );
  }

  const payload: BriefEmailPayload = {
    id: raw.id ?? undefined,
    headline: raw.headline ?? undefined,
    summary: raw.summary ?? undefined,
    market_tone: raw.market_tone ?? undefined,
    // Reads Supabase directly, so /api/briefing normalization does not reach it.
    sections: normalizeSections(safeParseJSON(raw.sections)),
    top_deals: (safeParseJSON(raw.top_deals) as BriefEmailPayload["top_deals"]) ?? [],
    sector_breakdown:
      (safeParseJSON(raw.sector_breakdown) as Record<string, string> | null) ?? null,
    created_at: raw.created_at ?? undefined,
    market_pulse:
      (safeParseJSON(raw.market_pulse) as BriefEmailPayload["market_pulse"]) ?? null,
    briefing_type: (raw.briefing_type as "morning" | "evening") ?? briefingType,
    issue_number: issueNumber,
  };

  // Build per-send URLs. View-in-browser is the same for everyone (the
  // public share view at /share/brief/[id]). Unsubscribe is per-user
  // and we fall back to the requesting user's id if we cannot resolve
  // the recipient. That means clicking unsubscribe in a forwarded
  // email would unsubscribe the original sender, which is the safer
  // failure mode (no silent send-loop) and only happens for
  // recipients we have no profile row for.
  const siteUrl = getSiteUrl();
  const viewInBrowserUrl = raw.id
    ? `${siteUrl}/share/brief/${raw.id}`
    : siteUrl;

  // Resolve a per-recipient unsubscribe token. For multi-recipient sends
  // we send one Resend call per recipient so each gets their own token
  // and List-Unsubscribe URL. Resend's bulk send can collapse these into
  // a single API call later if needed.
  const sendResults: Array<{ to: string; id: string | null }> = [];
  const sendErrors: Array<{ to: string; error: string }> = [];

  let resend: Resend;
  try {
    resend = new Resend(process.env.RESEND_API_KEY);
  } catch (e) {
    console.error("[send-email] resend init error:", e);
    return NextResponse.json(
      { error: "Email service init failed" },
      { status: 502 },
    );
  }

  // Watchlist section: fetch the 72h score>=8 article pool ONCE per send, then
  // filter it per recipient in memory inside the loop. Service-role client so
  // we can read each recipient's own watchlist (RLS-locked). All soft-fail: a
  // null pool/admin just means no recipient gets a section.
  const wlAdmin = makeAdminClient();
  let watchlistPool: WatchlistPoolRow[] = [];
  try {
    if (wlAdmin) watchlistPool = await fetchWatchlistArticlePool(wlAdmin);
  } catch (e) {
    console.warn("[send-email] watchlist pool fetch failed; sending without section:", e);
    watchlistPool = [];
  }
  const ownEmail = (user.email ?? "").toLowerCase();

  const from = process.env.EMAIL_FROM_ADDRESS ?? "briefs@signalera.ai";
  const defaultSubject =
    payload.briefing_type === "evening"
      ? "Signalera Evening Wrap"
      : "Signalera Morning Brief";
  const baseSubject = (body.subject && body.subject.trim()) || defaultSubject;
  const subject =
    issueNumber && !baseSubject.toLowerCase().includes("issue")
      ? `${baseSubject} · Issue #${issueNumber}`
      : baseSubject;

  for (const recipient of filteredTo) {
    const userIdForToken = await resolveUserIdForEmail(recipient, user.id);
    let unsubscribeUrl: string;
    try {
      unsubscribeUrl = `${siteUrl}/api/unsubscribe?token=${makeUnsubscribeToken(
        userIdForToken,
      )}`;
    } catch (e) {
      console.error(
        "[send-email] could not mint unsubscribe token (missing JWT secret?):",
        e,
      );
      // Without a token we cannot meet Gmail's bulk-sender requirement.
      // Refuse the send rather than ship a non-compliant email.
      return NextResponse.json(
        {
          error:
            "Unsubscribe signing key missing. Set SUPABASE_JWT_SECRET (or SUPABASE_SERVICE_ROLE_KEY).",
        },
        { status: 503 },
      );
    }

    // Per-recipient watchlist section. Fail-soft: any error here must not abort
    // the batch and the recipient still gets their brief without a section.
    // Only attach when we resolved a real account for THIS recipient, so the
    // sender's watchlist never leaks to an unresolved address (resolveUserId
    // falls back to the sender's id on a miss).
    let watchlistSection: WatchlistBriefSection | null = null;
    try {
      const isThisRecipient =
        userIdForToken !== user.id || recipient.toLowerCase() === ownEmail;
      if (wlAdmin && isThisRecipient) {
        const tickers = await resolveUserWatchlist(wlAdmin, userIdForToken);
        watchlistSection = bulletsFromPool(watchlistPool, tickers);
      }
    } catch (e) {
      console.warn("[send-email] watchlist section failed for recipient; sending without it:", e);
      watchlistSection = null;
    }

    let html: string;
    try {
      const element = createElement(BriefEmail, {
        briefing: payload,
        watchlistSection,
        viewInBrowserUrl,
        unsubscribeUrl,
      });
      html = await render(element as React.ReactElement);
    } catch (e) {
      console.error("[send-email] render error:", e);
      sendErrors.push({
        to: recipient,
        error: "Failed to render email",
      });
      continue;
    }

    try {
      const result = await resend.emails.send({
        from,
        to: [recipient],
        replyTo: process.env.EMAIL_REPLY_TO ?? "admin@signalera.ai",
        subject,
        html,
        // RFC 2369 / RFC 8058 compliance for Gmail bulk-sender rules.
        // The mailto: address gives mail clients a fallback route that
        // doesn't depend on the HTTP one-click endpoint working.
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:admin@signalera.ai?subject=unsubscribe>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      if (result.error) {
        console.error("[send-email] resend error:", result.error);
        sendErrors.push({
          to: recipient,
          error:
            typeof result.error === "object" && "message" in result.error
              ? (result.error as { message: string }).message
              : "Resend failed",
        });
        continue;
      }
      sendResults.push({ to: recipient, id: result.data?.id ?? null });
    } catch (e) {
      console.error("[send-email] dispatch error:", e);
      const msg = e instanceof Error ? e.message : "Email dispatch failed";
      sendErrors.push({ to: recipient, error: msg });
    }
  }

  if (sendResults.length === 0 && sendErrors.length > 0) {
    return NextResponse.json(
      { error: sendErrors[0].error, errors: sendErrors },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    sent: sendResults,
    errors: sendErrors,
    skipped: to.filter((t) => !filteredTo.includes(t)),
    issue_number: issueNumber,
  });
}

/**
 * Returns the subset of `recipients` that have NOT opted out of brief
 * emails. Recipients with no user_profiles row are kept (default true).
 *
 * Soft-fail: if the brief_email_subscribed column doesn't exist yet
 * (migration unapplied), we return all recipients to keep email working.
 */
async function filterUnsubscribed(recipients: string[]): Promise<string[]> {
  if (recipients.length === 0) return [];
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return recipients;
    const admin = createClient(url, key, { auth: { persistSession: false } });

    // user_profiles doesn't store email directly; auth.users does. We
    // use admin.auth.admin.listUsers() to map emails -> user ids, then
    // look up brief_email_subscribed for those ids. Soft-fails on any
    // error path back to the full recipient list.
    const lowered = new Set(recipients.map((r) => r.toLowerCase()));
    const { data: usersList, error: listErr } = await admin.auth.admin.listUsers({
      perPage: 1000,
    });
    if (listErr) {
      console.warn("[send-email] listUsers failed; sending to all:", listErr.message);
      return recipients;
    }
    const matched = (usersList?.users ?? []).filter(
      (u) => u.email && lowered.has(u.email.toLowerCase()),
    );
    if (matched.length === 0) return recipients;
    const ids = matched.map((u) => u.id);
    const { data: profiles, error: profErr } = await admin
      .from("user_profiles")
      .select("id, brief_email_subscribed")
      .in("id", ids);
    if (profErr) {
      console.warn(
        "[send-email] user_profiles lookup failed; sending to all:",
        profErr.message,
      );
      return recipients;
    }
    const optedOutIds = new Set(
      (profiles ?? [])
        .filter((p) => p.brief_email_subscribed === false)
        .map((p) => p.id),
    );
    if (optedOutIds.size === 0) return recipients;
    const optedOutEmails = new Set(
      matched
        .filter((u) => optedOutIds.has(u.id))
        .map((u) => (u.email || "").toLowerCase()),
    );
    return recipients.filter(
      (r) => !optedOutEmails.has(r.toLowerCase()),
    );
  } catch (e) {
    console.warn("[send-email] filterUnsubscribed soft-fail:", e);
    return recipients;
  }
}

/**
 * Returns the auth user_id whose email matches `email`, or `fallbackUserId`
 * (the requesting user) if no match is found. Used to mint per-recipient
 * unsubscribe tokens. Soft-fails to fallback on any error.
 */
async function resolveUserIdForEmail(
  email: string,
  fallbackUserId: string,
): Promise<string> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return fallbackUserId;
    const admin = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (error) return fallbackUserId;
    const lower = email.toLowerCase();
    const hit = (data?.users ?? []).find(
      (u) => (u.email || "").toLowerCase() === lower,
    );
    return hit?.id ?? fallbackUserId;
  } catch {
    return fallbackUserId;
  }
}

/**
 * GET /api/brief/send-email — returns a render preview of the HTML email for
 * the current user (no send). Used by the "Preview HTML email" menu item.
 */
export async function GET(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 },
    );
  }

  const briefingType =
    request.nextUrl.searchParams.get("briefing_type") === "evening"
      ? "evening"
      : "morning";
  const briefingId = request.nextUrl.searchParams.get("briefing_id");

  const query = supabase.from("briefings").select("*");
  const { data, error } = briefingId
    ? await query.eq("id", briefingId).limit(1)
    : await query
        .eq("briefing_type", briefingType)
        .neq("headline", "Market Intelligence Unavailable")
        .order("created_at", { ascending: false })
        .limit(1);

  if (error || !data?.[0]) {
    return NextResponse.json({ error: "Briefing not found" }, { status: 404 });
  }

  const raw = data[0];

  // Preview reads (but does NOT mint) the cached issue number so the
  // user-triggered preview doesn't accidentally consume an issue # that
  // would later collide with the real send. If unset, the preview shows
  // no Issue # (same soft-fail behavior as the send path).
  const previewIssueNumber =
    typeof raw.issue_number === "number" ? raw.issue_number : null;

  const payload: BriefEmailPayload = {
    id: raw.id ?? undefined,
    headline: raw.headline ?? undefined,
    summary: raw.summary ?? undefined,
    market_tone: raw.market_tone ?? undefined,
    // Reads Supabase directly, so /api/briefing normalization does not reach it.
    sections: normalizeSections(safeParseJSON(raw.sections)),
    top_deals: (safeParseJSON(raw.top_deals) as BriefEmailPayload["top_deals"]) ?? [],
    sector_breakdown:
      (safeParseJSON(raw.sector_breakdown) as Record<string, string> | null) ?? null,
    created_at: raw.created_at ?? undefined,
    market_pulse:
      (safeParseJSON(raw.market_pulse) as BriefEmailPayload["market_pulse"]) ?? null,
    briefing_type: (raw.briefing_type as "morning" | "evening") ?? briefingType,
    issue_number: previewIssueNumber,
  };

  // Build preview-mode URLs. The unsubscribe token is keyed to the
  // requesting user so they can self-test the unsubscribe flow against
  // their own profile row.
  const siteUrl = getSiteUrl();
  const viewInBrowserUrl = raw.id
    ? `${siteUrl}/share/brief/${raw.id}`
    : siteUrl;
  let unsubscribeUrl: string | undefined;
  try {
    unsubscribeUrl = `${siteUrl}/api/unsubscribe?token=${makeUnsubscribeToken(
      user.id,
    )}`;
  } catch {
    // Preview without an unsubscribe link is acceptable. The warning
    // surfaces on real sends.
    unsubscribeUrl = undefined;
  }

  // Preview the requester's own watchlist section. Fail-soft to no section.
  let previewWatchlist: WatchlistBriefSection | null = null;
  try {
    const wlAdmin = makeAdminClient();
    if (wlAdmin) {
      previewWatchlist = await getWatchlistBullets(wlAdmin, user.id, briefingType);
    }
  } catch (e) {
    console.warn("[send-email GET] watchlist preview failed:", e);
    previewWatchlist = null;
  }

  try {
    const element = createElement(BriefEmail, {
      briefing: payload,
      watchlistSection: previewWatchlist,
      viewInBrowserUrl,
      unsubscribeUrl,
    });
    const html = await render(element as React.ReactElement);
    return NextResponse.json({ html });
  } catch (e) {
    console.error("[send-email GET] render error:", e);
    return NextResponse.json({ error: "Render failed" }, { status: 500 });
  }
}

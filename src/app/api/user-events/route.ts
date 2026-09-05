import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { getServiceSupabase } from "@/lib/supabase-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Event naming: surface.object.action (brief.page.opened, radar.call.authored).
 * The 12 legacy snake_case names predate the convention and are still accepted,
 * so the five live consumers of user_events keep working unchanged.
 *
 * This regex replaces the previous hardcoded VALID_TYPES allowlist. Adding a new
 * event no longer requires editing this route.
 */
const EVENT_NAME_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)?$/;
const MAX_EVENT_NAME_LEN = 64;
const MAX_BATCH = 50;

/**
 * Payload keys that would imply a position rather than an interest. Rejected at
 * the boundary so the compliance line is enforced in code, not convention.
 */
const DENIED_PAYLOAD_KEYS = new Set([
  "shares", "qty", "quantity", "size", "notional", "cost_basis",
  "entry_price", "avg_price", "allocation", "pnl", "position", "holdings",
]);

interface IncomingEvent {
  event_type?: unknown;
  payload?: unknown;
  session_id?: unknown;
  entity_type?: unknown;
  entity_id?: unknown;
  client_ts?: unknown;
}

interface SpineRow {
  user_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  session_id?: string;
  entity_type?: string;
  entity_id?: string;
  client_ts?: string;
}

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.slice(0, max);
}

/** Strip position-implying keys. Returns the cleaned payload. */
function sanitizePayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (DENIED_PAYLOAD_KEYS.has(k.toLowerCase())) {
      console.warn(`[user-events] dropped denied payload key: ${k}`);
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** Validate one incoming event. Returns null (and logs) when malformed. */
function normalize(raw: IncomingEvent, userId: string): SpineRow | null {
  const name = str(raw.event_type, MAX_EVENT_NAME_LEN + 1);
  if (!name) {
    console.warn("[user-events] dropped event: missing event_type");
    return null;
  }
  if (name.length > MAX_EVENT_NAME_LEN || !EVENT_NAME_RE.test(name)) {
    console.warn(`[user-events] dropped event: invalid event_type "${name}"`);
    return null;
  }

  const row: SpineRow = {
    user_id: userId,
    event_type: name,
    payload: sanitizePayload(raw.payload),
  };

  const sessionId = str(raw.session_id, 64);
  if (sessionId) row.session_id = sessionId;
  const entityType = str(raw.entity_type, 32);
  if (entityType) row.entity_type = entityType;
  const entityId = str(raw.entity_id, 128);
  if (entityId) row.entity_id = entityId;
  const clientTs = str(raw.client_ts, 40);
  if (clientTs && !Number.isNaN(Date.parse(clientTs))) row.client_ts = clientTs;

  return row;
}

/**
 * Fold the spine-only fields back into payload, for the window before the
 * migration that adds session_id / entity_type / client_ts (and widens
 * entity_id to text) has been applied. Keeps this route deployable ahead of the
 * migration instead of silently dropping every event.
 */
function toLegacyRow(row: SpineRow): { user_id: string; event_type: string; payload: Record<string, unknown> } {
  const payload = { ...row.payload };
  if (row.session_id) payload._session_id = row.session_id;
  if (row.entity_type) payload._entity_type = row.entity_type;
  if (row.entity_id) payload._entity_id = row.entity_id;
  if (row.client_ts) payload._client_ts = row.client_ts;
  return { user_id: row.user_id, event_type: row.event_type, payload };
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await getSupabaseWithUser();
    if (!user) {
      // Not a 401. This is fire-and-forget and a 401 would spam the console.
      return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 204 });
    }

    const body = await request.json().catch(() => null);

    // Accept a batch (array) or a single event (object), so existing callers
    // and the batched client helper both work.
    const incoming: IncomingEvent[] = Array.isArray(body)
      ? body
      : body && typeof body === "object"
        ? [body as IncomingEvent]
        : [];

    if (incoming.length === 0) {
      return NextResponse.json({ ok: false, reason: "empty body" }, { status: 200 });
    }
    if (incoming.length > MAX_BATCH) {
      console.warn(`[user-events] batch of ${incoming.length} truncated to ${MAX_BATCH}`);
    }

    const rows = incoming
      .slice(0, MAX_BATCH)
      .map((e) => normalize(e ?? {}, user.id))
      .filter((r): r is SpineRow => r !== null);

    const dropped = Math.min(incoming.length, MAX_BATCH) - rows.length;

    if (rows.length === 0) {
      return NextResponse.json({ ok: false, accepted: 0, dropped }, { status: 200 });
    }

    // Service role to bypass RLS on user_events.
    const adminSupabase = getServiceSupabase();

    const { error } = await adminSupabase.from("user_events").insert(rows);

    if (error) {
      // PostgREST rejects the whole batch on an unknown column or a bad uuid
      // cast, before writing anything, so retrying cannot double-insert.
      console.warn("[user-events] spine insert failed, retrying legacy shape:", error.message);
      const { error: legacyError } = await adminSupabase
        .from("user_events")
        .insert(rows.map(toLegacyRow));
      if (legacyError) {
        console.error("[user-events] legacy insert failed:", legacyError.message);
        return NextResponse.json({ ok: false, reason: legacyError.message }, { status: 200 });
      }
      return NextResponse.json({ ok: true, accepted: rows.length, dropped, degraded: true });
    }

    return NextResponse.json({ ok: true, accepted: rows.length, dropped });
  } catch (err) {
    console.warn("[user-events] error:", err);
    // Never let event tracking break the caller.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

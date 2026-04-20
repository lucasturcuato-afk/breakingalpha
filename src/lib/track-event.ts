/**
 * track-event.ts — client-side helper for behavioral event telemetry.
 *
 * Fires a fire-and-forget POST to /api/user-events. Never throws, never
 * blocks the caller. The server-side handler (see src/app/api/user-events)
 * soft-fails when the user_events table is missing, so this is safe to
 * call from any client component.
 */

export type ClientEventType =
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

export function trackClientEvent(
  event_type: ClientEventType,
  payload: Record<string, unknown> = {},
): void {
  try {
    // fire-and-forget
    void fetch("/api/user-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type, payload }),
      keepalive: true,
    }).then((res) => {
      if (!res.ok) {
        console.error(`[track-event] ${event_type} failed: HTTP ${res.status}`);
      }
    }).catch((err) => {
      console.error(`[track-event] ${event_type} network error:`, err);
    });
  } catch {
    // ignore
  }
}

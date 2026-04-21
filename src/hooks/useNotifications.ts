"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface WatchlistNotification {
  id: string;
  identifier: string;
  type: string;
  title: string;
  body?: string | null;
  read: boolean;
  created_at: string;
}

const POLL_INTERVAL_MS = 60_000;

/**
 * Polls /api/watchlist-notifications every 60s (and on window focus).
 * Returns the last 20 notifications + helpers to mark them read.
 * Interval + focus listener are cleaned up on unmount.
 *
 * Pass `enabled = false` when the user is unauthenticated — the hook will
 * short-circuit, clear any existing timer, and return an empty list.
 */
export function useNotifications(enabled: boolean) {
  const [notifications, setNotifications] = useState<WatchlistNotification[]>([]);
  const [loaded, setLoaded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track mount status so async fetches don't update state after unmount.
  const mountedRef = useRef(true);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist-notifications", {
        credentials: "include",
      });
      if (!res.ok) {
        if (mountedRef.current) setLoaded(true);
        return;
      }
      const data = await res.json();
      if (!mountedRef.current) return;
      const list: WatchlistNotification[] = Array.isArray(data.notifications)
        ? data.notifications.slice(0, 20)
        : [];
      setNotifications(list);
      setLoaded(true);
    } catch {
      if (mountedRef.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      // Sign-out / unauthenticated: subscribing to nothing, so nothing to
      // clean up beyond clearing local state on the next tick. Queueing via
      // queueMicrotask avoids the cascading-render lint rule while still
      // dropping stale data.
      queueMicrotask(() => {
        if (!mountedRef.current) return;
        setNotifications([]);
        setLoaded(false);
      });
      return;
    }

    // Defer initial fetch via queueMicrotask so the effect doesn't cascade
    // into synchronous setState during mount (setLoaded inside fetchNotifications).
    queueMicrotask(() => {
      if (mountedRef.current) void fetchNotifications();
    });
    const timer = setInterval(fetchNotifications, POLL_INTERVAL_MS);
    timerRef.current = timer;

    const onFocus = () => {
      fetchNotifications();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(timer);
      if (timerRef.current === timer) {
        timerRef.current = null;
      }
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, fetchNotifications]);

  const markRead = useCallback(async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    try {
      await fetch("/api/watchlist-notifications", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
    } catch {
      // swallow — optimistic update stays
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await fetch("/api/watchlist-notifications", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: unreadIds }),
      });
    } catch {
      // swallow — optimistic update stays
    }
  }, [notifications]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return {
    notifications,
    unreadCount,
    loaded,
    markRead,
    markAllRead,
    refetch: fetchNotifications,
  };
}

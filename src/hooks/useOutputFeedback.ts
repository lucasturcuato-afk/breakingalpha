"use client";

import { useEffect, useRef, useCallback, useState } from "react";

interface FeedbackEvent {
  output_id: string;
  dwell_seconds?: number;
  scroll_depth?: number;
  entered_viewport?: boolean;
  exited_viewport?: boolean;
  clicked_source?: boolean;
  dismissed?: boolean;
  followup_generated?: boolean;
  saved?: boolean;
  shared?: boolean;
  exported?: boolean;
  thumbs?: "up" | "down" | null;
  text_feedback?: string;
}

// Module-level batch queue — coalesces events from multiple hooks across the page
let queue: FeedbackEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL_MS = 3000;
const MAX_QUEUE = 50;

function flush() {
  if (queue.length === 0) return;
  const batch = queue.slice(0, MAX_QUEUE);
  queue = queue.slice(MAX_QUEUE);
  fetch("/api/outputs/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(batch),
    keepalive: true,
  }).catch((err) => console.warn("[feedback] flush failed:", err));
  if (queue.length > 0) {
    flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
  } else {
    flushTimer = null;
  }
}

function enqueue(event: FeedbackEvent) {
  queue.push(event);
  if (!flushTimer) {
    flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
  }
}

// Flush on page unload
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (queue.length > 0) {
      navigator.sendBeacon(
        "/api/outputs/feedback",
        new Blob([JSON.stringify(queue)], { type: "application/json" }),
      );
      queue = [];
    }
  });
}

interface UseOutputFeedbackOptions {
  output_id: string | null | undefined;
  viewport_threshold?: number;
}

export function useOutputFeedback({
  output_id,
  viewport_threshold = 0.5,
}: UseOutputFeedbackOptions) {
  const ref = useRef<HTMLElement | null>(null);
  const enterTimeRef = useRef<number | null>(null);
  const totalDwellRef = useRef<number>(0);
  const maxScrollRef = useRef<number>(0);
  const enteredOnceRef = useRef(false);

  const [thumbs, setThumbsState] = useState<"up" | "down" | null>(null);

  // IntersectionObserver: track viewport entry/exit for dwell time
  useEffect(() => {
    if (!output_id || !ref.current) return;
    const el = ref.current;
    const oid = output_id;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (enterTimeRef.current === null) {
              enterTimeRef.current = Date.now();
              if (!enteredOnceRef.current) {
                enteredOnceRef.current = true;
                enqueue({ output_id: oid, entered_viewport: true });
              }
            }
          } else {
            if (enterTimeRef.current !== null) {
              const delta = (Date.now() - enterTimeRef.current) / 1000;
              totalDwellRef.current += delta;
              enterTimeRef.current = null;
              enqueue({
                output_id: oid,
                exited_viewport: true,
                dwell_seconds: Math.round(totalDwellRef.current),
              });
            }
          }
        }
      },
      { threshold: viewport_threshold },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (enterTimeRef.current !== null) {
        const delta = (Date.now() - enterTimeRef.current) / 1000;
        totalDwellRef.current += delta;
        enqueue({
          output_id: oid,
          dwell_seconds: Math.round(totalDwellRef.current),
        });
      }
    };
  }, [output_id, viewport_threshold]);

  // Scroll depth tracking
  useEffect(() => {
    if (!output_id || !ref.current) return;
    const el = ref.current;
    const oid = output_id;

    const onScroll = () => {
      const rect = el.getBoundingClientRect();
      const visibleBottom = Math.min(window.innerHeight, rect.bottom);
      const visibleTop = Math.max(0, rect.top);
      const depth = Math.max(
        0,
        Math.min(1, (visibleBottom - visibleTop) / el.scrollHeight),
      );
      if (depth > maxScrollRef.current) {
        maxScrollRef.current = depth;
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (maxScrollRef.current > 0) {
        enqueue({
          output_id: oid,
          scroll_depth: Number(maxScrollRef.current.toFixed(2)),
        });
      }
    };
  }, [output_id]);

  const setThumbs = useCallback(
    (value: "up" | "down" | null) => {
      if (!output_id) return;
      setThumbsState(value);
      enqueue({ output_id, thumbs: value });
    },
    [output_id],
  );

  const recordClick = useCallback(() => {
    if (!output_id) return;
    enqueue({ output_id, clicked_source: true });
  }, [output_id]);

  const recordDismiss = useCallback(() => {
    if (!output_id) return;
    enqueue({ output_id, dismissed: true });
  }, [output_id]);

  const recordSave = useCallback(() => {
    if (!output_id) return;
    enqueue({ output_id, saved: true });
  }, [output_id]);

  const recordShare = useCallback(() => {
    if (!output_id) return;
    enqueue({ output_id, shared: true });
  }, [output_id]);

  const recordExport = useCallback(() => {
    if (!output_id) return;
    enqueue({ output_id, exported: true });
  }, [output_id]);

  const recordFollowup = useCallback(() => {
    if (!output_id) return;
    enqueue({ output_id, followup_generated: true });
  }, [output_id]);

  const submitTextFeedback = useCallback(
    (text: string) => {
      if (!output_id || !text.trim()) return;
      enqueue({ output_id, text_feedback: text.trim() });
    },
    [output_id],
  );

  return {
    ref,
    thumbs,
    setThumbs,
    recordClick,
    recordDismiss,
    recordSave,
    recordShare,
    recordExport,
    recordFollowup,
    submitTextFeedback,
  };
}

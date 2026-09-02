"use client";

/**
 * CompanyMemoModalListener (PR-E0)
 *
 * Minimal client-side bridge between the memo controls on this route and
 * MemoModal. A control fires `memo:generate` (via window.dispatchEvent) and
 * this listener mounts the MemoModal in response. The propose-only
 * MemoModal.tsx is NOT modified, only consumed.
 *
 * MOUNTED OUTSIDE BOTH TREES on `/company/[id]`, so it is live at 390 as well
 * as on the desk. That is what lets the mobile Company Intel screen open the
 * same overlay the desktop header opens, which is the ruling recorded in
 * `decisions/memo-is-an-overlay-on-mobile.md`.
 *
 * IT CARRIES A PRELOADED MEMO, and that is the cost control rather than a
 * convenience. `MemoModal` never checks `/api/memo-cache`; only `BriefTab`
 * does. Without a cache hit in hand, every open of this modal is one Gemini
 * call, and the `/api/memo` rate limit cannot bound that: it is an in-memory
 * Map whose own docstring says state resets on restart, so on serverless it is
 * per-instance and resets on every cold start. The dispatching control reads
 * the cache and puts the hit on the event; `preloadedMemo` is MemoModal's own
 * existing prop and short-circuits generation inside it.
 */

import { useEffect, useState } from "react";
import { MemoModal } from "@/components/memo/MemoModal";

interface CompanyMemoModalListenerProps {
  companyName: string;
  memoContent: string;
  systemPrompt: string;
}

/** What a dispatcher may put on the event. Everything else is ignored. */
interface MemoGenerateDetail {
  preloadedMemo?: string;
}

export function CompanyMemoModalListener({
  companyName,
  memoContent,
  systemPrompt,
}: CompanyMemoModalListenerProps) {
  const [open, setOpen] = useState(false);
  const [preloadedMemo, setPreloadedMemo] = useState<string | undefined>(undefined);

  useEffect(() => {
    function handle(event: Event) {
      /* Read off the event rather than fetched here, so the control that was
         pressed owns its own pending state. A dispatcher that sends nothing
         still opens the modal, which is exactly the behaviour every existing
         dispatcher had. */
      const detail = (event as CustomEvent<MemoGenerateDetail>).detail;
      const memo = detail?.preloadedMemo;
      setPreloadedMemo(typeof memo === "string" && memo.length > 0 ? memo : undefined);
      setOpen(true);
    }
    window.addEventListener("memo:generate", handle);
    return () => window.removeEventListener("memo:generate", handle);
  }, []);

  /* NOT MOUNTED UNTIL THE EVENT ARRIVES, and that ordering is load-bearing.
     MemoModal's fetch effect lists `preloadedMemo` in its dependencies, so
     mounting it first and supplying the cache hit afterwards would have fired
     the POST on the first pass and then thrown the answer away. The state is
     set in the same handler that opens it, so the modal's first render already
     has the memo. */
  if (!open) return null;

  return (
    <MemoModal
      isOpen={open}
      onClose={() => setOpen(false)}
      title={companyName}
      content={memoContent}
      type="company"
      systemPrompt={systemPrompt}
      preloadedMemo={preloadedMemo}
    />
  );
}

"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * WHY THIS TAKES A `stored` PROP.
 *
 * It PATCHes `{ inferred_sector_weights: {} }` to `/api/user-profile`. That
 * column is in `OPTIONAL_COLUMNS` (`api/user-profile/route.ts:21-27`), so when
 * the upsert fails on the missing column the route strips the optional keys,
 * retries, and answers 200 with `{success: true}`. `res.ok` was therefore true
 * for a write that had been discarded, and this said **"Cleared."**
 *
 * It renders nine lines above the paragraph this batch added to
 * `settings/preferences/page.tsx` explaining that nothing can be saved. A
 * reader saw both at once: an honest explanation that there is nowhere to keep
 * these numbers, and a control telling them it had just cleared them. Fixing
 * one side of that page created the juxtaposition, which is worse than either
 * half alone.
 *
 * This was deferred once as belonging with the migration decision. That
 * deferral does not survive. `stored` is already computed at the call site, so
 * an honest rendering is reachable with no migration, no shared-library edit,
 * and the same mechanism the mobile twin uses.
 *
 * `disabled` is the fitting closure for a BUTTON, and the distinction took a
 * round to settle. A button has no state to misannounce, so `disabled` asserts
 * nothing untrue. A switch IS a state display, which is why the five locked
 * Alerts switches render as decorative `aria-hidden` spans instead:
 * `aria-checked="false"` would claim a setting that does not exist. Same
 * precedent, opposite mechanics, decided by the control type.
 */
export function ResetLearnedPrefsButton({ stored }: { stored: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const reasonId = useId();

  async function handleReset() {
    if (!confirm("Clear all learned sector weights? Your explicit preferences will stay.")) {
      return;
    }
    setError(null);
    try {
      const res = await fetch("/api/user-profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inferred_sector_weights: {} }),
      });
      if (!res.ok) throw new Error(`Reset failed (${res.status})`);
      setDone(true);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    }
  }

  /* Gated rather than hardcoded, so the control comes back by itself on the
     day the column exists. */
  if (!stored) {
    return (
      <div className="flex items-center gap-2">
        <span id={reasonId} className="font-sans text-[10px] text-text-muted">
          Nothing is stored, so there is nothing to clear.
        </span>
        <button
          type="button"
          disabled
          aria-describedby={reasonId}
          className="font-sans text-[11px] font-semibold text-text-muted opacity-50 cursor-default"
        >
          Reset learned
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="font-sans text-[10px] text-signal-dn">{error}</span>}
      {done && <span className="font-sans text-[10px] text-signal-up">Cleared.</span>}
      <button
        type="button"
        onClick={handleReset}
        disabled={pending}
        className="font-sans text-[11px] font-semibold text-text-muted hover:text-signal-dn transition-colors cursor-pointer disabled:opacity-50"
      >
        Reset learned
      </button>
    </div>
  );
}

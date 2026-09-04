"use client";

import { useCallback, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { WatchlistAddInput, type AddType } from "@/components/watchlist/WatchlistAddInput";
import { FONT_SANS } from "@/components/mobile/fonts";
import styles from "./watch-add.module.css";

/**
 * The first way to put an arbitrary name on the watchlist from a phone.
 *
 * WHY IT IS IN THE SAME UNIT AS THE REDIRECTS. `/watch` and `/watch/watchlist`
 * have never had an add control, and both empty states answered that by linking
 * to the desk that does. The moment `/radar/watchlist` redirects to
 * `/watch/watchlist`, that link is a circle: the reader taps "Open the watchlist
 * desk", the desk route sends them straight back, and they land on the empty
 * state they tapped out of, having spent two navigations to arrive nowhere.
 * The redirect is not safe to ship until something else is the answer, so this
 * ships with it or neither does.
 *
 * IT IS ALSO THE ONLY ONE. Every other write a phone reader can reach is a
 * toggle on an object already drawn on their screen. Nothing else on a phone
 * takes a name the reader has thought of and is not already looking at, which
 * is what a watchlist is for.
 *
 * NO PROPOSE-ONLY FILE IS EDITED, AND NONE NEEDED TO BE.
 * `WatchlistAddInput` performs no write at all. It is a controlled
 * search-and-confirm widget whose entire output is `await onAdd(identifier,
 * displayName?)`, and every one of its six props is supplied by the parent. So
 * it is imported here by reference, unmodified, and this file supplies the six.
 * `src/lib/watchlist-utils.ts` is reached only through the widget and is not
 * imported here. The precedent for a wrapper writing to `/api/watchlist`
 * directly is `src/components/company/states/EmptyStateCTA.tsx`, whose own
 * header records the same constraint.
 *
 * THE ONE HAZARD IN THAT REUSE, AND IT IS NOT OBVIOUS. The widget wraps its
 * `await onAdd(...)` in `setSubmitting(true)` and `setSubmitting(false)` with
 * NO try/finally. If `onAdd` rejects, the second call never runs and the widget
 * is left permanently disabled with no error drawn, which reads as a dead
 * button. `submit` below therefore catches everything and resolves; a failure
 * becomes `addError` and never a rejection. That is the reason for the shape of
 * the try block, not defensive habit.
 *
 * WHAT IS DELIBERATELY LEFT ALONE. The suggestion sheet is
 * `absolute z-50 left-0 right-10`, and that 40px right inset was sized to clear
 * the desk's ADD button, which is wider than 40px at every width. The sheet
 * therefore runs under the button instead of stopping beside it. It is a real
 * defect, it is cosmetic, it lives in the propose-only file, and it is written
 * up as a proposed diff in the PR body rather than fixed here.
 */

/** What the API is told, per add type. The widget's `AddType` is the API's `type`. */
const TYPE_LABEL: Readonly<Record<AddType, string>> = {
  ticker: "ticker",
  company: "company",
  sector: "industry",
};

export function WatchAdd({
  trackedIdentifiers,
  defaultOpen = false,
}: {
  /**
   * What is already tracked, so the widget can grey a suggestion the reader
   * cannot add again.
   *
   * BEST AVAILABLE RATHER THAN COMPLETE, and the difference is covered. The
   * screen's data carries the entries that produced articles, the quiet ones
   * and the ones whose article read faulted, which is every watchlist row this
   * surface knows about; it is not a second read of the table. A row this list
   * misses is not greyed, the reader can tap it, and the API answers with its
   * own duplicate sentence, which is drawn. So the duplicate case has a real
   * answer on both paths and neither one invents a state.
   */
  trackedIdentifiers: string[];
  /**
   * Open on mount. True on an empty tier, where adding is the only useful
   * thing on the screen and a closed disclosure would be one more tap between
   * the reader and the only action available to them.
   */
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const panelId = useId();

  const [open, setOpen] = useState(defaultOpen);
  const [addType, setAddType] = useState<AddType>("ticker");
  const [addError, setAddError] = useState("");
  const [busy, setBusy] = useState(false);

  const clearError = useCallback(() => setAddError(""), []);

  const submit = useCallback(
    async (identifier: string, displayName?: string) => {
      const value = identifier.trim();

      /* The widget calls `onAdd("")` in ticker mode when nothing was picked
         from the sheet, expressly so the parent can say why. It is not a
         request and it is not sent. */
      if (!value) {
        setAddError(`Pick a ${TYPE_LABEL[addType]} from the list, then add it.`);
        return;
      }

      setAddError("");
      setBusy(true);
      try {
        const res = await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            identifier: value,
            type: addType,
            ...(displayName ? { display_name: displayName } : {}),
          }),
        });

        let payload: { error?: string } = {};
        try {
          payload = (await res.json()) as { error?: string };
        } catch {
          payload = {};
        }

        if (!res.ok) {
          /* THE DUPLICATE CASE ARRIVES HERE, as a 400 carrying the API's own
             sentence naming the entry. It is drawn verbatim rather than
             replaced, because the API knows which identifier collided and this
             component does not. Every other failure gets a sentence that says
             what did NOT happen, so a reader is never left guessing whether a
             half-write landed. */
          setAddError(
            res.status === 401
              ? "Your session has ended. Sign in again to change your watchlist."
              : (payload.error ??
                "That could not be added. Nothing on your watchlist changed."),
          );
          return;
        }

        /* Other surfaces listen for this; the desk dispatches the same event
           after its own add. */
        window.dispatchEvent(new Event("watchlist:changed"));

        /* RE-READ RATHER THAN PATCH A LIST IN THE BROWSER. The tiers are built
           by a server component from `loadWatch`, so refreshing the route is
           what makes the new entry appear WITH the article read behind it. A
           locally appended row would be a name with no read, which is the one
           thing this screen is careful never to draw. */
        router.refresh();
      } catch {
        /* Never rethrown. See the header: a rejection here would strand the
           widget's own submitting flag. */
        setAddError("That did not reach the server. Nothing on your watchlist changed.");
      } finally {
        setBusy(false);
      }
    },
    [addType, router],
  );

  if (!open) {
    return (
      <div style={{ marginTop: "12px" }}>
        <button
          type="button"
          className={styles.toggle}
          style={{ fontFamily: FONT_SANS }}
          aria-expanded={false}
          aria-controls={panelId}
          onClick={() => setOpen(true)}
        >
          Add a name, company or industry
        </button>
      </div>
    );
  }

  return (
    <div id={panelId} className={styles.host} style={{ marginTop: "12px" }}>
      <WatchlistAddInput
        addType={addType}
        onAddTypeChange={setAddType}
        onAdd={submit}
        addError={addError}
        onClearError={clearError}
        trackedIdentifiers={trackedIdentifiers}
      />

      {/* The in-flight state. The widget disables its own control while the
          promise is pending; this is the part a reader can see. */}
      <p className={styles.status} style={{ fontFamily: FONT_SANS }} aria-live="polite">
        {busy ? "Adding to your watchlist..." : ""}
      </p>
    </div>
  );
}

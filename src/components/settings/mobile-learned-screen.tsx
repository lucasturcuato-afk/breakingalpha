"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BackHeader, Screen, ScreenBody } from "@/components/mobile";
import styles from "@/components/mobile/mobile.module.css";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";

/**
 * What Signalera has learned.
 *
 * github.md carried no row for this screen at all until the correction, and
 * the row it now carries is marked NOT YET READ IN FULL, so the source was
 * read rather than assumed. The section this screen promotes to a route lives
 * inside `settings/preferences/page.tsx` (lines 61 to 110) and is reproduced
 * here: the same eyebrow, heading, explainer, bar scale and footer. The bar
 * geometry is that file's own formula, not a redrawing of it.
 *
 * `ResetLearnedPrefsButton.tsx` draws the line this screen has to respect:
 * "Clear all learned sector weights? Your explicit preferences will stay."
 * Learned weights and declared preferences are separate things. The desktop
 * control states that inside a `confirm()` dialog; mobile has no dialog
 * pattern, so the same sentence is spoken by the control itself on the way to
 * a second tap.
 */

const SCALE_MIN = 0.3;
const SCALE_MAX = 2.5;

export interface LearnedWeight {
  sector: string;
  weight: number;
}

export function MobileLearnedScreen({
  weights,
  eventCount,
  updatedAt,
  refreshFailed,
  stored,
}: {
  /** Already sorted by the route, heaviest first. */
  weights: LearnedWeight[];
  eventCount: number;
  /**
   * Already formatted by the route, or null when nothing has been stored yet.
   * Null renders NOTHING. It used to arrive as the literal string
   * "not yet computed", which the route produced from a snapshot read before
   * the refresh wrote to it, so the screen said the weights had never been
   * computed in the same sentence as the count it had just computed.
   */
  updatedAt: string | null;
  /**
   * The route's weight refresh threw and it fell back to the stored values.
   * The source swallows this and reports zero events, which is
   * indistinguishable from a genuine zero. Said out loud instead.
   */
  refreshFailed: boolean;
  /**
   * Whether the weights were PERSISTED, straight from `updateInferredWeights`.
   *
   * False in production on every render today: `user_profiles`
   * `inferred_sector_weights` and `inferred_weights_updated_at` do not exist,
   * verified read-only against the production REST API, both answering HTTP
   * 400 with Postgres `42703`. The numbers are still a real derivation of real
   * `user_events` rows, so they are shown, but nothing stored them and nothing
   * ranked by them. The screen has to say which it is.
   */
  stored: boolean;
}) {
  return (
    <Screen parity="learned">
      <BackHeader href="/settings/profile" label="Settings" />
      <ScreenBody padTop="18px">
        <p style={{ margin: 0, font: `600 11px/1 ${FONT_SANS}`, color: "var(--c-muted)" }}>Settings</p>
        <h1
          style={{
            margin: "8px 0 0",
            font: `800 25px/1.16 ${FONT_DISPLAY}`,
            letterSpacing: "-0.02em",
            color: "var(--c-ink)",
          }}
        >
          Your preferences
        </h1>
        <p
          style={{
            margin: "9px 0 0",
            font: `400 13px/1.6 ${FONT_SANS}`,
            color: "var(--c-secondary)",
            textWrap: "pretty",
          }}
        >
          Manage every dimension of how Signalera personalizes your intelligence feed. Changes take
          effect immediately.
        </p>

        <section style={{ ...CARD, marginTop: "20px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
            <h2 style={{ margin: 0, font: `700 16px/1.3 ${FONT_DISPLAY}`, color: "var(--c-ink)" }}>
              What Signalera has learned
            </h2>
            <ResetLearned />
          </div>

          <p
            style={{
              margin: "10px 0 0",
              font: `400 12px/1.6 ${FONT_SANS}`,
              color: "var(--c-secondary)",
              textWrap: "pretty",
            }}
          >
            {/* "Higher = boosted in ranking" is the prototype's own clause and it
                is only true if something read these numbers. Nothing does when
                `stored` is false, so the clause is gated rather than printed as
                a fact. Same rule that took "Published 6:45" off Alerts. */}
            These are inferred from your activity and blend with your declared preferences. 1.0 =
            neutral.{stored ? " Higher = boosted in ranking." : ""} {eventCount} events considered
            {updatedAt === null ? "." : <> &middot; last updated {updatedAt}.</>}
          </p>

          {stored ? null : (
            <p
              role="status"
              style={{
                margin: "10px 0 0",
                font: `400 11.5px/1.5 ${FONT_SANS}`,
                color: "var(--c-amberink)",
                textWrap: "pretty",
              }}
            >
              These numbers were worked out from your recorded activity when this page loaded, and
              they were not saved. Signalera has nowhere to keep them yet, so nothing reads them and
              nothing is ordered by them. They describe what your activity adds up to, not what the
              product is doing with it.
            </p>
          )}

          {refreshFailed ? (
            <p
              role="status"
              style={{
                margin: "10px 0 0",
                font: `400 11.5px/1.5 ${FONT_SANS}`,
                color: "var(--c-amberink)",
                textWrap: "pretty",
              }}
            >
              These weights could not be refreshed just now, so they are the last stored values and the
              event count above is not current. Nothing was changed.
            </p>
          ) : null}

          {weights.length === 0 ? (
            <p
              style={{
                margin: "14px 0 0",
                font: `400 12px/1.6 ${FONT_SANS}`,
                color: "var(--c-muted)",
                textWrap: "pretty",
              }}
            >
              Not enough data yet. Interact with a few theses and come back.
            </p>
          ) : (
            <ul style={{ margin: "14px 0 0", padding: 0 }}>
              {weights.map((w) => (
                <WeightRow key={w.sector} sector={w.sector} weight={w.weight} />
              ))}
            </ul>
          )}
        </section>

        <BehavioralInsights />

        <p
          style={{
            margin: "16px 0 0",
            font: `400 11px/1.5 ${FONT_SANS}`,
            color: "var(--c-muted)",
            textAlign: "center",
            textWrap: "pretty",
          }}
        >
          Learned preferences update automatically after each reading session.
        </p>
      </ScreenBody>
    </Screen>
  );
}

const CARD = {
  padding: "17px 16px",
  border: "1px solid var(--c-border)",
  borderRadius: "14px",
  backgroundColor: "var(--c-surface)",
} as const;

/**
 * One weight. Width and colour are the source's own rule, reproduced rather
 * than approximated: the bar spans the 0.3 to 2.5 scale, and the fill is gold
 * above 1.05, red below 0.95, muted between. The number is beside the bar in
 * every case, so no state is carried by colour alone.
 */
function WeightRow({ sector, weight }: { sector: string; weight: number }) {
  const span = Math.min(100, Math.max(0, ((weight - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100));
  const boosted = weight > 1.05;
  const suppressed = weight < 0.95;
  const fill = boosted ? "var(--c-gold)" : suppressed ? "var(--c-red)" : "var(--c-muted)";

  return (
    <li style={{ display: "flex", alignItems: "center", gap: "11px", padding: "7px 0", listStyle: "none" }}>
      <span
        style={{
          flex: "none",
          width: "112px",
          font: `400 12px/1.35 ${FONT_SANS}`,
          color: "var(--c-ink)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {sector}
      </span>
      <span
        aria-hidden="true"
        style={{
          flex: 1,
          minWidth: 0,
          height: "8px",
          borderRadius: "4px",
          backgroundColor: "var(--c-hair)",
          overflow: "hidden",
          display: "block",
        }}
      >
        <span
          className={styles.barSweep}
          style={{
            display: "block",
            width: `${span}%`,
            height: "8px",
            borderRadius: "4px",
            backgroundColor: fill,
          }}
        />
      </span>
      <span
        style={{
          flex: "none",
          width: "34px",
          textAlign: "right",
          font: `400 11px/1 ${FONT_MONO}`,
          color: "var(--c-muted)",
        }}
      >
        {weight.toFixed(2)}
      </span>
    </li>
  );
}

/**
 * The reset control. A bordered pill rather than the desktop's bare text
 * button, and a second tap rather than a dialog. The sentence the dialog
 * carried is not dropped: it is what the control says while it waits.
 *
 * The visual is 38px tall, so `content-box` padding plus a compensating
 * negative margin takes the hit box to 44 without moving it. The prototype
 * uses 2px there and lands on 42.
 */
function ResetLearned() {
  const router = useRouter();
  const [stage, setStage] = useState<"idle" | "arming" | "working" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function arm() {
    setStage("arming");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStage("idle"), 4000);
  }

  async function commit() {
    if (timer.current) clearTimeout(timer.current);
    setStage("working");
    try {
      const res = await fetch("/api/user-profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inferred_sector_weights: {} }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStage("done");
      router.refresh();
      timer.current = setTimeout(() => setStage("idle"), 2000);
    } catch {
      setStage("failed");
      timer.current = setTimeout(() => setStage("idle"), 4000);
    }
  }

  const label =
    stage === "arming"
      ? "Confirm"
      : stage === "working"
        ? "Clearing"
        : stage === "done"
          ? "Reset"
          : stage === "failed"
            ? "Not cleared"
            : "Reset learned";

  return (
    <div style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
      <button
        type="button"
        onClick={stage === "arming" ? commit : arm}
        disabled={stage === "working"}
        className={styles.bare}
        style={{
          boxSizing: "content-box",
          flex: "none",
          minHeight: "38px",
          padding: "3px 11px",
          margin: "-3px 0",
          display: "inline-flex",
          alignItems: "center",
          border: `1px solid ${stage === "arming" ? "var(--c-gold)" : "var(--c-border)"}`,
          borderRadius: "9px",
          backgroundColor: stage === "arming" ? "var(--c-well)" : "var(--c-card)",
          font: `500 11px/1 ${FONT_SANS}`,
          color: stage === "arming" ? "var(--c-goldink)" : "var(--c-muted)",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </button>
      {stage === "arming" || stage === "failed" ? (
        <span
          role="status"
          style={{
            maxWidth: "150px",
            font: `400 10px/1.4 ${FONT_SANS}`,
            color: stage === "failed" ? "var(--c-redink)" : "var(--c-muted)",
            textAlign: "right",
            textWrap: "pretty",
          }}
        >
          {stage === "failed"
            ? "Nothing was cleared. Try again."
            : "Clears the learned sector weights. Your declared preferences stay."}
        </span>
      ) : null}
    </div>
  );
}

/* ── Behavioral insights ── */

interface InsightsResponse {
  event_count_30d: number;
  top_boosted: { sector: string; weight: number }[];
  top_muted: { sector: string; weight: number }[];
  narrative: string;
}

/**
 * The prototype heads this section with the component's NAME, "Behavioral
 * insights", and fills it with three hand-authored bullets that have no
 * counterpart in the API response. One of them states a frequency as "four
 * mornings in five", which is an aggregate rate in words, and another uses the
 * verb github.md corrected everywhere in favour of Track.
 *
 * So the anatomy the design draws is kept, three gold-dot bullets, and the
 * content comes from `/api/profile/insights`, which is what the section is
 * for. The heading is the source component's own, "How Signalera is learning
 * about you", not its filename.
 */
function BehavioralInsights() {
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/profile/insights", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as InsightsResponse;
        if (!cancelled) { setData(json); setState("ready"); }
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const bullets: string[] = [];
  if (data) {
    if (data.narrative) bullets.push(data.narrative);
    /* TWO SENTENCES REMOVED HERE, and they were this batch's own invention.
     *
     *   "Leaning in on X, which now rank ahead of the rest of your feed."
     *   "Cooling on X, which are ranked lower than your declared sectors
     *    alone would put them."
     *
     * Neither is in `Signalera Mobile v3.dc.html` and neither is on main;
     * `git log -S` puts both in this batch's first commit. Both assert that
     * the reader's feed is being reordered. It is not: the column those
     * weights would live in does not exist, every consumer reads it
     * defensively (`deal-utils.ts:20`, `theses/route.ts:97`) and therefore
     * always sees an empty object, so the weights reorder nothing anywhere.
     *
     * The API narrative bullet above already names the sectors without
     * claiming an effect, so removing these also clears the duplicate pair
     * that read as a stutter. */
  }

  return (
    <section style={{ ...CARD, marginTop: "14px" }}>
      <h2 style={{ margin: 0, font: `700 16px/1.3 ${FONT_DISPLAY}`, color: "var(--c-ink)" }}>
        How Signalera is learning about you
      </h2>

      {state === "loading" ? (
        <div style={{ marginTop: "13px", display: "flex", flexDirection: "column", gap: "11px" }} aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className={styles.sk} style={{ height: "20px" }} />
          ))}
        </div>
      ) : null}

      {state === "error" ? (
        <p style={{ ...BODY, margin: "13px 0 0" }} role="status">
          These insights could not be loaded right now. The weights above are unaffected.
        </p>
      ) : null}

      {state === "ready" && bullets.length === 0 ? (
        <p style={{ ...BODY, margin: "13px 0 0" }}>
          Nothing to report yet. This fills in once there are a few reading sessions to read from.
        </p>
      ) : null}

      {state === "ready" && bullets.length > 0 ? (
        <div style={{ marginTop: "13px", display: "flex", flexDirection: "column", gap: "11px" }}>
          {bullets.map((line) => (
            <div key={line} style={{ display: "flex", gap: "11px" }}>
              <span
                aria-hidden="true"
                style={{
                  flex: "none",
                  marginTop: "5px",
                  display: "inline-block",
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  backgroundColor: "var(--c-gold)",
                }}
              />
              <p style={{ ...BODY, margin: 0 }}>{line}</p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

const BODY = {
  font: `400 12.5px/1.55 ${FONT_SANS}`,
  color: "var(--c-body)",
  textWrap: "pretty",
} as const;

"use client";

import type { CSSProperties, ReactNode } from "react";
import { EyebrowRule } from "@/components/mobile/screen-chrome";
import { TabBarClearance } from "@/components/mobile/tab-bar-clearance";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";
import styles from "@/components/mobile/mobile.module.css";
import {
  CLUSTER_STALE_AFTER_DAYS,
  SOURCE_STALE_AFTER_DAYS,
  confidenceInk,
  formatLag,
  isBehind,
  newestIso,
  outcomeSplit,
  panelStage,
  roleWord,
  shortDate,
  type ClusterStanding,
  type PanelFault,
  type SourceStanding,
} from "./cross-source-model";

/**
 * Cross-source observation, on a phone.
 *
 * THE SHAPE, AND WHY IT IS NOT A SCROLLING TABLE. The desk draws a six-column
 * table at `min-w-[640px]` inside its own `overflow-x:auto`. Measured on
 * `cfe0a5ee` signed in on a production build: the container is 288px at 320
 * and 358px at 390, so 352px and 282px of that table are behind a sideways
 * swipe, and at 320 the page BODY gained 54px of sideways scroll of its own
 * from the cluster rows underneath. A scroller would have kept the first of
 * those and fixed only the second. It would also have kept two columns this
 * surface must not draw at all, so the row is restructured instead: one card
 * per source, one card per cluster, nothing hidden, and no horizontal scroll
 * anywhere on the screen.
 *
 * WHAT A PHONE READER GETS FROM A RELIABILITY ROW, and what is dropped:
 *
 *   identity        KEPT. The row is unreadable without it.
 *   syndicator      KEPT, as a chip. It changes what the row means.
 *   clean outcomes  KEPT, and first. The route's own header calls this the
 *                   sample count front and centre.
 *   the split       KEPT, as supported / challenged.
 *   confidence      KEPT, as a word. It says how much is behind the row.
 *   the two derived
 *   figures         DROPPED. Both are one arithmetic step from the two counts
 *                   already drawn, and a screen about cross-source
 *                   verification is exactly where a derived figure most wants
 *                   to appear. The desk keeps both columns; nothing is
 *                   removed from it.
 *
 * THERE IS NO BACK CONTROL, and that is a decision rather than an omission.
 * No pole in `mobile-tab-bar.tsx` owns this route, this unit adds no `owns`
 * string and no inbound link anywhere, so there is no parent for a control to
 * name. A header reading "Ledger" or "Dashboard" would assert a parentage the
 * pole table does not agree with. The four poles are the way out, and they
 * are measured to draw and to navigate from this route.
 *
 * THERE IS NO SCROLLER INSIDE THIS SCREEN. `#main-content` is the scroll
 * container; a second one nested in it would put the tab-bar clearance below a
 * viewport-height box where it reserves nothing. The root grows, the shell
 * scrolls, and `TabBarClearance` is the last child of the root.
 */

const PAD = "var(--v3-pad)";

export interface CrossSourceScreenProps {
  sources: SourceStanding[] | null;
  sourceFault: PanelFault | null;
  clusters: ClusterStanding[] | null;
  clusterFault: PanelFault | null;
  loading: boolean;
  onRefresh: () => void;
  /** Injected so the stale rule is testable and the render is deterministic. */
  now?: Date;
}

export function CrossSourceScreen({
  sources,
  sourceFault,
  clusters,
  clusterFault,
  loading,
  onRefresh,
  now,
}: CrossSourceScreenProps) {
  const at = now ?? new Date();
  const sourceStage = panelStage(sourceFault, sources, loading);
  const clusterStage = panelStage(clusterFault, clusters, loading);

  const sourceNewest = newestIso((sources ?? []).map((s) => s.last_outcome_at));
  const clusterNewest = newestIso((clusters ?? []).map((c) => c.window_start));
  const sourceBehind =
    sourceStage === "ready" && isBehind(sourceNewest, at, SOURCE_STALE_AFTER_DAYS);
  const clusterBehind =
    clusterStage === "ready" && isBehind(clusterNewest, at, CLUSTER_STALE_AFTER_DAYS);

  return (
    <div
      data-parity="cross-source"
      data-testid="cross-source-screen"
      className={styles.enter}
      style={{
        backgroundColor: "var(--c-bg)",
        /* Stated rather than left at 100%, which resolves against a parent
           with no height and lets the shell's ground show under a short
           state. */
        minHeight: "calc(100dvh - var(--mobile-tabbar-height) - env(safe-area-inset-bottom))",
        padding: 0,
      }}
    >
      <div style={{ padding: `18px ${PAD} 0` }}>
        <div
          style={{
            font: `400 10px/1 ${FONT_MONO}`,
            letterSpacing: "0.16em",
            color: "var(--c-goldink)",
          }}
        >
          STAGE 1
        </div>
        <h1
          style={{
            margin: "10px 0 0",
            font: `700 24px/1.14 ${FONT_DISPLAY}`,
            letterSpacing: "-0.02em",
            color: "var(--c-ink)",
          }}
        >
          Cross-source observation
        </h1>
        <p
          style={{
            margin: "8px 0 0",
            font: `400 12.5px/1.55 ${FONT_SANS}`,
            color: "var(--c-body)",
            textWrap: "pretty",
          }}
        >
          Observation only. Nothing here is a verdict on a source. Figure differences are
          flagged for a person to look at, and two figures in one cluster may simply be
          different quantities. Outcomes resolve later against catalysts. None of this is
          wired into generation.
        </p>
        <button
          type="button"
          onClick={onRefresh}
          className={styles.bare}
          style={{
            marginTop: "14px",
            /* content-box so the 1px border sits OUTSIDE the 44px the finger
               is promised, rather than eating 2px of it. */
            boxSizing: "content-box",
            minHeight: "44px",
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "0 16px",
            border: "1px solid var(--c-border)",
            borderRadius: "9px",
            backgroundColor: "var(--c-surface)",
            font: `500 13px/1 ${FONT_SANS}`,
            color: "var(--c-ink)",
          }}
        >
          <svg
            aria-hidden="true"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
          {loading ? "Reading" : "Refresh"}
        </button>
      </div>

      <div style={{ padding: `4px ${PAD} 24px` }}>
        <EyebrowRule marginTop="26px">SOURCE RELIABILITY</EyebrowRule>
        <Quiet>
          Derived from the price-attribution grader: an outcome counts only when the named
          entity moved beyond both its sector ETF and SPY in the predicted direction.
          Attribution is brief-level fan-out. This screen draws counts and no figure derived
          over them, at any sample size.
        </Quiet>

        {sourceBehind ? (
          <Behind>
            The newest clean outcome is dated {shortDate(sourceNewest)}. Everything below is
            that read, not today&rsquo;s.
          </Behind>
        ) : null}

        {sourceStage === "loading" ? <PanelSkeleton /> : null}
        {sourceStage === "error" ? (
          <Fault fault={sourceFault} label="source-reliability" />
        ) : null}
        {sourceStage === "empty" ? (
          <Panel testid="cross-source-mobile-sources-empty">
            <PanelHead>No rows yet.</PanelHead>
            <PanelBody>
              The table is present and reachable and carries nothing. It fills once{" "}
              <code style={code}>backend/source_reliability.py</code> has run.
            </PanelBody>
          </Panel>
        ) : null}
        {sourceStage === "ready" ? (
          <ul style={list} data-testid="cross-source-mobile-sources">
            {(sources ?? []).map((s) => (
              <SourceCard key={s.identity} row={s} />
            ))}
          </ul>
        ) : null}

        <EyebrowRule marginTop="30px">SAME-EVENT CLUSTERS</EyebrowRule>
        <Quiet>
          <strong style={{ fontWeight: 600, color: "var(--c-body)" }}>
            Lead means first seen in our feeds
          </strong>
          , not first to the story. We poll on a schedule, Google News adds its own indexing
          lag, and some publishers timestamp only to the minute. When two items share the
          earliest timestamp no lead is named.
        </Quiet>

        {clusterBehind ? (
          <Behind>
            The newest cluster window opened {shortDate(clusterNewest)}. Everything below is
            that pass, not today&rsquo;s.
          </Behind>
        ) : null}

        {clusterStage === "loading" ? <PanelSkeleton /> : null}
        {clusterStage === "error" ? <Fault fault={clusterFault} label="cross-source" /> : null}
        {clusterStage === "empty" ? (
          <Panel testid="cross-source-mobile-clusters-empty">
            <PanelHead>No clusters yet.</PanelHead>
            <PanelBody>
              The table is present and reachable and carries nothing. It fills once{" "}
              <code style={code}>backend/cross_source.py</code> has run.
            </PanelBody>
          </Panel>
        ) : null}
        {clusterStage === "ready" ? (
          <ul style={list} data-testid="cross-source-mobile-clusters">
            {(clusters ?? []).map((c) => (
              <ClusterCard key={c.cluster_key} cluster={c} />
            ))}
          </ul>
        ) : null}
      </div>

      {/* The tab bar's height, reserved a second time. The shell's own
          `pb-[calc(...)]` on `#main-content` is dropped by Chrome the moment
          this content overflows it. One owner, one declaration. */}
      <TabBarClearance />
    </div>
  );
}

/* ── rows ───────────────────────────────────────────────────────────── */

/**
 * One source. Three lines rather than six columns: who, the counts, and how
 * much is behind them. Nothing is clipped and nothing scrolls sideways.
 */
function SourceCard({ row }: { row: SourceStanding }) {
  const split = outcomeSplit(row);
  return (
    <li style={card}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "10px",
        }}
      >
        <span
          style={{
            minWidth: 0,
            font: `500 13.5px/1.35 ${FONT_SANS}`,
            color: "var(--c-ink)",
            overflowWrap: "anywhere",
          }}
        >
          {row.identity}
        </span>
        <span
          style={{
            flex: "none",
            font: `600 10.5px/1.3 ${FONT_SANS}`,
            color: confidenceInk(row.confidence),
          }}
        >
          {row.confidence}
        </span>
      </div>

      {row.is_syndicator ? (
        <div style={{ marginTop: "8px" }}>
          <span
            style={chip}
            title="Redistributes other outlets' reporting. Not a judgement of quality."
          >
            SYNDICATOR
          </span>
        </div>
      ) : null}

      <div
        style={{
          marginTop: "11px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "1px",
          /* The 1px gap IS the rule between the cells, painted by the ground
             showing through. Nothing here draws a border of its own. */
          backgroundColor: "var(--c-border)",
          border: "1px solid var(--c-border)",
          borderRadius: "6px",
          overflow: "hidden",
        }}
      >
        <Figure label="CLEAN" value={row.n_clean_outcomes} />
        <Figure label="SUPPORTED" value={split.supported} />
        <Figure label="CHALLENGED" value={split.challenged} />
      </div>
    </li>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ backgroundColor: "var(--c-surface)", padding: "9px 10px" }}>
      <div
        style={{
          font: `400 10px/1 ${FONT_MONO}`,
          letterSpacing: "0.05em",
          color: "var(--c-muted)",
        }}
      >
        {label}
      </div>
      <div style={{ marginTop: "6px", font: `600 15px/1 ${FONT_MONO}`, color: "var(--c-ink)" }}>
        {value}
      </div>
    </div>
  );
}

/**
 * One cluster. The desk puts a member's pill, lag, outlet and headline on ONE
 * line, which is the second source of sideways scroll: measured at 320 those
 * rows ran 341px of content through a 254px box. Here each member is a stack,
 * so the headline wraps into the column instead of running out of it.
 */
function ClusterCard({ cluster }: { cluster: ClusterStanding }) {
  return (
    <li style={card}>
      <div
        style={{
          font: `400 10px/1.4 ${FONT_MONO}`,
          letterSpacing: "0.05em",
          color: "var(--c-muted)",
          overflowWrap: "anywhere",
        }}
      >
        {cluster.base_key}
      </div>
      <div
        style={{
          marginTop: "5px",
          font: `400 10px/1.4 ${FONT_MONO}`,
          letterSpacing: "0.05em",
          color: "var(--c-muted)",
        }}
      >
        {cluster.distinct_identities} outlets · {cluster.distinct_non_syndicators}{" "}
        non-syndicator · {cluster.article_count} items
      </div>

      <ol
        style={{
          margin: "12px 0 0",
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {cluster.members.map((m) => (
          <li key={m.article_id} style={{ minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span style={{ ...chip, color: roleInk(m.role), borderColor: "var(--c-edge)" }}>
                {roleWord(m.role)}
              </span>
              <span
                style={{
                  font: `400 10.5px/1.3 ${FONT_MONO}`,
                  letterSpacing: "0.04em",
                  color: "var(--c-muted)",
                }}
              >
                {formatLag(m.lag_minutes)}
              </span>
              {m.is_syndicator ? <span style={chip}>SYNDICATOR</span> : null}
              {m.timestamp_basis !== "published_at" ? (
                <span
                  style={{ ...chip, color: "var(--c-amberink)" }}
                  title="No publish timestamp; ordered on ingest time instead."
                >
                  INGEST TIME
                </span>
              ) : null}
            </div>
            {/* OUTLET AND HEADLINE ARE ONE PARAGRAPH, not two blocks. Drawn
                as two, twenty-five clusters ran 18209px of scroll at 390
                against the desk layout's 14154; the outlet is three words and
                does not earn a line of its own. It keeps its own weight and
                ink so the eye still separates the two, and the whole thing
                wraps into the column instead of running out of it. */}
            <p
              style={{
                margin: "7px 0 0",
                font: `400 12px/1.5 ${FONT_SANS}`,
                color: "var(--c-secondary)",
                textWrap: "pretty",
                overflowWrap: "anywhere",
              }}
            >
              <span style={{ fontWeight: 600, color: "var(--c-ink)" }}>{m.identity}</span>
              {m.title ? ` ${m.title}` : ""}
            </p>
          </li>
        ))}
      </ol>

      {cluster.figure_findings.length > 0 ? (
        <div
          style={{
            marginTop: "13px",
            paddingTop: "12px",
            borderTop: "1px solid var(--c-hair)",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          {cluster.figure_findings.map((f, i) => (
            <div key={`${f.kind}-${i}`}>
              <span style={{ ...chip, color: "var(--c-amberink)" }}>{f.kind}</span>
              <p
                style={{
                  margin: "6px 0 0",
                  font: `400 12px/1.5 ${FONT_SANS}`,
                  color: "var(--c-body)",
                  textWrap: "pretty",
                }}
              >
                {f.detail}
              </p>
              {f.members.map((m) => (
                <p
                  key={m.id}
                  style={{
                    margin: "4px 0 0",
                    font: `400 10.5px/1.5 ${FONT_MONO}`,
                    color: "var(--c-muted)",
                    overflowWrap: "anywhere",
                  }}
                >
                  {m.label}: {m.figures.map((x) => x.raw).join(", ")}
                </p>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </li>
  );
}

/**
 * The lead marker is INK ONLY. A filled pill on the lead would read as a prize
 * for getting there first, and "lead" here means first seen in our feeds.
 */
function roleInk(role: string): string {
  if (role === "lead") return "var(--c-greenink)";
  if (role === "lead_tied") return "var(--c-amberink)";
  return "var(--c-muted)";
}

/* ── states ─────────────────────────────────────────────────────────── */

function Quiet({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: "11px 0 0",
        font: `400 11.5px/1.6 ${FONT_SANS}`,
        color: "var(--c-muted)",
        textWrap: "pretty",
      }}
    >
      {children}
    </p>
  );
}

function Panel({ children, testid }: { children: ReactNode; testid?: string }) {
  return (
    <div style={{ ...panel, marginTop: "12px" }} data-testid={testid}>
      {children}
    </div>
  );
}

function PanelHead({ children }: { children: ReactNode }) {
  return (
    <p style={{ margin: 0, font: `500 15px/1.35 ${FONT_DISPLAY}`, color: "var(--c-ink)" }}>
      {children}
    </p>
  );
}

function PanelBody({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: "8px 0 0",
        font: `400 12.5px/1.55 ${FONT_SANS}`,
        color: "var(--c-secondary)",
        textWrap: "pretty",
      }}
    >
      {children}
    </p>
  );
}

/**
 * A FAILED READ IS NOT AN EMPTY ONE. This state exists so a query that threw
 * can never borrow the empty-table sentence beside it, which is the contract
 * `/api/source-reliability` states in its own header and refuses to break.
 */
function Fault({ fault, label }: { fault: PanelFault | null; label: string }) {
  return (
    <div
      role="alert"
      data-testid={`cross-source-mobile-${label}-error`}
      style={{
        ...panel,
        marginTop: "12px",
        borderColor: "var(--c-red-edge)",
        backgroundColor: "var(--c-red-well)",
      }}
    >
      <PanelHead>{fault?.error ?? "This read failed."}</PanelHead>
      {fault?.detail ? (
        <p
          style={{
            margin: "8px 0 0",
            font: `400 11px/1.5 ${FONT_MONO}`,
            color: "var(--c-redink)",
            overflowWrap: "anywhere",
          }}
        >
          {fault.code ? `[${fault.code}] ` : ""}
          {fault.detail}
        </p>
      ) : null}
      {fault?.hint ? <PanelBody>{fault.hint}</PanelBody> : null}
      <PanelBody>This is a failed read, not an empty one. Nothing is being hidden.</PanelBody>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div
      aria-hidden="true"
      style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "11px" }}
    >
      <div className={styles.sk} style={{ height: "104px", borderRadius: "12px" }} />
      <div className={styles.sk} style={{ height: "104px", borderRadius: "12px" }} />
      <div className={styles.sk} style={{ height: "104px", borderRadius: "12px" }} />
    </div>
  );
}

/**
 * Behind sits ABOVE the readings rather than replacing them. The rows under it
 * are still the last true ones, so hiding them would lose real information to
 * report a late job.
 */
function Behind({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        ...panel,
        marginTop: "12px",
        borderColor: "var(--c-amber-edge)",
        backgroundColor: "var(--c-amber-well)",
      }}
      data-testid="cross-source-mobile-behind"
    >
      <p style={{ margin: 0, font: `500 13px/1.4 ${FONT_SANS}`, color: "var(--c-ink)" }}>
        These readings are behind.
      </p>
      <p
        style={{
          margin: "6px 0 0",
          font: `400 12px/1.55 ${FONT_SANS}`,
          color: "var(--c-secondary)",
          textWrap: "pretty",
        }}
      >
        {children}
      </p>
    </div>
  );
}

/* ── shared style objects ───────────────────────────────────────────── */

const list: CSSProperties = {
  margin: "12px 0 0",
  padding: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: "11px",
};

const card: CSSProperties = {
  border: "1px solid var(--c-border)",
  borderRadius: "12px",
  backgroundColor: "var(--c-card)",
  padding: "14px 15px",
  minWidth: 0,
};

const panel: CSSProperties = {
  border: "1px solid var(--c-border)",
  borderRadius: "12px",
  backgroundColor: "var(--c-well)",
  padding: "16px 15px",
};

const chip: CSSProperties = {
  display: "inline-block",
  border: "1px solid var(--c-border)",
  borderRadius: "4px",
  padding: "2px 6px",
  font: `500 10px/1.3 ${FONT_MONO}`,
  letterSpacing: "0.06em",
  color: "var(--c-muted)",
};

const code: CSSProperties = {
  font: `400 11.5px/1.5 ${FONT_MONO}`,
  color: "var(--c-body)",
};

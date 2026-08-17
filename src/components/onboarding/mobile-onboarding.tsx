"use client";

import type { CSSProperties, ReactNode } from "react";
import type {
  InvestmentHorizon,
  StrategyType,
  UserRole,
  WorkflowStyle,
} from "@/lib/user-profile";
import styles from "@/components/mobile/mobile.module.css";
import {
  FONT_DISPLAY,
  FONT_MONO,
  FONT_SANS,
  TitleBlock,
  Wordmark,
} from "@/components/mobile/primitives";

/* ══════════════════════════════════════════════════════════════════════
   Onboarding, mobile. Prototype flag `isOnboard`.
   ══════════════════════════════════════════════════════════════════════
   Built at 390px from Signalera Mobile v3.dc.html lines 914 to 1084.
   Single column: the desktop's right-hand panel is `hidden md:flex` and
   is therefore already invisible at phone width, so nothing is lost by
   not folding it in. What the design DOES fold in, and what is built
   here, is the persona chip row and the step-5 window well.

   Step gating mirrors OnboardingWizard's own canProceed(), which is
   passed in rather than restated, so the two layouts cannot disagree
   about when a step is complete.

   Ruling 7a: no risk control on step 5, and the step is titled
   "Horizon and workflow."
   ══════════════════════════════════════════════════════════════════════ */

export interface MobileOnboardingProps {
  step: number;
  totalSteps: number;

  firstName: string;
  onFirstName: (v: string) => void;
  firmOrSchool: string;
  onFirmOrSchool: (v: string) => void;

  roles: { id: UserRole; label: string; description: string }[];
  role: UserRole | null;
  onRole: (r: UserRole) => void;

  strategies: { id: StrategyType; label: string; description: string }[];
  strategy: StrategyType | null;
  onStrategy: (s: StrategyType) => void;

  sectorOptions: string[];
  sectors: string[];
  onToggleSector: (s: string) => void;

  horizons: { id: InvestmentHorizon; label: string; description: string }[];
  horizon: InvestmentHorizon | null;
  onHorizon: (h: InvestmentHorizon) => void;

  workflows: { id: WorkflowStyle; label: string; description: string }[];
  workflow: WorkflowStyle | null;
  onWorkflow: (w: WorkflowStyle) => void;

  tickerInput: string;
  onTickerInput: (v: string) => void;
  onCommitTickers: () => void;
  tickers: string[];
  onRemoveTicker: (t: string) => void;

  preview: { title: string; sector: string; rationale: string } | null;
  previewLoading: boolean;
  previewError: string | null;
  onRetryPreview: () => void;

  saveError: string | null;
  ctaLabel: string;
  ctaDisabled: boolean;
  onNext: () => void;
  onBack: () => void;
  backDisabled: boolean;
}

/* Catalyst copy, keyed on the horizon enum. The design keys its own copy
 * short / medium / long, which is the same vocabulary the profile column
 * uses, so no mapping table is needed between the two. */
const WINDOW_CATCHES: Record<InvestmentHorizon, string> = {
  short: "Earnings, Fed meetings and CPI prints.",
  medium: "M&A announcements, guidance revisions and sector rotations.",
  long: "Structural trends, cycle turns and regulatory regimes.",
};

const WINDOW_UNSET = "Pick a horizon and this will say what that window catches.";

/* ── atoms ─────────────────────────────────────────────────────────── */

function MonoLabel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: 10,
        fontWeight: 400,
        lineHeight: 1,
        letterSpacing: "0.07em",
        color: "var(--c-muted)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The option card. One anatomy for role, strategy, horizon and workflow. */
function OptionCard({
  selected,
  label,
  description,
  onClick,
}: {
  selected: boolean;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={styles.reset}
      aria-pressed={selected}
      style={{
        display: "block",
        width: "100%",
        padding: "14px 15px",
        borderRadius: 12,
        border: `1px solid ${selected ? "var(--c-gold)" : "var(--c-border)"}`,
        backgroundColor: selected ? "var(--c-well)" : "var(--c-card)",
      }}
    >
      <div
        style={{
          fontFamily: FONT_SANS,
          fontSize: 13.5,
          fontWeight: 600,
          lineHeight: 1.3,
          color: "var(--c-ink)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 5,
          fontFamily: FONT_SANS,
          fontSize: 11.5,
          fontWeight: 400,
          lineHeight: 1.4,
          color: "var(--c-muted)",
        }}
      >
        {description}
      </div>
    </button>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
  mono,
  onCommit,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  mono?: boolean;
  onCommit?: () => void;
}) {
  const filled = value.trim().length > 0;
  return (
    <label style={{ display: "block" }}>
      <MonoLabel style={{ marginBottom: 7 }}>{label}</MonoLabel>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (onCommit && e.key === "Enter") {
            e.preventDefault();
            onCommit();
          }
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={styles.field}
        style={{
          width: "100%",
          minHeight: 50,
          padding: "0 15px",
          border: `1px solid ${filled ? "var(--c-gold)" : "var(--c-border)"}`,
          borderRadius: 9,
          outline: "none",
          backgroundColor: filled ? "var(--c-bg)" : "var(--c-surface)",
          fontFamily: mono ? FONT_MONO : FONT_SANS,
          fontSize: mono ? 14 : 15,
          fontWeight: 400,
          lineHeight: 1,
          letterSpacing: mono ? "0.02em" : undefined,
          color: "var(--c-ink)",
        }}
      />
    </label>
  );
}

function Stack({ children }: { children: ReactNode }) {
  return (
    <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 9 }}>
      {children}
    </div>
  );
}

/* ── screen ────────────────────────────────────────────────────────── */

export function MobileOnboarding(p: MobileOnboardingProps) {
  const showPersona = p.step >= 2 && p.step <= 6;

  const chip = (on: boolean): CSSProperties => ({
    flex: "none",
    minHeight: 26,
    display: "flex",
    alignItems: "center",
    padding: "0 10px",
    borderRadius: 4,
    whiteSpace: "nowrap",
    fontFamily: FONT_SANS,
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1,
    border: `1px solid ${on ? "var(--c-gold-edge)" : "var(--c-border)"}`,
    backgroundColor: on ? "var(--c-well)" : "transparent",
    color: on ? "var(--c-goldink)" : "var(--c-muted)",
  });

  const roleChip = p.roles.find((r) => r.id === p.role);
  const stratChip = p.strategies.find((s) => s.id === p.strategy);
  const horizonChip = p.horizons.find((h) => h.id === p.horizon);
  const workflowChip = p.workflows.find((w) => w.id === p.workflow);

  return (
    <div className="md:hidden" data-parity="onboard">
      <div
        className={styles.screen}
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--c-bg)",
          color: "var(--c-ink)",
        }}
      >
        <header
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "4px var(--v3-pad) 12px",
          }}
        >
          <Wordmark size={17} />
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              fontWeight: 400,
              lineHeight: 1,
              letterSpacing: "0.07em",
              color: "var(--c-muted)",
            }}
          >
            {`${p.step} of ${p.totalSteps}`}
          </span>
        </header>

        {/* Seven equal segments. A progress figure that describes state is
            read FROM that state, never typed. */}
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={p.totalSteps}
          aria-valuenow={p.step}
          aria-label="Setup progress"
          style={{
            flex: "none",
            display: "flex",
            gap: 5,
            padding: "0 var(--v3-pad) 4px",
          }}
        >
          {Array.from({ length: p.totalSteps }).map((_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: 2,
                borderRadius: 4,
                backgroundColor: i < p.step ? "var(--c-gold)" : "var(--c-border)",
              }}
            />
          ))}
        </div>

        {showPersona && (
          <div
            style={{
              flex: "none",
              display: "flex",
              gap: 6,
              padding: "14px var(--v3-pad) 0",
              overflowX: "auto",
            }}
          >
            <span style={chip(!!roleChip)}>{roleChip?.label ?? "Role"}</span>
            <span style={chip(!!stratChip)}>{stratChip?.label ?? "Strategy"}</span>
            <span style={chip(p.sectors.length > 0)}>
              {p.sectors.length ? `${p.sectors.length} sectors` : "Sectors"}
            </span>
            <span style={chip(!!horizonChip)}>{horizonChip?.label ?? "Horizon"}</span>
            <span style={chip(!!workflowChip)}>{workflowChip?.label ?? "Workflow"}</span>
          </div>
        )}

        <div style={{ flex: 1, padding: "18px var(--v3-pad) 20px" }}>
          {p.step === 1 && (
            <div>
              <TitleBlock
                kicker="Welcome"
                title="Welcome to Signalera."
                body="Signalera writes your brief in the second person. It helps to know who that is."
              />
              <div style={{ marginTop: 22 }}>
                <TextField
                  label="FIRST NAME"
                  value={p.firstName}
                  onChange={p.onFirstName}
                  placeholder="Maya"
                  autoFocus
                />
              </div>
              <div style={{ marginTop: 14 }}>
                <TextField
                  label="FIRM OR SCHOOL"
                  value={p.firmOrSchool}
                  onChange={p.onFirmOrSchool}
                  placeholder="NYU Stern"
                />
              </div>
            </div>
          )}

          {p.step === 2 && (
            <div>
              <TitleBlock
                kicker="Step 2 · Role"
                title="What do you do?"
                body="This shapes how briefs and memos are framed for you."
              />
              <Stack>
                {p.roles.map((r) => (
                  <OptionCard
                    key={r.id}
                    selected={p.role === r.id}
                    label={r.label}
                    description={r.description}
                    onClick={() => p.onRole(r.id)}
                  />
                ))}
              </Stack>
            </div>
          )}

          {p.step === 3 && (
            <div>
              <TitleBlock
                kicker="Step 3 · Strategy"
                title="What’s your mandate?"
                body="The desk frames its reasoning to match."
              />
              <Stack>
                {p.strategies.map((s) => (
                  <OptionCard
                    key={s.id}
                    selected={p.strategy === s.id}
                    label={s.label}
                    description={s.description}
                    onClick={() => p.onStrategy(s.id)}
                  />
                ))}
              </Stack>
            </div>
          )}

          {p.step === 4 && (
            <div>
              <TitleBlock
                kicker="Step 4 · Sectors"
                title="What sectors do you follow?"
                body="Signals from these surface first in your brief. Pick at least one."
              />
              <div
                style={{
                  marginTop: 20,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 9,
                }}
              >
                {p.sectorOptions.map((s) => {
                  const on = p.sectors.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => p.onToggleSector(s)}
                      className={styles.reset}
                      aria-pressed={on}
                      style={{
                        minHeight: 44,
                        display: "flex",
                        alignItems: "center",
                        padding: "0 13px",
                        borderRadius: 9,
                        border: `1px solid ${on ? "var(--c-gold)" : "var(--c-border)"}`,
                        backgroundColor: on ? "var(--c-well)" : "var(--c-card)",
                        fontFamily: FONT_SANS,
                        fontSize: 12,
                        fontWeight: 500,
                        lineHeight: 1,
                        color: on ? "var(--c-ink)" : "var(--c-secondary)",
                      }}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
              <p
                style={{
                  margin: "14px 0 0",
                  fontFamily: FONT_SANS,
                  fontSize: 11.5,
                  fontWeight: 400,
                  lineHeight: 1.5,
                  color: "var(--c-muted)",
                }}
              >
                {p.sectors.length}{" "}
                {p.sectors.length === 1 ? "sector selected" : "sectors selected"}
              </p>
            </div>
          )}

          {p.step === 5 && (
            <div>
              <TitleBlock
                kicker="Step 5 · How you work"
                title="Horizon and workflow."
                body="Horizon sets the default review date on a call you take."
              />
              <MonoLabel style={{ marginTop: 20 }}>HORIZON</MonoLabel>
              <div
                style={{
                  marginTop: 9,
                  display: "flex",
                  flexDirection: "column",
                  gap: 9,
                }}
              >
                {p.horizons.map((h) => (
                  <OptionCard
                    key={h.id}
                    selected={p.horizon === h.id}
                    label={h.label}
                    description={h.description}
                    onClick={() => p.onHorizon(h.id)}
                  />
                ))}
              </div>
              <MonoLabel style={{ marginTop: 22 }}>WORKFLOW</MonoLabel>
              <div
                style={{
                  marginTop: 9,
                  display: "flex",
                  flexDirection: "column",
                  gap: 9,
                }}
              >
                {p.workflows.map((w) => (
                  <OptionCard
                    key={w.id}
                    selected={p.workflow === w.id}
                    label={w.label}
                    description={w.description}
                    onClick={() => p.onWorkflow(w.id)}
                  />
                ))}
              </div>
              <div
                style={{
                  marginTop: 20,
                  padding: "14px 15px",
                  border: "1px solid var(--c-border)",
                  borderRadius: 12,
                  backgroundColor: "var(--c-well)",
                }}
              >
                <MonoLabel>WHAT THAT WINDOW CATCHES</MonoLabel>
                <p
                  style={{
                    margin: "9px 0 0",
                    fontFamily: FONT_SANS,
                    fontSize: 13,
                    fontWeight: 400,
                    lineHeight: 1.6,
                    color: "var(--c-body)",
                  }}
                >
                  {p.horizon ? WINDOW_CATCHES[p.horizon] : WINDOW_UNSET}
                </p>
              </div>
            </div>
          )}

          {p.step === 6 && (
            <div>
              <TitleBlock
                kicker="Step 6 · Watchlist"
                title="Any tickers you watch?"
                body="Optional. Signals touching these are surfaced prominently."
              />
              <div style={{ marginTop: 20 }}>
                <TextField
                  label="TICKERS"
                  value={p.tickerInput}
                  onChange={p.onTickerInput}
                  onCommit={p.onCommitTickers}
                  placeholder="CEG, NVO, MSFT"
                  mono
                />
              </div>
              <p
                style={{
                  margin: "9px 0 0",
                  fontFamily: FONT_SANS,
                  fontSize: 10.5,
                  fontWeight: 400,
                  lineHeight: 1.5,
                  color: "var(--c-muted)",
                }}
              >
                Comma-separated ticker symbols.
              </p>

              {p.tickers.length === 0 ? (
                <p
                  style={{
                    margin: "18px 0 0",
                    fontFamily: FONT_SANS,
                    fontSize: 11.5,
                    fontWeight: 400,
                    lineHeight: 1.5,
                    color: "var(--c-muted)",
                  }}
                >
                  No tickers yet. You can skip and add them later from preferences.
                </p>
              ) : (
                <>
                  <MonoLabel style={{ marginTop: 18 }}>ON YOUR LIST</MonoLabel>
                  <div
                    style={{
                      marginTop: 10,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    {p.tickers.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => p.onRemoveTicker(t)}
                        aria-label={`Remove ${t}`}
                        className={`${styles.reset} ${styles.tapPad}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          paddingLeft: 12,
                          paddingRight: 12,
                          border: "1px solid var(--c-border)",
                          borderRadius: 4,
                          backgroundColor: "var(--c-surface)",
                          fontFamily: FONT_MONO,
                          fontSize: 12,
                          fontWeight: 500,
                          lineHeight: 1,
                          color: "var(--c-secondary)",
                        }}
                      >
                        {t}
                        <span aria-hidden="true" style={{ color: "var(--c-muted)" }}>
                          {"×"}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {p.step === 7 && (
            <div>
              {p.previewLoading && (
                <>
                  <TitleBlock
                    kicker="Step 7 · Review"
                    title="Writing yours now."
                    body="Reading this morning’s brief against the profile you just set."
                  />
                  <div
                    aria-hidden="true"
                    style={{
                      marginTop: 24,
                      display: "flex",
                      flexDirection: "column",
                      gap: 9,
                    }}
                  >
                    <div className={styles.skeleton} style={{ height: 11, width: "38%", borderRadius: 4 }} />
                    <div className={styles.skeleton} style={{ marginTop: 8, height: 15, borderRadius: 4 }} />
                    <div className={styles.skeleton} style={{ height: 15, width: "82%", borderRadius: 4 }} />
                    <div className={styles.skeleton} style={{ marginTop: 14, height: 11, borderRadius: 4 }} />
                    <div className={styles.skeleton} style={{ height: 11, width: "70%", borderRadius: 4 }} />
                  </div>
                </>
              )}

              {!p.previewLoading && p.previewError && (
                <>
                  <TitleBlock
                    kicker="Step 7 · Review"
                    title="The preview did not come back."
                    body="This is a failed read, not an empty one. Nothing about your setup has gone anywhere, and you can go on without it."
                  />
                  <button
                    type="button"
                    onClick={p.onRetryPreview}
                    className={styles.reset}
                    style={{
                      marginTop: 20,
                      width: "100%",
                      minHeight: 48,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "1px solid var(--c-gold)",
                      borderRadius: 9,
                      fontFamily: FONT_MONO,
                      fontSize: 11,
                      fontWeight: 400,
                      lineHeight: 1,
                      letterSpacing: "0.08em",
                      color: "var(--c-goldink)",
                    }}
                  >
                    TRY THE PREVIEW AGAIN
                  </button>
                </>
              )}

              {!p.previewLoading && !p.previewError && (
                <>
                  <TitleBlock
                    kicker="Step 7 · Review"
                    title="Here’s what Signalera looks like for you."
                    body="This is what a call looks like. You do not have to take it now."
                  />
                  {p.preview ? (
                    <div
                      className={styles.in}
                      style={{
                        marginTop: 20,
                        border: "1px solid var(--c-border)",
                        borderRadius: 12,
                        backgroundColor: "var(--c-card)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        className={styles.wipe}
                        style={{ height: 2, backgroundColor: "var(--c-gold)" }}
                      />
                      <div style={{ padding: "16px 17px" }}>
                        <div
                          style={{
                            fontFamily: FONT_SANS,
                            fontSize: 11,
                            fontWeight: 600,
                            lineHeight: 1,
                            color: "var(--c-secondary)",
                          }}
                        >
                          {p.preview.sector}
                        </div>
                        <p
                          style={{
                            margin: "11px 0 0",
                            fontFamily: FONT_DISPLAY,
                            fontSize: 17,
                            fontWeight: 500,
                            lineHeight: 1.4,
                            color: "var(--c-ink)",
                            textWrap: "pretty",
                          }}
                        >
                          {p.preview.title}
                        </p>
                        <p
                          style={{
                            margin: "11px 0 0",
                            fontFamily: FONT_SANS,
                            fontSize: 13.5,
                            fontWeight: 400,
                            lineHeight: 1.6,
                            color: "var(--c-body)",
                            textWrap: "pretty",
                          }}
                        >
                          {p.preview.rationale}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p
                      style={{
                        margin: "20px 0 0",
                        fontFamily: FONT_SANS,
                        fontSize: 13,
                        fontWeight: 400,
                        lineHeight: 1.6,
                        color: "var(--c-secondary)",
                      }}
                    >
                      A sample call is drafted for you when this step opens.
                    </p>
                  )}
                  <p
                    style={{
                      margin: "16px 0 0",
                      fontFamily: FONT_SANS,
                      fontSize: 12.5,
                      fontWeight: 400,
                      lineHeight: 1.6,
                      color: "var(--c-muted)",
                      textWrap: "pretty",
                    }}
                  >
                    {matchLine(p.horizon, p.sectors)}
                  </p>
                </>
              )}
            </div>
          )}

          {p.saveError && (
            <div
              role="alert"
              style={{
                marginTop: 20,
                padding: "11px 13px",
                border: "1px solid var(--c-red-edge)",
                borderRadius: 12,
                backgroundColor: "var(--c-red-well)",
                fontFamily: FONT_SANS,
                fontSize: 12.5,
                fontWeight: 400,
                lineHeight: 1.55,
                color: "var(--c-redink)",
              }}
            >
              {p.saveError}
            </div>
          )}
        </div>

        <div
          style={{
            flex: "none",
            position: "sticky",
            bottom: 0,
            padding:
              "12px var(--v3-pad) calc(16px + env(safe-area-inset-bottom, 0px))",
            borderTop: "1px solid var(--c-border)",
            backgroundColor: "var(--c-bg)",
            display: "flex",
            gap: 10,
            alignItems: "center",
          }}
        >
          {!p.backDisabled && (
            <button
              type="button"
              onClick={p.onBack}
              className={styles.reset}
              aria-label="Back a step"
              style={{
                flex: "none",
                minWidth: 52,
                minHeight: 50,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid var(--c-border)",
                borderRadius: 9,
              }}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--c-secondary)"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
          )}
          {/* Gated CTA. The locked treatment measures 5.39:1, so a disabled
              control reads as deliberately disabled rather than washed out. */}
          <button
            type="button"
            onClick={p.onNext}
            disabled={p.ctaDisabled}
            className={styles.reset}
            style={{
              flex: 1,
              minHeight: 50,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 9,
              fontFamily: FONT_SANS,
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1,
              backgroundColor: p.ctaDisabled ? "var(--c-locked-bg)" : "var(--c-gold)",
              color: p.ctaDisabled ? "var(--c-locked-ink)" : "var(--c-ongold)",
              cursor: p.ctaDisabled ? "default" : "pointer",
            }}
          >
            {p.ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Derived from state, never typed. Names the horizon and the first sector
 * the user actually chose, and closes on the standing disclaimer. */
function matchLine(horizon: InvestmentHorizon | null, sectors: string[]): string {
  const parts: string[] = [];
  if (horizon) parts.push(`your ${horizon} horizon`);
  if (sectors.length) parts.push(`your ${sectors[0].toLowerCase()} sector`);
  if (!parts.length) return "Informational only, never advice.";
  const joined = parts.length === 2 ? `${parts[0]} and ${parts[1]}` : parts[0];
  return `Matched to ${joined}. Informational only, never advice.`;
}

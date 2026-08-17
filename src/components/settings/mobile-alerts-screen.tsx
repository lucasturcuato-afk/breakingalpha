"use client";

import { useCallback, useId, useMemo, useState, useSyncExternalStore } from "react";
import { BackHeader, ListRowControl, Screen, ScreenBody, ToggleSwitch } from "@/components/mobile";
import styles from "@/components/mobile/mobile.module.css";

/**
 * Alerts. The one screen in this batch with no repo source at all: github.md
 * records it as designed fresh, and no `src/app/alerts/` route exists. Its
 * whole argument is that a browser tab cannot be interrupted, so nothing here
 * promises a push notification.
 *
 * Persistence. The batch recon left this open, because five switches that
 * forget their state on reload are worse than no switches, and there is no
 * table and no route behind them. They persist to this device instead. That
 * is honest about what the settings are: they change what is waiting when the
 * app is opened here, which is the same scope as the Theme row two screens
 * back, and it needs no migration and no write to the database.
 *
 * Every switch also stays inert until the stored value has actually been read,
 * so the screen never paints a default that then flips under the reader.
 */

const STORAGE_KEY = "signalera_alert_prefs";

export interface AlertPrefs {
  brief: boolean;
  wrap: boolean;
  review: boolean;
  window: boolean;
  names: boolean;
}

const DEFAULTS: AlertPrefs = {
  brief: true,
  wrap: true,
  review: true,
  window: true,
  names: false,
};

type Status = "loading" | "ready" | "error";

/* Two sentinels the stored JSON can never be, so "not read yet" and "could not
 * read" are distinguishable from "nothing stored". */
const UNREAD = "";
const UNREADABLE = "!";

/**
 * The store, read through `useSyncExternalStore` rather than an effect.
 * localStorage is an external system and this is the hook for reading one: the
 * server snapshot is UNREAD, so both the server render and the hydration
 * render agree, and React swaps in the real value straight after without a
 * mismatch.
 */
const store = {
  subscribe(onChange: () => void) {
    // Another tab writing the same key is the only external mutation.
    window.addEventListener("storage", onChange);
    return () => window.removeEventListener("storage", onChange);
  },
  getSnapshot(): string {
    try {
      return window.localStorage.getItem(STORAGE_KEY) ?? "{}";
    } catch {
      return UNREADABLE;
    }
  },
  getServerSnapshot(): string {
    return UNREAD;
  },
};

function parse(raw: string): AlertPrefs {
  let parsed: Partial<AlertPrefs> = {};
  try {
    parsed = JSON.parse(raw) as Partial<AlertPrefs>;
  } catch {
    parsed = {};
  }
  return {
    brief: typeof parsed.brief === "boolean" ? parsed.brief : DEFAULTS.brief,
    wrap: typeof parsed.wrap === "boolean" ? parsed.wrap : DEFAULTS.wrap,
    review: typeof parsed.review === "boolean" ? parsed.review : DEFAULTS.review,
    window: typeof parsed.window === "boolean" ? parsed.window : DEFAULTS.window,
    names: typeof parsed.names === "boolean" ? parsed.names : DEFAULTS.names,
  };
}

const ROWS: { key: keyof AlertPrefs; group: "publication" | "ledger"; label: string; sub: string }[] = [
  { key: "brief", group: "publication", label: "Morning brief", sub: "Published 6:45, weekdays" },
  { key: "wrap", group: "publication", label: "Evening wrap", sub: "Published 4:35, after the close" },
  { key: "review", group: "ledger", label: "Review days", sub: "The morning a call is checked" },
  { key: "window", group: "ledger", label: "Window closing", sub: "Two days before, so nothing surprises you" },
  { key: "names", group: "ledger", label: "Followed names", sub: "Only when the desk writes on one" },
];

export function MobileAlertsScreen() {
  const raw = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  /* Local edits, so a change shows immediately. Null until the reader touches
   * a switch, at which point what is stored and what is shown are the same. */
  const [local, setLocal] = useState<AlertPrefs | null>(null);
  const [writeFailed, setWriteFailed] = useState(false);
  const idBase = useId();

  const stored = useMemo(() => parse(raw === UNREAD || raw === UNREADABLE ? "{}" : raw), [raw]);
  const prefs = local ?? stored;

  const status: Status =
    raw === UNREAD ? "loading" : raw === UNREADABLE || writeFailed ? "error" : "ready";

  const set = useCallback(
    (key: keyof AlertPrefs, next: boolean) => {
      const updated = { ...(local ?? stored), [key]: next };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        setLocal(updated);
        setWriteFailed(false);
      } catch {
        // A write that does not land must say so rather than leave the switch
        // showing a state this device will not remember.
        setWriteFailed(true);
      }
    },
    [local, stored],
  );

  const publication = ROWS.filter((r) => r.group === "publication");
  const ledger = ROWS.filter((r) => r.group === "ledger");

  return (
    <Screen parity="alerts">
      <BackHeader href="/settings/profile" label="Settings" />

      <div style={{ flex: "none", padding: "14px var(--v3-pad) 0" }}>
        <h1
          style={{
            margin: 0,
            font: "700 24px/1.16 'Playfair Display', serif",
            letterSpacing: "-0.02em",
            color: "var(--c-ink)",
          }}
        >
          When the app reaches you
        </h1>
        <p
          style={{
            margin: "8px 0 0",
            font: "400 12.5px/1.55 Inter, sans-serif",
            color: "var(--c-muted)",
            textWrap: "pretty",
          }}
        >
          On the browser, none of this can interrupt you. It changes what is waiting when you open the
          app, and what the home screen badge counts.
        </p>
      </div>

      <ScreenBody padTop="18px">
        {status === "error" ? (
          <p
            role="alert"
            style={{
              margin: "0 0 14px",
              font: "400 12px/1.55 Inter, sans-serif",
              color: "var(--c-redink)",
              textWrap: "pretty",
            }}
          >
            This device is not letting Signalera store the settings below, so a change here will not
            survive a reload. Nothing else is affected.
          </p>
        ) : null}

        <Group eyebrow="PUBLICATION" marginTop="0px">
          {publication.map((row, i) => (
            <Row
              key={row.key}
              row={row}
              idBase={idBase}
              checked={prefs[row.key]}
              loading={status === "loading"}
              onChange={(v) => set(row.key, v)}
              bottomRule={i === publication.length - 1}
            />
          ))}
        </Group>

        <Group eyebrow="YOUR LEDGER" marginTop="24px">
          {ledger.map((row, i) => (
            <Row
              key={row.key}
              row={row}
              idBase={idBase}
              checked={prefs[row.key]}
              loading={status === "loading"}
              onChange={(v) => set(row.key, v)}
              bottomRule={i === ledger.length - 1}
            />
          ))}
        </Group>

        <div
          style={{
            marginTop: "20px",
            padding: "15px 16px",
            border: "1px solid var(--c-border)",
            borderRadius: "12px",
            backgroundColor: "var(--c-well)",
          }}
        >
          <div
            style={{
              font: "400 10px/1 'JetBrains Mono', monospace",
              letterSpacing: "0.07em",
              color: "var(--c-muted)",
            }}
          >
            WHY THIS PAGE IS SHORT
          </div>
          <p
            style={{
              margin: "9px 0 0",
              font: "400 13px/1.65 Inter, sans-serif",
              color: "var(--c-body)",
              textWrap: "pretty",
            }}
          >
            Nothing here can push to a browser tab, and most people never install to the home screen.
            So the product does not depend on interrupting you. What brings you back is the window you
            fixed yourself, and the app opens on it.
          </p>
        </div>
      </ScreenBody>
    </Screen>
  );
}

function Group({
  eyebrow,
  marginTop,
  children,
}: {
  eyebrow: string;
  marginTop: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop }}>
      <h2
        style={{
          margin: 0,
          font: "400 10px/1 'JetBrains Mono', monospace",
          letterSpacing: "0.07em",
          color: "var(--c-muted)",
        }}
      >
        {eyebrow}
      </h2>
      <div style={{ marginTop: "2px" }}>{children}</div>
    </section>
  );
}

function Row({
  row,
  idBase,
  checked,
  loading,
  onChange,
  bottomRule,
}: {
  row: (typeof ROWS)[number];
  idBase: string;
  checked: boolean;
  loading: boolean;
  onChange: (next: boolean) => void;
  bottomRule: boolean;
}) {
  const subId = `${idBase}-${row.key}`;
  return (
    <ListRowControl
      label={row.label}
      sub={row.sub}
      subId={subId}
      bottomRule={bottomRule}
      trailing={
        loading ? (
          <span
            aria-hidden="true"
            className={styles.sk}
            style={{ flex: "none", width: "46px", height: "28px", borderRadius: "var(--radius-pill)" }}
          />
        ) : (
          <ToggleSwitch checked={checked} onChange={onChange} label={row.label} describedBy={subId} />
        )
      }
    />
  );
}

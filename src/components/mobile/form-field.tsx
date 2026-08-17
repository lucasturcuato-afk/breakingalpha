"use client";

import type { CSSProperties } from "react";
import { useId } from "react";

/**
 * The mobile form row: a label above one control, at the measurements the
 * prototype draws for First name, Firm or school and Watchlist tickers.
 *
 * The desktop settings page has a local `FormField` that wraps
 * `@/components/ui/input`, but that input carries the desktop chrome and none
 * of these values, so this is a sibling rather than a fork of it. The design
 * draws these three fields as static text; a real screen needs a real input,
 * so the measured box is applied to the input itself.
 *
 * The label is a real `label` bound to the control by id, which the prototype
 * cannot express.
 */

const FIELD: CSSProperties = {
  marginTop: "7px",
  width: "100%",
  minHeight: "46px",
  display: "flex",
  alignItems: "center",
  padding: "0 14px",
  border: "1px solid var(--c-border)",
  borderRadius: "9px",
  backgroundColor: "var(--c-surface)",
  color: "var(--c-ink)",
  outlineOffset: "2px",
};

export function FormField({
  label,
  value,
  onChange,
  placeholder,
  help,
  mono = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  help?: string;
  /** Tickers read as machine record, so they take the mono face. */
  mono?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;

  return (
    <div>
      <label
        htmlFor={id}
        style={{ display: "block", font: "600 11px/1 Inter, sans-serif", color: "var(--c-ink)" }}
      >
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-describedby={helpId}
        onChange={(e) => onChange(e.target.value)}
        style={{
          ...FIELD,
          font: mono
            ? "400 13px/1 'JetBrains Mono', monospace"
            : "400 13px/1 Inter, sans-serif",
          letterSpacing: mono ? "0.02em" : undefined,
        }}
      />
      {help ? (
        <p
          id={helpId}
          style={{
            margin: "8px 0 0",
            font: "400 10.5px/1.5 Inter, sans-serif",
            color: "var(--c-muted)",
            textWrap: "pretty",
          }}
        >
          {help}
        </p>
      ) : null}
    </div>
  );
}

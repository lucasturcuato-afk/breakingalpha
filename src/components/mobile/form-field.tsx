"use client";

import type { CSSProperties } from "react";
import { useId } from "react";
import { FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";

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
  labelHidden = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  help?: string;
  /** Tickers read as machine record, so they take the mono face. */
  mono?: boolean;
  /**
   * Hide the label visually, for the one field the design titles with a
   * section rule instead. The label still exists and is still bound to the
   * input, because a rule is a heading and a heading is not a label.
   */
  labelHidden?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;

  return (
    /* `position: relative` is load-bearing and it is a bug fix, not styling.
     *
     * The hidden-label branch below is `position: absolute`. With no positioned
     * ancestor its containing block was the INITIAL containing block, so it did
     * not sit inside this field at all: it resolved at its static position in
     * DOCUMENT coordinates, escaped <main>'s overflow clipping, and extended the
     * document's scrollable area to wherever the field happened to fall.
     *
     * Measured in a production build at 390x844, signed in, on
     * /settings/profile: that one 1px label sat at document y 1158, pinning
     * documentElement.scrollHeight at 1159 against an 844px viewport. The page
     * therefore scrolled 315px past its own content into an empty band above the
     * tab bar, and the number did not move when the viewport height changed,
     * which is what gave it away. /saved, /ledger, /dashboard, /company and
     * /morning-brief all measured 0; /deal-flow scrolls <main> 42922px and still
     * measured 0. This field is the only route to it.
     *
     * Making this box the containing block puts the label back inside the field,
     * where the clip already hides it. Nothing moves and nothing renders
     * differently. */
    <div style={{ position: "relative" }}>
      <label
        htmlFor={id}
        style={
          labelHidden
            ? {
                position: "absolute",
                width: "1px",
                height: "1px",
                overflow: "hidden",
                clip: "rect(0 0 0 0)",
                clipPath: "inset(50%)",
                whiteSpace: "nowrap",
              }
            : { display: "block", font: `600 11px/1 ${FONT_SANS}`, color: "var(--c-ink)" }
        }
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
          marginTop: labelHidden ? "10px" : FIELD.marginTop,
          font: mono
            ? `400 13px/1 ${FONT_MONO}`
            : `400 13px/1 ${FONT_SANS}`,
          letterSpacing: mono ? "0.02em" : undefined,
        }}
      />
      {help ? (
        <p
          id={helpId}
          style={{
            margin: "8px 0 0",
            font: `400 10.5px/1.5 ${FONT_SANS}`,
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

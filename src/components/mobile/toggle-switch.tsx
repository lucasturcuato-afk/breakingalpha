"use client";

import type { CSSProperties } from "react";

/**
 * The mobile switch. The only toggle primitive in the repo; nothing existed to
 * extend, so this is a net-new extraction shared by the Alerts rows.
 *
 * Geometry is measured off the rendered prototype: a 46x28 track that reaches
 * the 44px tap floor through `content-box` padding plus a compensating
 * negative margin, so the hit box grows without moving the control or
 * changing the row rhythm. The handoff names "Alerts switches" as one of the
 * six places using that trick, and it lives here rather than in each caller.
 *
 * `background-clip: content-box` keeps the padding transparent, so the paint
 * stays 46x28 while the box measures 50x44.
 *
 * The prototype draws the track at 99px, which is off the 4/6/9/12/14 scale
 * and which both the static and the runtime lint reject. Half of the track's
 * own 28px height is 14px, which is on the scale and renders the identical
 * capsule, so the shape is kept and the scale is not bent.
 *
 * `locked` is the state PR #661 established for a control with nothing behind
 * it, drawn in the chrome border rather than the ink one so the closed state
 * is VISIBLE and not only announced. `--c-locked-bg` and `--c-locked-ink` are
 * the design system's own pair for exactly this; nothing here is invented.
 *
 * A LOCKED SWITCH IS NOT A DISABLED SWITCH, and that distinction cost a round
 * of review. The first version rendered `<button role="switch"
 * aria-checked="false" disabled>`, which announces "switch, off, dimmed".
 * "Off" is a claim about a stored setting, and there is no store: the value is
 * ABSENT, not false. #661's precedent closed a `<button>`, which carries no
 * state; a switch does, and drawing all of them off asserts five settings that
 * do not exist. So `locked` renders no control at all. It is a decorative,
 * `aria-hidden` span: nothing focusable, no role, no `aria-checked`, nothing
 * for assistive technology to report a state from. The row's own text and the
 * line above the group carry the meaning.
 */

export function ToggleSwitch({
  checked,
  onChange,
  label,
  describedBy,
  locked = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name. The visible row label is not associated with the control. */
  label: string;
  /** Id of the row's sub-label, so the switch reads its qualifier too. */
  describedBy?: string;
  /**
   * Nothing reads this setting, so the control takes no change. Not a styling
   * flag: it sets `disabled` on the element as well, so the switch cannot be
   * clicked, focused or announced as operable.
   */
  locked?: boolean;
}) {
  /* Same 50x44 outer box as the live control, so locking a row does not move
     it and the drawn capsule stays identical. It simply is not a control. */
  const track: CSSProperties = {
    boxSizing: "content-box",
    flex: "none",
    width: "44px",
    height: "26px",
    borderRadius: "14px",
    padding: "8px 2px",
    margin: "-8px 0",
    display: "flex",
    alignItems: "center",
    backgroundClip: "content-box",
  };

  if (locked) {
    return (
      <span
        aria-hidden="true"
        style={{
          ...track,
          border: "1px solid var(--c-frame)",
          justifyContent: "flex-start",
          backgroundColor: "var(--c-locked-bg)",
        }}
      >
        <span
          style={{
            display: "block",
            width: "24px",
            height: "24px",
            borderRadius: "50%",
            background: "var(--c-locked-ink)",
          }}
        />
      </span>
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      onClick={() => onChange(!checked)}
      style={{
        ...track,
        appearance: "none",
        border: 0,
        width: "46px",
        height: "28px",
        justifyContent: checked ? "flex-end" : "flex-start",
        cursor: "pointer",
        backgroundColor: checked ? "var(--c-gold)" : "var(--c-locked-bg)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "block",
          width: "24px",
          height: "24px",
          borderRadius: "50%",
          background: checked ? "var(--c-ongold)" : "var(--c-bg)",
        }}
      />
    </button>
  );
}

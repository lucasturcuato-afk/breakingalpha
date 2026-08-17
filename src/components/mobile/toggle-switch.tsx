"use client";

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
 */

export function ToggleSwitch({
  checked,
  onChange,
  label,
  describedBy,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name. The visible row label is not associated with the control. */
  label: string;
  /** Id of the row's sub-label, so the switch reads its qualifier too. */
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      onClick={() => onChange(!checked)}
      style={{
        appearance: "none",
        border: 0,
        boxSizing: "content-box",
        flex: "none",
        width: "46px",
        height: "28px",
        borderRadius: "var(--radius-pill)",
        padding: "8px 2px",
        margin: "-8px 0",
        display: "flex",
        alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
        cursor: "pointer",
        backgroundClip: "content-box",
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

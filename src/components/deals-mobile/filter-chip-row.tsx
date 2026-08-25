"use client";

import type { CSSProperties } from "react";

/**
 * The filter chip row: one wrapping row of `label + count` chips driving a
 * client-side lens over a list.
 *
 * batch-6 calls this the shared component to extract first, and names three
 * consumers. This is NOT that extraction. The repo's three existing chip
 * implementations differ in shape, in colour and in semantics, one of them is
 * trapped inside a propose-only file, and reconciling them is a change to live
 * desktop surfaces. So this is a wrapper beside them, owned by the mobile Deal
 * Flow screen, matching the prototype's `chip(on)` helper at line 3220 exactly.
 * The extraction is proposed in the PR body rather than performed here.
 *
 * Measured off the rendered prototype:
 *   min-height 44px, radius 6, 12px Inter, padding 0 12px, gap 12px
 *   active   1px var(--c-ink),    600, var(--c-ink),       var(--c-surface)
 *   inactive 1px var(--c-border), 500, var(--c-secondary), transparent
 *
 * Stage colour never reaches a chip. The design colours the stage word inside
 * the card and leaves the chips monochrome, and letting stage ink leak in here
 * is the specific mistake batch-6 warns against.
 */

export interface FilterChip<T extends string> {
  key: T;
  label: string;
  /** Omitted rather than zero when a chip carries no figure at all. */
  count?: number;
}

const PAD = "var(--v3-pad)";

function chipStyle(on: boolean): CSSProperties {
  return {
    /* The prototype ships no box-sizing reset, so every element in it is
       content-box. Tailwind's preflight makes every element here border-box.
       A chip declaring min-height 44 with a 1px border therefore measures 46
       in the design and 44 in the build, which is exactly the mismatch the
       first parity run reported on all five chips. The design draws 46, and 46
       clears the 44px floor, so the build follows the design. */
    boxSizing: "content-box",
    flex: "none",
    minHeight: "44px",
    display: "flex",
    alignItems: "center",
    padding: "0 12px",
    borderRadius: "6px",
    whiteSpace: "nowrap",
    cursor: "pointer",
    border: `1px solid ${on ? "var(--c-ink)" : "var(--c-border)"}`,
    font: `${on ? 600 : 500} 12px/1 Inter, sans-serif`,
    color: on ? "var(--c-ink)" : "var(--c-secondary)",
    backgroundColor: on ? "var(--c-surface)" : "transparent",
  };
}

export function FilterChipRow<T extends string>({
  chips,
  active,
  onSelect,
  label,
}: {
  chips: ReadonlyArray<FilterChip<T>>;
  active: T;
  onSelect: (key: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{
        flex: "none",
        display: "flex",
        flexWrap: "wrap",
        gap: "12px",
        padding: `14px ${PAD}`,
      }}
    >
      {chips.map((chip) => {
        const on = chip.key === active;
        return (
          <button
            key={chip.key}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(chip.key)}
            style={chipStyle(on)}
          >
            {chip.count === undefined ? chip.label : `${chip.label} ${chip.count}`}
          </button>
        );
      })}
    </div>
  );
}

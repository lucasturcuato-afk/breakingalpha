"use client";

/**
 * GroupJumpNav — the persistent group filter/jump control for grouped
 * surfaces (Following themes, Calls "from the brief" groups, Watchlist
 * coverage). A sticky, on-palette chip rail: uppercase labels with
 * honest counts, gold active state, horizontal scroll past overflow.
 * Controlled: the parent decides whether a chip filters in place or
 * jumps to a section (useGroupScrollSpy covers the jump case).
 *
 * Same labels everywhere: when a page's groups come from the shared
 * clustering resource, these chips render those exact labels — the
 * nav never invents its own taxonomy.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface GroupChip {
  id: string;
  label: string;
  count?: number;
}

export function GroupJumpNav({
  groups,
  activeId,
  onSelect,
  ariaLabel = "Jump to group",
  bleed = false,
}: {
  groups: GroupChip[];
  activeId: string | null;
  onSelect: (id: string) => void;
  ariaLabel?: string;
  /** Extend edge-to-edge inside a p-6 page wrapper. */
  bleed?: boolean;
}) {
  if (groups.length < 2) return null;
  return (
    <nav
      aria-label={ariaLabel}
      className={
        "sticky top-0 z-30 mb-5 border-b border-border-subtle bg-parchment/90 backdrop-blur-sm dark:bg-background/85" +
        (bleed ? " -mx-6 px-6" : "")
      }
    >
      <div className="no-scrollbar flex items-center gap-1 overflow-x-auto py-2">
        {groups.map((g) => {
          const active = g.id === activeId;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => onSelect(g.id)}
              aria-current={active ? "true" : undefined}
              className={
                "relative shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 font-sans text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors " +
                (active
                  ? "text-text-primary"
                  : "text-text-muted hover:text-text-primary")
              }
            >
              {g.label}
              {typeof g.count === "number" && (
                <span className="ml-1.5 font-normal normal-case tracking-normal text-text-faint">
                  {g.count}
                </span>
              )}
              <span
                aria-hidden
                className="absolute inset-x-2 -bottom-[9px] h-[2px] rounded-full transition-opacity"
                style={{
                  backgroundColor: "var(--gold)",
                  opacity: active ? 1 : 0,
                }}
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Scrollspy + smooth jump for section-based pages. Sections must
 * render with id `group-<id>` (add `scroll-mt-14` so the sticky rail
 * never covers a jumped-to heading).
 */
export function useGroupScrollSpy(ids: string[]) {
  const [activeId, setActiveId] = useState<string | null>(ids[0] ?? null);
  const suppressUntil = useRef(0);
  const idsKey = ids.join("|");

  useEffect(() => {
    const els = ids
      .map((id) => document.getElementById(`group-${id}`))
      .filter((el): el is HTMLElement => !!el);
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < suppressUntil.current) return;
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActiveId(visible[0].target.id.replace(/^group-/, ""));
        }
      },
      { rootMargin: "-10% 0px -70% 0px" },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const jumpTo = useCallback((id: string) => {
    const el = document.getElementById(`group-${id}`);
    if (!el) return;
    setActiveId(id);
    // Let the smooth scroll land before the spy takes back over.
    suppressUntil.current = Date.now() + 900;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, []);

  return { activeId, jumpTo };
}

export default GroupJumpNav;

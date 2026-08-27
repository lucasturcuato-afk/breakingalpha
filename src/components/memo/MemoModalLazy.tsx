"use client";

import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import type { ComponentProps } from "react";
import type { MemoModal as MemoModalType } from "./MemoModal";

type Props = ComponentProps<typeof MemoModalType>;

// Shown only while the deferred chunk is in flight after a tap on a memo
// trigger. MemoModal draws no skeleton of its own, so this reuses its scrim
// verbatim (MemoModal.tsx:276) rather than inventing a treatment. No spinner
// and no copy: the rule is loading or nothing, never a sentence. It is
// portalled to the body for the same reason MemoModal is, so an ancestor
// transform at a call site cannot capture the fixed positioning.
function MemoScrim() {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-espresso/50 flex items-center justify-center p-6"
      aria-hidden="true"
    />,
    document.body,
  );
}

// MemoModal pulls in react-markdown, which is a ~117 KB raw / ~35 KB gz chunk.
// Deferring it keeps that chunk out of the first load on every route that
// mounts a memo surface.
const Inner = dynamic(() => import("./MemoModal").then((m) => m.MemoModal), {
  ssr: false,
  loading: () => <MemoScrim />,
});

// The closed-state short circuit is load bearing. next/dynamic fetches on
// render, not on import, so call sites that mount MemoModal unconditionally
// would otherwise move the fetch from parse time to mount time in the same
// tick and save nothing. Returning null while closed absorbs that without
// changing any call site JSX, and it also scopes the scrim above to exactly
// the post tap window. MemoModal itself already renders null when closed,
// so behaviour is unchanged.
export function MemoModal(props: Props) {
  if (!props.isOpen) return null;
  return <Inner {...props} />;
}

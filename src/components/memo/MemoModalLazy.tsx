"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { MemoModal as MemoModalType } from "./MemoModal";

type Props = ComponentProps<typeof MemoModalType>;

// MemoModal pulls in react-markdown, which is a ~117 KB raw / ~35 KB gz chunk.
// Deferring it keeps that chunk out of the first load on every route that
// mounts a memo surface.
const Inner = dynamic(() => import("./MemoModal").then((m) => m.MemoModal), { ssr: false });

// The closed-state short circuit is load bearing. next/dynamic fetches on
// render, not on import, so call sites that mount MemoModal unconditionally
// would otherwise move the fetch from parse time to mount time in the same
// tick and save nothing. Returning null while closed absorbs that without
// changing any call site JSX. MemoModal itself already renders null when
// closed, so behaviour is unchanged.
export function MemoModal(props: Props) {
  if (!props.isOpen) return null;
  return <Inner {...props} />;
}

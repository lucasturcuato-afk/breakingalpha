"use client";

import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ComponentProps, ReactNode } from "react";
import { createPortal } from "react-dom";
import type { MemoModal as MemoModalType } from "./MemoModal";

type Props = ComponentProps<typeof MemoModalType>;

// MemoModal statically imports react-markdown, a ~117 KB raw / ~35 KB gz chunk.
// Loading it on demand keeps it out of the first load of every route that
// mounts a memo surface.
const MemoModalInner = lazy(() => import("./MemoModal").then((m) => ({ default: m.MemoModal })));

// MemoModal's own scrim, verbatim from MemoModal.tsx:276, including its click
// to dismiss at :277. Reused rather than reinvented so the backdrop does not
// shift when the real modal takes over.
const SCRIM_CLASS = "fixed inset-0 z-[9999] bg-espresso/50 flex items-center justify-center p-6";

// Client detection without a setState in an effect. getServerSnapshot is false
// so the lazy subtree never renders on the server, which is what keeps
// react-markdown out of the server bundle.
const subscribeToNothing = () => () => {};
function useIsClient() {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

// Shown only while the chunk is in flight. No spinner and no visible copy: the
// rule is loading or nothing. It is not inert, though. Clicking it dismisses
// and Escape dismisses, because the fetch has no upper bound and a stalled
// request must never lock the reader out of the route. The status node is what
// a screen reader hears while the chunk loads.
function LoadingScrim({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={SCRIM_CLASS} onClick={onClose}>
      <span className="sr-only" role="status" aria-live="polite">
        Loading memo
      </span>
    </div>,
    document.body,
  );
}

// A rejected chunk request used to throw ChunkLoadError past this component
// into Next's root boundary, which replaced the entire route with its error
// page. It is caught now, so the feed, the filter bar and the scroll position
// all survive and Close hands the route straight back.
//
// Reload rather than Retry, deliberately. Turbopack caches the rejected chunk
// promise in a module local map for the lifetime of the page, so a fresh
// React.lazy, a new import() and a close plus reopen all resolve against the
// cached rejection and issue zero network requests. Measured: 0 requests on
// retry, 0 on reopen, 2 and a successful render only after a page load. An in
// place retry is therefore not possible here, and offering one would be a
// control that does nothing.
function FailureScrim({ onClose }: { onClose: () => void }) {
  const reloadRef = useRef<HTMLButtonElement>(null);
  useEscape(onClose);
  useEffect(() => {
    reloadRef.current?.focus();
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={SCRIM_CLASS} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-label="Memo failed to load"
        className="bg-parchment border border-border-base rounded-2xl w-full max-w-sm p-6 shadow-2xl flex flex-col items-center gap-3"
      >
        <p className="font-sans text-[13px] text-signal-dn">Memo failed to load.</p>
        <div className="flex items-center gap-3">
          <button
            ref={reloadRef}
            type="button"
            onClick={() => window.location.reload()}
            className="px-3 py-1.5 rounded-lg bg-gold text-cream font-sans text-[11px] font-semibold hover:bg-gold-dark transition-colors cursor-pointer"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={onClose}
            className="font-sans text-[12px] text-text-muted hover:text-text-primary cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

class ChunkBoundary extends Component<{ onFail: () => void; children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[MemoModalLazy] memo chunk failed to load:", error);
    this.props.onFail();
  }

  render() {
    return this.state.crashed ? null : this.props.children;
  }
}

// The closed-state short circuit is load bearing. React.lazy fetches on render,
// not on import, so call sites that mount MemoModal unconditionally would
// otherwise move the fetch from parse time to mount time in the same tick and
// save nothing. Returning null while closed absorbs that without changing any
// call site JSX, and it scopes both scrims above to exactly the post tap
// window.
//
// `failed` deliberately survives a close. Once the chunk load has been cached
// as rejected there is nothing a reopen can do except stall, so a later open
// goes straight to the failure surface and its Reload.
export function MemoModal(props: Props) {
  const { isOpen, onClose } = props;
  const isClient = useIsClient();
  const [failed, setFailed] = useState(false);
  const onFail = useCallback(() => setFailed(true), []);

  if (!isOpen || !isClient) return null;
  if (failed) return <FailureScrim onClose={onClose} />;

  return (
    <ChunkBoundary onFail={onFail}>
      <Suspense fallback={<LoadingScrim onClose={onClose} />}>
        <MemoModalInner {...props} />
      </Suspense>
    </ChunkBoundary>
  );
}

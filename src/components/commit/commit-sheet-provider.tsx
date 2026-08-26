"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CommitSheet } from "./commit-sheet";
import type { CommitTarget } from "./commit-target";

/**
 * The commit sheet's mount point, and the whole of its trigger contract.
 *
 * THE SHEET IS A GLOBAL OVERLAY. It is not a child of the Ledger, whatever the
 * README's screens table says: prototype `:2579` sits at the same indentation
 * as `isLedger` (`:257`), `isClaim` (`:469`) and every other screen block,
 * `sheetOpen` (`:3485`) is `s.sheet` with no reference to `s.screen`, and three
 * separate surfaces call `openSheet`. If it shipped as a Ledger-local
 * component, Claim and Deal detail would ship with dead primary CTAs, which is
 * batch-9 open question 2. This resolves it the way the prototype already
 * does.
 *
 * WHAT CLAIM HAS TO DO LATER. Two lines, and no change to anything in this
 * directory:
 *
 *     <CommitSheetProvider initialTarget={null}>...</CommitSheetProvider>
 *     const commit = useCommitSheet();
 *     <button onClick={() => commit?.open(target)}>Track this call</button>
 *
 * Deal detail is the same two lines. The overlay, the note gate, the hold, the
 * write and the failure path are all on this side of the boundary, so a new
 * surface adds a trigger and inherits every one of them.
 *
 * WHY THE HOOK GIVES BACK NULL RATHER THAN THROWING. A surface that forgets the
 * provider should render no action, not crash the screen it is on. A card whose
 * `onTrack` is undefined already draws no button (`ledger-claim-card.tsx:153`),
 * so the degraded state is a card with no commit affordance, which is exactly
 * what shipped before this unit existed.
 *
 * WHY A PORTAL. The overlay is `position: fixed` against the viewport, and
 * `PageTransition` wraps route content in a framer-motion element that can
 * carry a transform. A transformed ancestor becomes the containing block for a
 * fixed descendant, which would pin the sheet to the page body instead of the
 * screen. Portalling to `document.body` puts it outside every candidate
 * containing block by construction rather than by hoping none of them has one.
 */

export interface CommitSheetHandle {
  /** Open the sheet over whatever screen is showing. */
  open: (target: CommitTarget) => void;
  /** Close it without writing. */
  close: () => void;
  /** What the sheet is currently about, or null when it is closed. */
  target: CommitTarget | null;
}

const CommitSheetContext = createContext<CommitSheetHandle | null>(null);

/** The trigger. Null outside a provider, and a caller then renders no action. */
export function useCommitSheet(): CommitSheetHandle | null {
  return useContext(CommitSheetContext);
}

export interface CommitSheetProviderProps {
  children: ReactNode;
  /**
   * REQUIRED and NULLABLE. Normally null: the sheet opens on a tap.
   *
   * It is a prop rather than an internal default so the caller resolves the
   * decision, the way every other screen in this programme resolves its gate.
   * `src/app/ledger/page.tsx` passes a non-null value only on the path that is
   * already showing sample content, which is a non-production build with
   * nobody signed in, and that is the path the parity harness and the width
   * audits run on. A signed-in reader is never handed one.
   */
  initialTarget: CommitTarget | null;
}

export function CommitSheetProvider({ children, initialTarget }: CommitSheetProviderProps) {
  const router = useRouter();
  const [target, setTarget] = useState<CommitTarget | null>(initialTarget);
  const [host, setHost] = useState<HTMLElement | null>(null);

  /* The portal host, captured off a mounted node rather than read from a
     global. `document` does not exist during the server render, so the host
     arrives on the first client pass either way; a ref callback gets there
     without the cascading render an effect that calls setState would cost.
     The marker itself is `display:none`, so it draws nothing and no audit or
     parity probe measures it. */
  const attach = useCallback((node: HTMLSpanElement | null) => {
    setHost(node ? node.ownerDocument.body : null);
  }, []);

  const handle = useMemo<CommitSheetHandle>(
    () => ({
      open: (next: CommitTarget) => setTarget(next),
      close: () => setTarget(null),
      target,
    }),
    [target],
  );

  /* NO TOAST. The sheet closes and the record is re-read, so the card the
     reader tapped comes back carrying the on-ledger marker instead of the
     action. The change IS the confirmation, which is why nothing is announced
     here. */
  const onCommitted = useCallback(() => {
    setTarget(null);
    router.refresh();
  }, [router]);

  return (
    <CommitSheetContext.Provider value={handle}>
      {children}
      <span ref={attach} style={{ display: "none" }} />
      {host !== null && target !== null
        ? createPortal(
            <CommitSheet
              target={target}
              onDismiss={() => setTarget(null)}
              onCommitted={onCommitted}
            />,
            host,
          )
        : null}
    </CommitSheetContext.Provider>
  );
}

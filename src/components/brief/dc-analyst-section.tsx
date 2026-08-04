"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Plus, ThumbsUp, ThumbsDown } from "lucide-react";
import { stripHtml } from "@/lib/strip-html";
import { makeCallLink } from "@/lib/make-call-link";
import { MemoModal } from "@/components/memo/MemoModal";
import { useOutputFeedback } from "@/hooks/useOutputFeedback";

const HERITAGE_GOLD = "#d4a84b";
const DC_ESPRESSO = "#1a1208";

export interface DCAnalystSectionProps {
  sectionKey: string;
  title: string;
  content: string;
  briefSource: "Morning Brief" | "Evening Wrap";
  currentRating: number;
  onRate: (sectionKey: string, rating: 1 | -1) => void;
  outputId?: string | null;
}

export function DCAnalystSection({
  sectionKey,
  title,
  content,
  briefSource,
  currentRating,
  onRate,
  outputId,
}: DCAnalystSectionProps) {
  const [memoOpen, setMemoOpen] = useState(false);
  const router = useRouter();
  const { ref: feedbackRef, setThumbs, recordFollowup } = useOutputFeedback({
    output_id: outputId,
  });

  const plain = stripHtml(content);

  // Option A consolidation: this action makes a CALL via the author flow,
  // pre-filled from the section title. The user edits direction/window before
  // committing; the click writes nothing.
  const handleMakeCall = () => {
    router.push(makeCallLink(title));
  };

  return (
    <div
      ref={feedbackRef as React.RefObject<HTMLDivElement>}
      style={{
        background: "var(--elevated)",
        border: "1px solid var(--border-base)",
        borderRadius: 14,
        borderLeft: `4px solid ${HERITAGE_GOLD}`,
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <h3
        className="font-[family-name:var(--font-playfair-display)]"
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: "var(--espresso)",
          margin: 0,
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h3>
      <p
        className="font-sans"
        style={{
          fontSize: 13,
          lineHeight: 1.6,
          color: "var(--text-primary)",
          margin: 0,
          whiteSpace: "pre-line",
        }}
      >
        {plain}
      </p>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginTop: "auto",
          paddingTop: 8,
          borderTop: "1px solid var(--border-subtle)",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={() => { setMemoOpen(true); recordFollowup(); }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            borderRadius: 8,
            background: HERITAGE_GOLD,
            color: DC_ESPRESSO,
            border: "none",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          <Sparkles size={11} />
          Generate Memo
        </button>
        <button
          type="button"
          onClick={handleMakeCall}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            borderRadius: 8,
            background: "var(--parchment-mid)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border-base)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Plus size={11} />
          Make a call
        </button>

        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span
            className="font-sans"
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: "var(--text-muted)",
              marginRight: 4,
            }}
          >
            Useful?
          </span>
          <button
            type="button"
            onClick={() => { onRate(sectionKey, 1); setThumbs("up"); }}
            aria-label="Mark useful"
            style={{
              padding: 5,
              borderRadius: 6,
              background: "none",
              border: "none",
              cursor: "pointer",
              color: currentRating === 1 ? HERITAGE_GOLD : "var(--text-faint)",
            }}
          >
            <ThumbsUp size={13} />
          </button>
          <button
            type="button"
            onClick={() => { onRate(sectionKey, -1); setThumbs("down"); }}
            aria-label="Mark not useful"
            style={{
              padding: 5,
              borderRadius: 6,
              background: "none",
              border: "none",
              cursor: "pointer",
              color: currentRating === -1 ? HERITAGE_GOLD : "var(--text-faint)",
            }}
          >
            <ThumbsDown size={13} />
          </button>
        </div>
      </div>

      <MemoModal
        isOpen={memoOpen}
        onClose={() => setMemoOpen(false)}
        title={title}
        content={plain}
        type="brief"
      />
    </div>
  );
}

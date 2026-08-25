"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./ask.module.css";
import { CONTENT_BOX, PAD } from "./ask-parts";

/**
 * The chip row and the composer, byte identical on both Ask screens in the
 * design, so one extraction with no variant axis.
 *
 * The design draws the field as a div that navigates to Search on tap. Both Ask
 * states live on `/ask`, so this is a real form instead: submitting sets `?q=`
 * and the same route renders the answer. That keeps the field a real control
 * with a real label, and it avoids pointing the primary affordance of the
 * screen at `/search`, which is a different unit and does not exist yet.
 */

function askHref(question: string): string {
  return `/ask?q=${encodeURIComponent(question)}`;
}

export function AskComposer({ prompts }: { prompts?: readonly [string, string] }) {
  const router = useRouter();
  const [value, setValue] = useState("");

  return (
    <>
      <div
        style={{
          flex: "none",
          display: "flex",
          flexWrap: "wrap",
          gap: "10px",
          padding: `10px ${PAD} 0`,
        }}
      >
        {(prompts ?? []).map((prompt) => (
          <Link
            key={prompt}
            href={askHref(prompt)}
            style={{
              ...CONTENT_BOX,
              flex: "none",
              minHeight: "44px",
              display: "flex",
              alignItems: "center",
              padding: "0 12px",
              border: "1px solid var(--c-border)",
              borderRadius: "9px",
              backgroundColor: "var(--c-surface)",
              font: "400 11.5px/1 Inter, sans-serif",
              color: "var(--c-secondary)",
              whiteSpace: "nowrap",
              textDecoration: "none",
            }}
          >
            {prompt}
          </Link>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const q = value.trim();
          if (!q) return;
          router.push(askHref(q));
          /* The field does not clear itself. Measured on the running page:
             submitting from the answer leaves the last question in the field,
             because `/ask?q=a` to `/ask?q=b` is a same-pathname navigation and
             PageTransition keys on pathname; and submitting from browse leaves
             it too, because this composer is the same element type in the same
             position in both trees, so React reconciles it rather than
             remounting it. Both cases left the question sitting under a cursor
             as though it had not been sent. */
          setValue("");
        }}
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: "9px",
          padding: `12px ${PAD} 14px`,
        }}
      >
        <label htmlFor="ask-composer" className="sr-only">
          Ask about your market intelligence
        </label>
        <input
          id="ask-composer"
          name="q"
          type="text"
          autoComplete="off"
          className={styles.field}
          placeholder="Ask about your market intelligence"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{
            ...CONTENT_BOX,
            flex: 1,
            minWidth: 0,
            minHeight: "48px",
            padding: "0 15px",
            border: "1px solid var(--c-border)",
            borderRadius: "12px",
            backgroundColor: "var(--c-surface)",
            font: "400 13px/1 Inter, sans-serif",
            color: "var(--c-ink)",
          }}
        />
        <button
          type="submit"
          aria-label="Send"
          style={{
            flex: "none",
            width: "48px",
            height: "48px",
            borderRadius: "12px",
            backgroundColor: "var(--c-inverse)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            cursor: "pointer",
          }}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--c-gold)"
            strokeWidth="1.9"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 19V5M6 11l6-6 6 6" />
          </svg>
        </button>
      </form>
    </>
  );
}

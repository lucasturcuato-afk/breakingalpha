import Link from "next/link";
import { AskComposer } from "./ask-composer";
import { AskNotice, AskSkeleton, CONTENT_BOX, IconBack, PAD } from "./ask-parts";
import styles from "./ask.module.css";
import {
  ASK_ANSWER_FIXTURE,
  ASK_FIXTURE_ENABLED,
  EMPTY_KB_ANSWER,
  type AnswerRecordCitation,
  type AskAnswerData,
} from "./fixture";
import type { AskStage } from "./ask-browse-screen";

/**
 * Ask, answer.
 *
 * The screen exists to cite the reader's own ledger. The prototype's answer
 * cites nothing else, and nothing else is added here: the intelligence route
 * already emits a `sources` array of articles and theses that no client reads,
 * and rendering it would put third-party citations in front of the reader's own
 * call. The record block keeps the position the design gives it, at the close
 * of the assistant turn, and it is the only citation on the screen.
 *
 * `showNav` at prototype line 3460 excludes `answer`, so the design draws this
 * as a pushed screen with a back chevron and no tab bar. Both Ask states live
 * on one route here, so the bar stays and the chevron clears `?q=` instead.
 * Recorded as a deviation in the PR body.
 */

export function AskAnswerScreen({
  stage = "ready",
  question,
  data = ASK_ANSWER_FIXTURE,
}: {
  stage?: AskStage;
  /** What the reader actually typed. Echoed only when no fixture answers it. */
  question: string;
  data?: AskAnswerData;
}) {
  /* The fixture answers exactly one question. Echoing a different one above it
     would put a fabricated pairing on the screen, so while the fixture supplies
     the answer it also supplies the question. Off the fixture there is no
     invented answer to contradict, and the reader's own words are echoed. */
  const asked = ASK_FIXTURE_ENABLED ? data.question : question;
  const effective: AskStage | "unwired" = ASK_FIXTURE_ENABLED ? stage : "unwired";

  return (
    <div
      data-parity="answer"
      /* This is the state the entrance exists for. PageTransition keys on
         pathname and browse to answer is a query change on one path, so
         without this the answer would arrive with no entrance at all. */
      className={styles.enter}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100dvh - var(--mobile-tabbar-height) - env(safe-area-inset-bottom))",
        backgroundColor: "var(--c-bg)",
      }}
    >
      {/* The answer screen draws no heading. `mobileFullBleed` gates the
          topbar out below md, and unlike browse there is no visible h1, so
          without this the mobile answer document has no heading at all. Costs
          one unmatched element in the parity fingerprint, named in the PR
          body, which is the right trade for a document that has a heading. */}
      <h1 className="sr-only">Ask</h1>

      <div
        style={{
          ...CONTENT_BOX,
          flex: "none",
          minHeight: "48px",
          display: "flex",
          alignItems: "center",
          padding: `0 ${PAD}`,
          borderBottom: "1px solid var(--c-border)",
        }}
      >
        {/* `replace`, not a push. This chevron is the screen's back affordance,
            and pushing /ask on top of the answer leaves the answer one hardware
            back-press away, so a reader who taps the chevron and then presses
            the phone's back button walks forward into the answer they left. */}
        <Link
          href="/ask"
          replace
          style={{
            minHeight: "44px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            font: "500 13px/1 Inter, sans-serif",
            color: "var(--c-secondary)",
            textDecoration: "none",
          }}
        >
          {IconBack}
          Ask
        </Link>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: `14px ${PAD} 0`,
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        <div style={{ flex: "none", display: "flex", justifyContent: "flex-end" }}>
          <div
            style={{
              maxWidth: "82%",
              padding: "12px 15px",
              borderRadius: "14px",
              backgroundColor: "var(--c-well)",
              border: "1px solid var(--c-border)",
              font: "400 13.5px/1.55 Inter, sans-serif",
              color: "var(--c-ink)",
            }}
          >
            {asked}
          </div>
        </div>

        <div style={{ flex: "none", display: "flex", flexDirection: "column", gap: "11px" }}>
          {effective === "stale" ? <AskNotice style={{ margin: 0 }}>{data.answeredAt}</AskNotice> : null}

          {effective === "loading" ? (
            <>
              <AskSkeleton width="100%" height={13} />
              <AskSkeleton width="94%" height={13} />
              <AskSkeleton width="62%" height={13} />
            </>
          ) : null}

          {effective === "error" ? (
            <AskNotice style={{ margin: 0 }}>
              The desk could not answer that one. Nothing was retrieved, which is a failed read and not an empty
              record. Ask again, or open the research assistant.
            </AskNotice>
          ) : null}

          {effective === "empty" ? <AnswerParagraph text={EMPTY_KB_ANSWER} /> : null}

          {effective === "unwired" ? (
            <AskNotice style={{ margin: 0 }}>
              This surface does not answer yet.{" "}
              <Link href="/intelligence" style={{ color: "var(--c-goldink)", textDecoration: "underline" }}>
                The research assistant
              </Link>{" "}
              answers from the same intelligence today.
            </AskNotice>
          ) : null}

          {effective === "ready" || effective === "stale"
            ? data.blocks.map((block, i) =>
                block.kind === "head" ? (
                  <p
                    key={i}
                    style={{
                      margin: 0,
                      font: "700 16px/1.3 'Playfair Display', serif",
                      color: "var(--c-ink)",
                    }}
                  >
                    {block.text}
                  </p>
                ) : (
                  <AnswerParagraph key={i} text={block.text} />
                ),
              )
            : null}

          {(effective === "ready" || effective === "stale") && data.record ? (
            <RecordCitation record={data.record} />
          ) : null}
        </div>
      </div>

      {/* The two chips come off the data, not off a second hardcoded pair here.
          Two sources for one pair means a `data` override silently keeps the
          fixture's chips. */}
      <AskComposer prompts={data.prompts} />
    </div>
  );
}

function AnswerParagraph({ text }: { text: string }) {
  return (
    <p
      style={{
        margin: 0,
        font: "400 13.5px/1.65 Inter, sans-serif",
        color: "var(--c-body)",
        textWrap: "pretty",
      }}
    >
      {text}
    </p>
  );
}

/**
 * The one citation on the screen, and the reader's own. Not a link: the claim
 * screen it would open is a different unit and does not exist yet, and a
 * citation that navigates nowhere is worse than one that simply states itself.
 */
function RecordCitation({ record }: { record: AnswerRecordCitation }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        border: "1px solid var(--c-border)",
        borderRadius: "9px",
        backgroundColor: "var(--c-surface)",
      }}
    >
      <div
        style={{
          font: "400 10px/1 'JetBrains Mono', monospace",
          letterSpacing: "0.07em",
          color: "var(--c-muted)",
        }}
      >
        {record.eyebrow}
      </div>
      <p
        style={{
          margin: "8px 0 0",
          font: "400 italic 13.5px/1.55 'Playfair Display', serif",
          color: "var(--c-ink)",
        }}
      >
        {record.claim}
      </p>
      <p
        style={{
          margin: "8px 0 0",
          font: "400 11.5px/1.5 Inter, sans-serif",
          color: "var(--c-secondary)",
        }}
      >
        {record.meta}
      </p>
    </div>
  );
}

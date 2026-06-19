/**
 * parse-memo.ts -- pure helper that splits the freeform Markdown memo
 * emitted by /api/memo (article-grounded company memo, prose path) into
 * named sections keyed by `**LABEL**` headings.
 *
 * The article-grounded memo prompt emits five bold section labels in each
 * mode (Analyst Brief, What Just Changed | Coverage Note, Cross-Signals,
 * What To Watch, Signal Quality). BriefTab uses this parser to
 * render each section under its own heading without coupling to the
 * structured-output schema we abandoned in PR-C1c.
 *
 * If the model deviates from the bold-label convention and the parse
 * yields fewer than two distinct sections, we return an empty section
 * map and surface `rawMarkdown` so the caller can fall back to rendering
 * the unsplit Markdown body. This keeps the UI graceful when Gemini
 * occasionally drops or merges labels. The threshold is lower than the
 * prompt's six-label contract to fail open on short briefs and to keep
 * single-section memos visible during prompt iteration.
 *
 * Section labels are preserved in the case the model emits (typically
 * Title Case). Callers that want all-caps presentation should apply
 * `text-transform: uppercase` in CSS rather than relying on the parser
 * to normalize the key.
 */

export interface ParsedMemo {
  sections: Record<string, string>;
  rawMarkdown: string;
}

const LABEL_RE = /^\*\*([A-Z][\w\s\-/]+)\*\*\s*$/;

export function parseMemo(markdown: string): ParsedMemo {
  const lines = markdown.split("\n");
  const sections: Record<string, string> = {};
  let currentLabel: string | null = null;
  let currentBody: string[] = [];

  const flush = () => {
    if (currentLabel !== null) {
      sections[currentLabel] = currentBody.join("\n").trim();
    }
  };

  for (const line of lines) {
    const match = line.match(LABEL_RE);
    if (match) {
      flush();
      currentLabel = match[1].trim();
      currentBody = [];
    } else if (currentLabel !== null) {
      currentBody.push(line);
    }
  }
  flush();

  if (Object.keys(sections).length < 2) {
    return { sections: {}, rawMarkdown: markdown };
  }

  return { sections, rawMarkdown: markdown };
}

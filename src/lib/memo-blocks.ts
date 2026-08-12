/**
 * Memo block model.
 *
 * Memos are stored as a single free-form string produced by Gemini
 * (`/api/memo` returns `completion.text`). There is no upstream structured
 * document for a memo the way there is for a briefing row, so the string is
 * the artifact of record. This module turns that string into the same typed
 * block list the on-screen ReactMarkdown renderer derives, so the PDF and the
 * web view are driven by one shape.
 *
 * This is deliberately NOT a general markdown parser and it never reads a
 * downloaded file. It tokenizes the in-memory memo the modals already hold.
 */

export interface MemoInline {
  text: string;
  bold: boolean;
}

export type MemoBlock =
  | { kind: "heading"; level: 1 | 2 | 3; runs: MemoInline[] }
  | { kind: "paragraph"; runs: MemoInline[] }
  | { kind: "bullet"; runs: MemoInline[] }
  | { kind: "ordered"; marker: string; runs: MemoInline[] }
  | { kind: "rule" };

/** Drop link/image syntax and code ticks, keeping the visible text. */
function stripDecorations(input: string): string {
  return input
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1");
}

/** Remove single-marker emphasis once bold runs have been extracted. */
function stripEmphasis(input: string): string {
  return input.replace(/\*([^*]+)\*/g, "$1").replace(/_([^_]+)_/g, "$1");
}

/** Split a line into bold and plain runs. */
export function parseInline(raw: string): MemoInline[] {
  const src = stripDecorations(raw);
  const runs: MemoInline[] = [];
  const boldRe = /(\*\*|__)(.+?)\1/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = boldRe.exec(src)) !== null) {
    if (match.index > cursor) {
      runs.push({ text: stripEmphasis(src.slice(cursor, match.index)), bold: false });
    }
    runs.push({ text: stripEmphasis(match[2]), bold: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < src.length) {
    runs.push({ text: stripEmphasis(src.slice(cursor)), bold: false });
  }

  return runs.filter((run) => run.text.length > 0);
}

const RULE_RE = /^(-{3,}|\*{3,}|_{3,})$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^[-*•]\s+(.*)$/;
const ORDERED_RE = /^(\d+)[.)]\s+(.*)$/;
const WRAPPED_BOLD_RE = /^\*\*(.+)\*\*$/;
// The deal memo editor emits bare ALL CAPS section titles rather than #
// headings. Same rule the on-screen parser in memo-editor.tsx applies.
const CAPS_HEADING_RE = /^[A-Z][A-Z &/']+$/;

export function parseMemoBlocks(memo: string): MemoBlock[] {
  const blocks: MemoBlock[] = [];

  for (const rawLine of memo.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    if (RULE_RE.test(line)) {
      blocks.push({ kind: "rule" });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length, 3) as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, runs: parseInline(heading[2]) });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      blocks.push({ kind: "bullet", runs: parseInline(bullet[1]) });
      continue;
    }

    const ordered = ORDERED_RE.exec(line);
    if (ordered) {
      blocks.push({
        kind: "ordered",
        marker: `${ordered[1]}.`,
        runs: parseInline(ordered[2]),
      });
      continue;
    }

    const wrapped = WRAPPED_BOLD_RE.exec(line);
    if (wrapped && !/[.!?]$/.test(wrapped[1].trim())) {
      blocks.push({ kind: "heading", level: 3, runs: parseInline(wrapped[1]) });
      continue;
    }

    if (CAPS_HEADING_RE.test(line)) {
      blocks.push({ kind: "heading", level: 3, runs: parseInline(line) });
      continue;
    }

    blocks.push({ kind: "paragraph", runs: parseInline(line) });
  }

  return blocks;
}

/**
 * Normalize a caller-supplied base name into a safe PDF filename. The two
 * memo surfaces use different base names (`Title_memo` vs `memo-company`), so
 * the base travels with the request; this strips anything that could break out
 * of the Content-Disposition header and forces the .pdf extension.
 */
export function sanitizePdfFilename(raw: string | undefined): string {
  const base = (raw ?? "")
    .replace(/\.(md|pdf)$/i, "")
    .replace(/\s+/g, "_")
    .replace(/[^\w.-]/g, "")
    .slice(0, 120);
  return `${base || "memo"}.pdf`;
}

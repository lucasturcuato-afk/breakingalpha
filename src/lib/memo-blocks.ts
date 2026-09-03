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

/** One key-value pair inside a snapshot block. */
export interface MemoSnapshotEntry {
  label: string;
  value: MemoInline[];
}

export type MemoBlock =
  | { kind: "heading"; level: 1 | 2 | 3; runs: MemoInline[] }
  | { kind: "paragraph"; runs: MemoInline[] }
  | { kind: "bullet"; depth: number; runs: MemoInline[] }
  | { kind: "ordered"; depth: number; marker: string; runs: MemoInline[] }
  | { kind: "rule" }
  | { kind: "table"; header: MemoInline[][] | null; rows: MemoInline[][][] }
  | { kind: "snapshot"; title: string; entries: MemoSnapshotEntry[] };

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

/** Flatten runs back to plain text, for matching and emptiness checks. */
function runsText(runs: MemoInline[]): string {
  return runs.map((r) => r.text).join("").trim();
}

const RULE_RE = /^(-{3,}|\*{3,}|_{3,})$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^[-*•]\s+(.*)$/;
const ORDERED_RE = /^(\d+)[.)]\s+(.*)$/;
const WRAPPED_BOLD_RE = /^\*\*(.+)\*\*$/;
// The deal memo editor emits bare ALL CAPS section titles rather than #
// headings. Same rule the on-screen parser in memo-editor.tsx applies.
const CAPS_HEADING_RE = /^[A-Z][A-Z &/']+$/;

const TABLE_ROW_RE = /^\|(.+)\|$/;
const TABLE_DIVIDER_RE = /^\|[\s:|-]+\|$/;

/** Heading that opens a key-value snapshot section. */
const SNAPSHOT_HEADING_RE = /^(deal\s+snapshot|snapshot)$/i;
/** "Label: value" inside a snapshot section. */
const SNAPSHOT_ENTRY_RE = /^([^:]{1,48}):\s*(.+)$/;

/**
 * Bodies the model emits when a section has nothing in it. A section whose
 * entire body starts with one of these is dropped rather than printed as a
 * heading over dead text.
 *
 * This list is explicit on purpose. A fuzzy heuristic (short body, low word
 * count, contains "no") would silently eat real content such as a one-line
 * finding, and the failure would be invisible in the exported file. Add new
 * phrases here as they are observed in real memos.
 */
export const PLACEHOLDER_BODY_PREFIXES = [
  "not enough information",
  "no key dates are provided",
  "no key dates provided",
  "no specific key dates",
  "none provided",
  "not provided",
  "not specified",
  "not disclosed",
  "no additional information",
  "information not available",
  "no information available",
];

function isPlaceholderBody(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (normalized.length === 0) return true;
  return PLACEHOLDER_BODY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/** Leading whitespace to a nesting depth, capped so runaway indents stay sane. */
function indentDepth(rawLine: string): number {
  const leading = rawLine.length - rawLine.trimStart().length;
  return Math.min(Math.floor(leading / 2), 2);
}

/** Split a markdown table row on unescaped pipes. */
function splitRow(line: string): string[] {
  const inner = TABLE_ROW_RE.exec(line.trim());
  const body = inner ? inner[1] : line.trim().replace(/^\||\|$/g, "");
  return body.split("|").map((cell) => cell.trim());
}

/**
 * Read a markdown table starting at `start`. Returns the block and the index
 * of the first line after the table, or null if this is not a table.
 */
function readTable(
  lines: string[],
  start: number,
): { block: MemoBlock; next: number } | null {
  const first = lines[start].trim();
  if (!TABLE_ROW_RE.test(first)) return null;

  const second = start + 1 < lines.length ? lines[start + 1].trim() : "";
  const hasHeader = TABLE_DIVIDER_RE.test(second);

  let cursor = hasHeader ? start + 2 : start;
  const header = hasHeader ? splitRow(first).map(parseInline) : null;
  const rows: MemoInline[][][] = [];

  if (!hasHeader) {
    // A pipe row with no divider is only a table if more pipe rows follow.
    if (!(start + 1 < lines.length && TABLE_ROW_RE.test(second))) return null;
  }

  while (cursor < lines.length) {
    const line = lines[cursor].trim();
    if (!TABLE_ROW_RE.test(line)) break;
    if (TABLE_DIVIDER_RE.test(line)) {
      cursor += 1;
      continue;
    }
    rows.push(splitRow(line).map(parseInline));
    cursor += 1;
  }

  if (header === null && rows.length === 0) return null;
  return { block: { kind: "table", header, rows }, next: cursor };
}

/**
 * Read a snapshot section: a "Deal Snapshot" heading followed by
 * "Label: value" lines, bulleted or bare. Returns null when the following
 * lines are prose rather than key-value pairs.
 */
function readSnapshot(
  lines: string[],
  start: number,
  title: string,
): { block: MemoBlock; next: number } | null {
  const entries: MemoSnapshotEntry[] = [];
  let cursor = start;

  while (cursor < lines.length) {
    const line = lines[cursor].trim();
    if (!line) {
      cursor += 1;
      continue;
    }
    if (HEADING_RE.test(line) || RULE_RE.test(line) || CAPS_HEADING_RE.test(line)) break;

    const bullet = BULLET_RE.exec(line);
    const candidate = bullet ? bullet[1] : line;
    const entry = SNAPSHOT_ENTRY_RE.exec(candidate.replace(/\*\*/g, ""));
    if (!entry) break;

    entries.push({ label: entry[1].trim(), value: parseInline(entry[2]) });
    cursor += 1;
  }

  if (entries.length < 2) return null;
  return { block: { kind: "snapshot", title, entries }, next: cursor };
}

function parseRaw(memo: string): MemoBlock[] {
  const lines = memo.split("\n");
  const blocks: MemoBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) {
      i += 1;
      continue;
    }

    if (RULE_RE.test(line)) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }

    const table = readTable(lines, i);
    if (table) {
      blocks.push(table.block);
      i = table.next;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const text = heading[2].trim();
      if (SNAPSHOT_HEADING_RE.test(text.replace(/[*:]/g, "").trim())) {
        const snapshot = readSnapshot(lines, i + 1, text);
        if (snapshot) {
          blocks.push(snapshot.block);
          i = snapshot.next;
          continue;
        }
      }
      const level = Math.min(heading[1].length, 3) as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, runs: parseInline(text) });
      i += 1;
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      blocks.push({
        kind: "bullet",
        depth: indentDepth(rawLine),
        runs: parseInline(bullet[1]),
      });
      i += 1;
      continue;
    }

    const ordered = ORDERED_RE.exec(line);
    if (ordered) {
      blocks.push({
        kind: "ordered",
        depth: indentDepth(rawLine),
        marker: `${ordered[1]}.`,
        runs: parseInline(ordered[2]),
      });
      i += 1;
      continue;
    }

    const wrapped = WRAPPED_BOLD_RE.exec(line);
    if (wrapped && !/[.!?]$/.test(wrapped[1].trim())) {
      const text = wrapped[1].trim();
      if (SNAPSHOT_HEADING_RE.test(text.replace(/[*:]/g, "").trim())) {
        const snapshot = readSnapshot(lines, i + 1, text);
        if (snapshot) {
          blocks.push(snapshot.block);
          i = snapshot.next;
          continue;
        }
      }
      blocks.push({ kind: "heading", level: 3, runs: parseInline(text) });
      i += 1;
      continue;
    }

    if (CAPS_HEADING_RE.test(line)) {
      if (SNAPSHOT_HEADING_RE.test(line)) {
        const snapshot = readSnapshot(lines, i + 1, line);
        if (snapshot) {
          blocks.push(snapshot.block);
          i = snapshot.next;
          continue;
        }
      }
      blocks.push({ kind: "heading", level: 3, runs: parseInline(line) });
      i += 1;
      continue;
    }

    // Prose is hard-wrapped in the source. Join continuation lines so a
    // paragraph is one block rather than one block per wrapped line, which
    // would put paragraph spacing between every line.
    const paragraph: string[] = [line];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      const trimmed = next.trim();
      if (!trimmed) break;
      if (
        RULE_RE.test(trimmed) ||
        HEADING_RE.test(trimmed) ||
        BULLET_RE.test(trimmed) ||
        ORDERED_RE.test(trimmed) ||
        TABLE_ROW_RE.test(trimmed) ||
        WRAPPED_BOLD_RE.test(trimmed) ||
        CAPS_HEADING_RE.test(trimmed)
      ) {
        break;
      }
      paragraph.push(trimmed);
      j += 1;
    }
    blocks.push({ kind: "paragraph", runs: parseInline(paragraph.join(" ")) });
    i = j;
  }

  return blocks;
}

/** Plain text of a body block, for placeholder matching. */
function blockText(block: MemoBlock): string {
  switch (block.kind) {
    case "paragraph":
    case "bullet":
    case "ordered":
    case "heading":
      return runsText(block.runs);
    case "rule":
      return "";
    case "table":
      return block.rows.map((row) => row.map(runsText).join(" ")).join(" ").trim();
    case "snapshot":
      return block.entries.map((e) => `${e.label} ${runsText(e.value)}`).join(" ").trim();
  }
}

/**
 * Drop headings whose section body is empty or is a known no-content
 * placeholder. A section runs from a heading to the next heading of the same
 * or shallower level.
 */
function suppressEmptySections(blocks: MemoBlock[]): MemoBlock[] {
  const keep: MemoBlock[] = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];
    if (block.kind !== "heading") {
      keep.push(block);
      i += 1;
      continue;
    }

    let end = i + 1;
    while (end < blocks.length) {
      const next = blocks[end];
      if (next.kind === "heading" && next.level <= block.level) break;
      end += 1;
    }

    const body = blocks.slice(i + 1, end).filter((b) => b.kind !== "rule");
    const bodyText = body.map(blockText).join(" ").trim();

    if (body.length === 0 || isPlaceholderBody(bodyText)) {
      // Drop the heading and its dead body entirely.
      i = end;
      continue;
    }

    keep.push(block);
    i += 1;
  }

  return keep;
}

export function parseMemoBlocks(memo: string): MemoBlock[] {
  return suppressEmptySections(parseRaw(memo));
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

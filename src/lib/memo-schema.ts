// ---------------------------------------------------------------------------
// Structured-output memo schema (PR-C0)
// ---------------------------------------------------------------------------
// Shared type and Gemini responseSchema literal for the article-grounded
// company memo path (type === "company"). Mirrors docs/data (1).jsx lines
// 20-65 exactly: tldr is one paragraph string with embedded [n] markers,
// paragraphs[].kind is the enum (lead | context | watch), sources[]
// carries {n, name, url, type?}.
//
// PR-C1's BriefTab consumes StructuredMemo. The /api/memo route returns
// BOTH this typed object AND a derived Markdown sibling so existing
// watchlist/[identifier] consumers keep reading body.memo unchanged.

export type MemoParagraphKind = "lead" | "context" | "watch";
export type MemoSourceType = "primary" | "tier-1" | "web";

export interface MemoParagraph {
  kind: MemoParagraphKind;
  text: string;
}

export interface MemoSource {
  n: number;
  name: string;
  url: string;
  type?: MemoSourceType;
}

export interface StructuredMemo {
  tldr: string;
  paragraphs: MemoParagraph[];
  sources: MemoSource[];
}

// Gemini responseSchema literal. Matches the shape used elsewhere in the
// codebase (see src/app/api/theses/route.ts for prior art on JSON mode).
// Kept as a plain object literal -- no Zod dep; the project does not use
// Zod today. The route uses validateStructuredMemo below for runtime
// shape verification so we do not have to trust the model's compliance.
export const STRUCTURED_MEMO_SCHEMA = {
  type: "object",
  properties: {
    tldr: { type: "string" },
    paragraphs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["lead", "context", "watch"] },
          text: { type: "string" },
        },
        required: ["kind", "text"],
      },
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" },
          name: { type: "string" },
          url: { type: "string" },
          type: { type: "string", enum: ["primary", "tier-1", "web"] },
        },
        required: ["n", "name", "url"],
      },
    },
  },
  required: ["tldr", "paragraphs", "sources"],
} as const;

// Cheap runtime validator. Returns the typed object on success, null on
// any shape mismatch. Used by the /api/memo route to decide between the
// structured response and the retry / Markdown-fallback path.
export function validateStructuredMemo(input: unknown): StructuredMemo | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;

  if (typeof obj.tldr !== "string" || obj.tldr.length === 0) return null;
  if (!Array.isArray(obj.paragraphs)) return null;
  if (!Array.isArray(obj.sources)) return null;

  const validKinds: MemoParagraphKind[] = ["lead", "context", "watch"];
  for (const p of obj.paragraphs) {
    if (!p || typeof p !== "object") return null;
    const para = p as Record<string, unknown>;
    if (typeof para.text !== "string") return null;
    if (!validKinds.includes(para.kind as MemoParagraphKind)) return null;
  }

  for (const s of obj.sources) {
    if (!s || typeof s !== "object") return null;
    const src = s as Record<string, unknown>;
    if (typeof src.n !== "number") return null;
    if (typeof src.name !== "string") return null;
    if (typeof src.url !== "string") return null;
  }

  return obj as unknown as StructuredMemo;
}

// Render a Markdown sibling for back-compat consumers (watchlist cache,
// existing MemoModal Markdown renderer). The route returns this as the
// `memo` field alongside the typed `structured` field so callers that
// have not migrated to the structured shape keep working unchanged.
export function deriveMemoMarkdown(memo: StructuredMemo): string {
  const lead = memo.paragraphs.find((p) => p.kind === "lead");
  const context = memo.paragraphs.find((p) => p.kind === "context");
  const watch = memo.paragraphs.find((p) => p.kind === "watch");

  const parts: string[] = [];
  parts.push("**Analyst Brief**", memo.tldr.trim());
  if (lead) parts.push("", "**What Just Changed**", lead.text.trim());
  if (context) parts.push("", "**Cross-Signals**", context.text.trim());
  if (watch) parts.push("", "**What To Do With This**", watch.text.trim());

  if (memo.sources.length > 0) {
    parts.push("", "**Sources**");
    for (const s of memo.sources) {
      parts.push(`[${s.n}] ${s.name} ${s.url}`);
    }
  }

  return parts.join("\n");
}

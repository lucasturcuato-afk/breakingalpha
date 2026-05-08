// ---------------------------------------------------------------------------
// Structured-output memo schema (PR-C0 + PR-C1a)
// ---------------------------------------------------------------------------
// Shared type and Gemini responseSchema literal for the article-grounded
// company memo path (type === "company"). Originally each kind was a single
// string; PR-C1a expands lead/context to multi-paragraph arrays and watch to
// a list of {thesis_path, description, probability} items so production
// output retains the analyst-voice density Gemini emits without a schema.
//
// PR-C1's BriefTab consumes StructuredMemo. The /api/memo route returns
// BOTH this typed object AND a derived Markdown sibling so existing
// watchlist/[identifier] consumers keep reading body.memo unchanged.

export type MemoSourceType = "primary" | "tier-1" | "web";
export type MemoThesisPath = "bull" | "bear";
export type MemoProbability = "low" | "medium" | "high";

export interface MemoSource {
  n: number;
  name: string;
  url: string;
  type?: MemoSourceType;
}

export interface MemoLead {
  paragraphs: string[];
}

export interface MemoContext {
  paragraphs: string[];
}

export interface MemoWatchItem {
  thesis_path: MemoThesisPath;
  description: string;
  probability: MemoProbability;
}

export interface MemoWatch {
  items: MemoWatchItem[];
}

export interface StructuredMemo {
  tldr: string;
  lead: MemoLead;
  context: MemoContext;
  watch: MemoWatch;
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
    lead: {
      type: "object",
      properties: {
        paragraphs: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["paragraphs"],
    },
    context: {
      type: "object",
      properties: {
        paragraphs: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["paragraphs"],
    },
    watch: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              thesis_path: { type: "string", enum: ["bull", "bear"] },
              description: { type: "string" },
              probability: { type: "string", enum: ["low", "medium", "high"] },
            },
            required: ["thesis_path", "description", "probability"],
          },
        },
      },
      required: ["items"],
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
  required: ["tldr", "lead", "context", "watch", "sources"],
} as const;

// Cheap runtime validator. Returns the typed object on success, null on
// any shape mismatch. Used by the /api/memo route to decide between the
// structured response and the retry / Markdown-fallback path.
export function validateStructuredMemo(input: unknown): StructuredMemo | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;

  if (typeof obj.tldr !== "string" || obj.tldr.length === 0) return null;

  const lead = obj.lead as Record<string, unknown> | undefined;
  if (!lead || typeof lead !== "object") return null;
  if (!Array.isArray(lead.paragraphs) || lead.paragraphs.length === 0) return null;
  for (const p of lead.paragraphs) {
    if (typeof p !== "string" || p.length === 0) return null;
  }

  const context = obj.context as Record<string, unknown> | undefined;
  if (!context || typeof context !== "object") return null;
  if (!Array.isArray(context.paragraphs) || context.paragraphs.length === 0) return null;
  for (const p of context.paragraphs) {
    if (typeof p !== "string" || p.length === 0) return null;
  }

  const watch = obj.watch as Record<string, unknown> | undefined;
  if (!watch || typeof watch !== "object") return null;
  if (!Array.isArray(watch.items) || watch.items.length === 0) return null;
  const validPaths: MemoThesisPath[] = ["bull", "bear"];
  const validProbs: MemoProbability[] = ["low", "medium", "high"];
  for (const item of watch.items) {
    if (!item || typeof item !== "object") return null;
    const it = item as Record<string, unknown>;
    if (!validPaths.includes(it.thesis_path as MemoThesisPath)) return null;
    if (typeof it.description !== "string" || it.description.length === 0) return null;
    if (!validProbs.includes(it.probability as MemoProbability)) return null;
  }

  if (!Array.isArray(obj.sources)) return null;
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
  const parts: string[] = [];
  parts.push("**Analyst Brief**", memo.tldr.trim());

  if (memo.lead.paragraphs.length > 0) {
    parts.push("", "**What Just Changed**", memo.lead.paragraphs.map((p) => p.trim()).join("\n\n"));
  }

  if (memo.context.paragraphs.length > 0) {
    parts.push("", "**Cross-Signals**", memo.context.paragraphs.map((p) => p.trim()).join("\n\n"));
  }

  if (memo.watch.items.length > 0) {
    parts.push("", "**What To Do With This**");
    for (const item of memo.watch.items) {
      const label = item.thesis_path === "bull" ? "Bull" : "Bear";
      parts.push(`If ${label} [${item.probability}]: ${item.description.trim()}`);
    }
  }

  if (memo.sources.length > 0) {
    parts.push("", "**Sources**");
    for (const s of memo.sources) {
      parts.push(`[${s.n}] ${s.name} ${s.url}`);
    }
  }

  return parts.join("\n");
}

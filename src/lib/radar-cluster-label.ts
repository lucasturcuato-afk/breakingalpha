/**
 * radar-cluster-label — lazy, cached, honest labeling for cluster nodes.
 *
 * One cheap gemini-2.5-flash pass names only the nodes a user can see.
 * Labels are cached per node id (a stable hash of the node's member
 * article ids) in the outputs table plus the in-memory response cache,
 * so a label is generated at most once ever per distinct cluster.
 *
 * HONESTY RULES, enforced structurally, not just by prompt:
 * - Labels are descriptive (what the articles are about), never
 *   evaluative or stance-implying. A blocklist rejects evaluative
 *   words; rejected labels fall back to the generic label.
 * - No duplicate names within one request's sibling set: later
 *   duplicates fall back to the generic label rather than inventing a
 *   crisp-but-misleading distinction.
 * - If the model cannot find a common theme it is instructed to answer
 *   with the generic label, and we keep it.
 */

import { GoogleGenAI } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GENERIC_LABEL } from "@/lib/radar-clusters";
import { recordOutput } from "@/lib/outputs";
import { cacheGet, cacheSet } from "@/lib/response-cache";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const LABEL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TITLES_PER_NODE = 12;
const MAX_LABEL_WORDS = 5;

/** Clearly evaluative / stance words that must never appear in a label. */
const EVALUATIVE = new RegExp(
  "\\b(bullish|bearish|positive|negative|promising|troubling|optimis\\w*|pessimis\\w*|" +
    "strong|weak|strength|weakness|upbeat|gloomy|attractive|unattractive|overvalued|" +
    "undervalued|buy|sell|winner\\w*|loser\\w*|upside|downside|good|bad|great|terrible|" +
    "risky|safe|opportunit\\w*|threat\\w*|momentum|surg\\w*|soar\\w*|plunge\\w*|crash\\w*|" +
    "signal\\w*)\\b",
  "i",
);

export interface LabelRequestNode {
  id: string;
  titles: string[];
}

function sanitizeLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const label = raw.replace(/["""'.]/g, "").replace(/\s+/g, " ").trim();
  if (!label) return null;
  if (label.split(" ").length > MAX_LABEL_WORDS) return null;
  if (label.length > 48) return null;
  if (EVALUATIVE.test(label)) return null;
  return label;
}

async function readCachedLabels(
  supabase: SupabaseClient,
  nodeIds: string[],
): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  const missing: string[] = [];
  for (const id of nodeIds) {
    const hit = cacheGet<string>(`radar-cluster-label:${id}`);
    if (hit) found[id] = hit;
    else missing.push(id);
  }
  if (missing.length === 0) return found;
  try {
    const { data } = await supabase
      .from("outputs")
      .select("content")
      .eq("output_type", "radar_cluster_label")
      .in("content->>node_id", missing)
      .order("created_at", { ascending: false })
      .limit(missing.length * 2);
    for (const row of data ?? []) {
      const content = row.content as { node_id?: string; label?: string } | null;
      if (content?.node_id && content?.label && !found[content.node_id]) {
        found[content.node_id] = content.label;
        cacheSet(`radar-cluster-label:${content.node_id}`, content.label, LABEL_TTL_MS);
      }
    }
  } catch {
    // Cache read failures degrade to regeneration; never block.
  }
  return found;
}

/**
 * Resolve labels for the given nodes: cache first, one LLM call for
 * the rest. Always returns an entry for every requested node; nodes
 * the model cannot name honestly get GENERIC_LABEL. Duplicate names
 * within the request collapse to GENERIC_LABEL past the first.
 */
export async function labelClusterNodes(
  supabase: SupabaseClient,
  nodes: LabelRequestNode[],
  userId?: string | null,
): Promise<Record<string, string>> {
  const labels = await readCachedLabels(
    supabase,
    nodes.map((n) => n.id),
  );
  const pending = nodes.filter((n) => !labels[n.id] && n.titles.length > 0);

  if (pending.length > 0) {
    const blocks = pending
      .map(
        (n, i) =>
          `CLUSTER ${i + 1}:\n${n.titles
            .slice(0, MAX_TITLES_PER_NODE)
            .map((t) => `- ${t.slice(0, 160)}`)
            .join("\n")}`,
      )
      .join("\n\n");

    const prompt = `You label groups of financial news articles for a map view. For each cluster below, produce one short topical label (2-4 words) naming WHAT the articles are about, like a section heading.

Rules:
- Descriptive only: name the subject matter (e.g. "Datacenter buildout", "Chip supply", "Rate cut expectations"). NEVER evaluative, never a stance, never sentiment words (no bullish/bearish/positive/strong/promising etc).
- Base the label ONLY on the titles shown. Do not invent specifics that are not there.
- If a cluster has no clear common theme, answer exactly "${GENERIC_LABEL}" for it. An honest generic label beats a crisp misleading one.
- Labels must be distinct from each other.

Respond with a JSON array of strings, one label per cluster, in order. Nothing else.

${blocks}`;

    try {
      const completion = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          temperature: 0.2,
          maxOutputTokens: 400,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      const raw = (completion.text || "").replace(/```json|```/g, "").trim();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const arrayMatch = raw.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          try {
            parsed = JSON.parse(arrayMatch[0]);
          } catch {
            parsed = null;
          }
        }
      }
      const arr = Array.isArray(parsed) ? parsed : [];
      pending.forEach((n, i) => {
        labels[n.id] = sanitizeLabel(arr[i]) ?? GENERIC_LABEL;
      });
    } catch (e) {
      console.error("[radar-cluster-label] Gemini labeling failed:", e instanceof Error ? e.message : e);
      pending.forEach((n) => {
        labels[n.id] = GENERIC_LABEL;
      });
    }
  }

  // Distinctness within this request: later duplicates go generic.
  const seen = new Set<string>();
  for (const n of nodes) {
    const label = labels[n.id] ?? GENERIC_LABEL;
    const key = label.toLowerCase();
    if (label !== GENERIC_LABEL && seen.has(key)) {
      labels[n.id] = GENERIC_LABEL;
    } else {
      seen.add(key);
      labels[n.id] = label;
    }
  }

  // Persist fresh, non-generic labels (fire-and-forget; recordOutput never throws).
  for (const n of pending) {
    const label = labels[n.id];
    cacheSet(`radar-cluster-label:${n.id}`, label, LABEL_TTL_MS);
    if (label !== GENERIC_LABEL) {
      void recordOutput(supabase, {
        output_type: "radar_cluster_label",
        content: { node_id: n.id, label },
        generation_context: { titles_sample: n.titles.slice(0, 3) },
        user_id: userId ?? null,
      });
    }
  }

  return labels;
}

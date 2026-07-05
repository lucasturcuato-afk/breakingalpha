/**
 * POST /api/radar/clusters — the shared per-topic clustering resource.
 *
 * Body: { article_ids: string[] }
 * Response: { tree: ClusterTree | null, reason?: string }
 *
 * Computes semantic clusters over the given article set from the
 * embeddings the pipeline already generates (content_embeddings,
 * vector(768), gemini-embedding-001), labels the TOP level only (the
 * rest label lazily via /api/radar/clusters/label when expanded), and
 * caches the whole tree keyed by the article-id-set hash: in-memory
 * first, then the outputs table (memo-cache precedent). Same articles
 * -> same tree for every user and every view; the computation happens
 * once.
 *
 * Degrades honestly: if embeddings are missing for the whole set (or
 * the table is unreachable) it returns tree=null and the client falls
 * back to its heuristic grouping. No migrations required by any path.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { getServiceSupabase } from "@/lib/supabase-service";
import {
  buildClusterTree,
  applyLabels,
  hashIdSet,
  type ClusterTree,
} from "@/lib/radar-clusters";
import { labelClusterNodes } from "@/lib/radar-cluster-label";
import { recordOutput } from "@/lib/outputs";
import { cacheGet, cacheSet } from "@/lib/response-cache";

export const dynamic = "force-dynamic";

const MAX_ARTICLES = 300;
const TREE_MEMORY_TTL_MS = 6 * 60 * 60 * 1000;
const TREE_DB_TTL_HOURS = 24 * 7;

async function readStoredTree(key: string): Promise<ClusterTree | null> {
  try {
    const service = getServiceSupabase();
    const cutoff = new Date(Date.now() - TREE_DB_TTL_HOURS * 3600_000).toISOString();
    const { data } = await service
      .from("outputs")
      .select("content")
      .eq("output_type", "radar_clusters")
      .eq("content->>cluster_key", key)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1);
    const content = data?.[0]?.content as { tree?: ClusterTree } | null;
    return content?.tree ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const { user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { article_ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const ids = Array.isArray(body.article_ids)
    ? [...new Set(body.article_ids.filter((x): x is string => typeof x === "string"))].slice(
        0,
        MAX_ARTICLES,
      )
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "article_ids required" }, { status: 400 });
  }

  const key = hashIdSet(ids);
  const memoryKey = `radar-clusters:${key}`;

  const cached = cacheGet<ClusterTree>(memoryKey);
  if (cached) {
    return NextResponse.json({ tree: cached, cached: true });
  }

  const stored = await readStoredTree(key);
  if (stored) {
    cacheSet(memoryKey, stored, TREE_MEMORY_TTL_MS);
    return NextResponse.json({ tree: stored, cached: true });
  }

  let service;
  try {
    service = getServiceSupabase();
  } catch {
    return NextResponse.json({ tree: null, reason: "service_unavailable" });
  }

  // Vectors for this article set; whatever lacks one folds into the
  // generic bucket instead of being dropped.
  const { data: rows, error } = await service
    .from("content_embeddings")
    .select("content_id, embedding")
    .eq("content_type", "article")
    .in("content_id", ids);
  if (error) {
    console.error("[radar-clusters] embeddings fetch failed:", error.message);
    return NextResponse.json({ tree: null, reason: "embeddings_unavailable" });
  }

  const items: { id: string; vector: number[] }[] = [];
  for (const row of rows ?? []) {
    try {
      const vector =
        typeof row.embedding === "string" ? JSON.parse(row.embedding) : row.embedding;
      if (Array.isArray(vector) && vector.length > 0) {
        items.push({ id: row.content_id as string, vector: vector as number[] });
      }
    } catch {
      // Unparseable vector -> treated as unembedded below.
    }
  }
  const embedded = new Set(items.map((i) => i.id));
  const unembedded = ids.filter((id) => !embedded.has(id));

  if (items.length < 2) {
    return NextResponse.json({ tree: null, reason: "too_few_embeddings" });
  }

  let tree = buildClusterTree(items, unembedded);

  // Label the top level now (what the user sees on open); deeper
  // levels label on expansion via /api/radar/clusters/label.
  const topNodes = tree.clusters.filter((c) => !c.generic);
  if (topNodes.length > 0) {
    const { data: titleRows } = await service
      .from("articles")
      .select("id, title")
      .in(
        "id",
        topNodes.flatMap((n) => n.articleIds),
      );
    const titleById = new Map<string, string>(
      (titleRows ?? []).map((r) => [r.id as string, r.title as string]),
    );
    const labels = await labelClusterNodes(
      service,
      topNodes.map((n) => ({
        id: n.id,
        titles: n.articleIds.map((id) => titleById.get(id)).filter((t): t is string => !!t),
      })),
      user.id,
    );
    tree = applyLabels(tree, labels);
  }

  cacheSet(memoryKey, tree, TREE_MEMORY_TTL_MS);
  void recordOutput(service, {
    output_type: "radar_clusters",
    content: { cluster_key: key, tree },
    generation_context: { article_count: ids.length, embedded: items.length },
    user_id: user.id,
  });

  return NextResponse.json({ tree });
}

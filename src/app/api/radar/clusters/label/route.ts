/**
 * POST /api/radar/clusters/label — lazy labeling for cluster nodes the
 * user has just expanded into view.
 *
 * Body: { nodes: [{ id: string, article_ids: string[] }] }
 * Response: { labels: { [nodeId]: string } }
 *
 * Titles are fetched server-side from the articles table (never
 * client-supplied) so the shared label cache cannot be poisoned.
 * Labels cache per node id; a given cluster is labeled at most once
 * ever, across users and views.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { getServiceSupabase } from "@/lib/supabase-service";
import { labelClusterNodes } from "@/lib/radar-cluster-label";

export const dynamic = "force-dynamic";

const MAX_NODES = 12;
const MAX_IDS_PER_NODE = 40;

export async function POST(req: NextRequest) {
  const { user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { nodes?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const nodes = (Array.isArray(body.nodes) ? body.nodes : [])
    .filter(
      (n): n is { id: string; article_ids: string[] } =>
        !!n &&
        typeof (n as { id?: unknown }).id === "string" &&
        Array.isArray((n as { article_ids?: unknown }).article_ids),
    )
    .slice(0, MAX_NODES)
    .map((n) => ({
      id: n.id,
      article_ids: n.article_ids.filter((x): x is string => typeof x === "string").slice(0, MAX_IDS_PER_NODE),
    }))
    .filter((n) => n.article_ids.length > 0);

  if (nodes.length === 0) {
    return NextResponse.json({ error: "nodes required" }, { status: 400 });
  }

  let service;
  try {
    service = getServiceSupabase();
  } catch {
    return NextResponse.json({ labels: {} });
  }

  const allIds = [...new Set(nodes.flatMap((n) => n.article_ids))];
  const { data: titleRows } = await service.from("articles").select("id, title").in("id", allIds);
  const titleById = new Map<string, string>(
    (titleRows ?? []).map((r) => [r.id as string, r.title as string]),
  );

  const labels = await labelClusterNodes(
    service,
    nodes.map((n) => ({
      id: n.id,
      titles: n.article_ids.map((id) => titleById.get(id)).filter((t): t is string => !!t),
    })),
    user.id,
  );

  return NextResponse.json({ labels });
}

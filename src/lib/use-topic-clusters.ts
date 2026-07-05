"use client";

/**
 * useTopicClusters — client access to the shared clustering resource.
 *
 * One fetch per distinct article-id set, deduped through a
 * module-level promise cache, so the map, the grouped list, and the
 * group-jump nav on the same page all consume the SAME tree without
 * refetching (and the server caches across users on top of that).
 *
 * labelNodes() lazily names nodes as the user expands them; resolved
 * labels merge into the tree in place (module cache included) so a
 * label is requested at most once per session and at most one LLM call
 * ever happens per distinct cluster server-side.
 *
 * status: "loading" | "ready" | "unavailable" — unavailable means the
 * article set has no usable embeddings; consumers fall back to their
 * heuristic grouping and say so honestly.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyLabels,
  hashIdSet,
  type ClusterTree,
  type ClusterNode,
} from "@/lib/radar-clusters";

type Status = "idle" | "loading" | "ready" | "unavailable";

const treeCache = new Map<string, Promise<ClusterTree | null>>();
const resolvedTrees = new Map<string, ClusterTree>();
const requestedLabels = new Set<string>();

async function fetchTree(ids: string[]): Promise<ClusterTree | null> {
  try {
    const res = await fetch("/api/radar/clusters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ article_ids: ids }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { tree?: ClusterTree | null };
    return json.tree ?? null;
  } catch {
    return null;
  }
}

export function useTopicClusters(articleIds: string[] | null) {
  const key = articleIds && articleIds.length >= 2 ? hashIdSet(articleIds) : null;
  const [tree, setTree] = useState<ClusterTree | null>(key ? (resolvedTrees.get(key) ?? null) : null);
  const [status, setStatus] = useState<Status>(key ? (resolvedTrees.has(key) ? "ready" : "loading") : "idle");
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    if (!key || !articleIds) {
      setTree(null);
      setStatus("idle");
      return;
    }
    const cached = resolvedTrees.get(key);
    if (cached) {
      setTree(cached);
      setStatus("ready");
      return;
    }
    setStatus("loading");
    let promise = treeCache.get(key);
    if (!promise) {
      promise = fetchTree(articleIds);
      treeCache.set(key, promise);
    }
    let cancelled = false;
    promise.then((result) => {
      if (result) resolvedTrees.set(key, result);
      else treeCache.delete(key);
      if (cancelled || keyRef.current !== key) return;
      setTree(result);
      setStatus(result ? "ready" : "unavailable");
    });
    return () => {
      cancelled = true;
    };
    // articleIds identity is unstable across renders; key hashes its content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /** Request labels for nodes that are now visible and still unnamed. */
  const labelNodes = useCallback(
    async (nodes: ClusterNode[]) => {
      const currentKey = keyRef.current;
      if (!currentKey) return;
      const wanted = nodes.filter(
        (n) => !n.generic && n.label === null && !requestedLabels.has(n.id),
      );
      if (wanted.length === 0) return;
      wanted.forEach((n) => requestedLabels.add(n.id));
      try {
        const res = await fetch("/api/radar/clusters/label", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodes: wanted.map((n) => ({ id: n.id, article_ids: n.articleIds })),
          }),
        });
        if (!res.ok) throw new Error(`label request failed: ${res.status}`);
        const json = (await res.json()) as { labels?: Record<string, string> };
        const labels = json.labels ?? {};
        if (Object.keys(labels).length === 0) return;
        const base = resolvedTrees.get(currentKey);
        if (base) {
          const next = applyLabels(base, labels);
          resolvedTrees.set(currentKey, next);
          if (keyRef.current === currentKey) setTree(next);
        }
      } catch {
        // Allow a retry on the next expansion.
        wanted.forEach((n) => requestedLabels.delete(n.id));
      }
    },
    [],
  );

  return { tree, status, labelNodes };
}

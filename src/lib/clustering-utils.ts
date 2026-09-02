export interface Article {
  id: string;
  title: string;
  published_at?: string;
  relevance_score?: number;
  source?: string;
  url?: string;
  industry_verticals?: string[];
  activity_types?: string[];
  summary?: string;
}

export interface ArticleCluster {
  id: string;
  leadArticle: Article;
  relatedArticles: Article[];
  isCluster: boolean;
}

function jaccardSimilarity(a: string, b: string): number {
  const tokenize = (s: string): Set<string> => {
    const words = s.toLowerCase().split(/\W+/).filter((w) => w.length >= 3);
    return new Set(words);
  };
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function extractCapitalizedEntities(title: string): Set<string> {
  const entities = new Set<string>();
  const tokens = title.split(/\W+/);
  for (const token of tokens) {
    if (token.length >= 3 && token[0] === token[0].toUpperCase() && token[0] !== token[0].toLowerCase()) {
      entities.add(token.toLowerCase());
    }
  }
  return entities;
}

function publishedWithin48h(a: Article, b: Article): boolean {
  if (!a.published_at || !b.published_at) return false;
  try {
    const tA = new Date(a.published_at).getTime();
    const tB = new Date(b.published_at).getTime();
    return Math.abs(tA - tB) <= 48 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

/**
 * Title-token Jaccard above which two articles published within 48h are treated
 * as the same story.
 *
 * SINGLE SOURCE OF TRUTH. `src/lib/top-stories.ts` imports this rather than
 * declaring its own number, so the company page and Top Stories cannot drift to
 * two different definitions of "same event". Measured basis for 0.35: over 16
 * replayed Top Stories candidate pools (7 days, both daily ingest batches) it
 * forms 12 groups and every one is a single real event; 0.30 adds two groups
 * that pair genuinely distinct stories, and 0.40 misses the GoPro/Starman,
 * Eli Lilly/Merida, Semtech Q2 and Aon/USI events. See
 * docs/recon/2026-09-02-clustered-top-stories-and-fact-layer-scope.md.
 */
export const SAME_STORY_TITLE_SIMILARITY = 0.35;

function isSameStory(a: Article, b: Article): boolean {
  if (!publishedWithin48h(a, b)) return false;
  if (jaccardSimilarity(a.title, b.title) <= SAME_STORY_TITLE_SIMILARITY) return false;
  const entitiesA = extractCapitalizedEntities(a.title);
  const entitiesB = extractCapitalizedEntities(b.title);
  for (const e of entitiesA) {
    if (entitiesB.has(e)) return true;
  }
  return false;
}

export function clusterArticles(articles: Article[]): ArticleCluster[] {
  if (articles.length === 0) return [];

  const sorted = [...articles].sort((a, b) => {
    const tA = a.published_at ? new Date(a.published_at).getTime() : 0;
    const tB = b.published_at ? new Date(b.published_at).getTime() : 0;
    return tB - tA;
  });

  const assigned = new Set<string>();
  const groups: Article[][] = [];

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    if (assigned.has(a.id)) continue;

    const group: Article[] = [a];
    assigned.add(a.id);

    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (assigned.has(b.id)) continue;
      if (isSameStory(a, b)) {
        group.push(b);
        assigned.add(b.id);
      }
    }
    groups.push(group);
  }

  return groups.map((group): ArticleCluster => {
    const lead = group.reduce((best, curr) =>
      (curr.relevance_score ?? 0) > (best.relevance_score ?? 0) ? curr : best
    );
    const related = group.filter((a) => a.id !== lead.id).sort((a, b) => {
      const tA = a.published_at ? new Date(a.published_at).getTime() : 0;
      const tB = b.published_at ? new Date(b.published_at).getTime() : 0;
      return tB - tA;
    });
    return {
      id: lead.id,
      leadArticle: lead,
      relatedArticles: related,
      isCluster: related.length > 0,
    };
  });
}

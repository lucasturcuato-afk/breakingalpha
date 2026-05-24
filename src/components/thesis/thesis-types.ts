export type ThesisConviction = "HIGH" | "MEDIUM" | "WATCH" | "BULLISH" | "BEARISH" | null;

export type ThesisStatus =
  | "new-signal"
  | "exploring"
  | "draft-thesis"
  | "needs-evidence"
  | "ready-for-memo"
  | "pending_review"
  | "active"
  | "watch"
  | "archived";

export interface EvidenceItem {
  article_index: number;
  label: string;
  type: "support" | "context" | "risk";
  bridge: string;
}

export interface ThesisArticle {
  id: string;
  title: string;
  source?: string;
  sector?: string;
  summary?: string;
  published_at?: string;
  ingested_at?: string;
  url?: string;
  sentiment?: string;
  companies?: string | string[];
}

export interface ThesisItem {
  id: string;
  title: string;
  conviction: ThesisConviction;
  sector: string;
  summary: string;
  rationale?: string;
  catalyst?: string;
  catalyst_note?: string;
  evidence_chain?: EvidenceItem[] | Record<string, unknown>[] | null;
  status: ThesisStatus | string;
  updatedAt: string;
  source?: string;
  articles?: ThesisArticle[];
  // Adversarial stress test
  bear_case?: string | null;
  adversarial_score?: number | null;
  passed_adversarial?: boolean | null;
  // Outcome grading
  outcome?: "confirmed" | "invalidated" | "inconclusive" | null;
  outcome_notes?: string | null;
  // Signal data
  signal_breakdown?: Record<string, unknown> | null;
  supporting_article_ids?: string[] | null;
  // Grading / timing
  ticker?: string | null;
  horizon?: string | null;
  check_after?: string | null;
  // Notes
  notes?: string | null;
  // Timestamp
  generated_at?: string | null;
  // Sparkline cache
  sparklineData?: { prices: number[]; direction: "up" | "down" } | null;
  // Output tracking
  output_id?: string | null;
}

export interface WeeklyDigest {
  id: string;
  generated_at?: string | null;
  thesis_prompt_addendum?: string | null;
}

export interface PatternRow {
  id: string;
  sector?: string | null;
  horizon?: string | null;
  dominant_signal?: string | null;
  win_rate?: number | null;
  n_observed?: number | null;
  n_confirmed?: number | null;
}

export interface SourceCredibilityRow {
  id?: string;
  source?: string | null;
  win_rate?: number | null;
  sample_size?: number | null;
}

export const statusLabels: Record<string, string> = {
  "new-signal": "New Signal",
  exploring: "Exploring",
  "draft-thesis": "Draft Thesis",
  "needs-evidence": "Needs Evidence",
  "ready-for-memo": "Ready for Memo",
  pending_review: "Pending Review",
  active: "Active",
  watch: "Watch",
  archived: "Archived",
};

export const statusOrder: ThesisStatus[] = [
  "pending_review",
  "active",
  "watch",
  "new-signal",
  "exploring",
  "draft-thesis",
  "needs-evidence",
  "ready-for-memo",
  "archived",
];

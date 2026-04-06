export type ThesisConviction = "BULLISH" | "BEARISH" | "WATCH";

export type ThesisStatus =
  | "new-signal"
  | "exploring"
  | "draft-thesis"
  | "needs-evidence"
  | "ready-for-memo"
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
  evidence_chain?: EvidenceItem[];
  status: ThesisStatus;
  updatedAt: string;
  source?: string;
  articles?: ThesisArticle[];
}

export const statusLabels: Record<ThesisStatus, string> = {
  "new-signal": "New Signal",
  exploring: "Exploring",
  "draft-thesis": "Draft Thesis",
  "needs-evidence": "Needs Evidence",
  "ready-for-memo": "Ready for Memo",
  archived: "Archived",
};

export const statusOrder: ThesisStatus[] = [
  "new-signal",
  "exploring",
  "draft-thesis",
  "needs-evidence",
  "ready-for-memo",
  "archived",
];

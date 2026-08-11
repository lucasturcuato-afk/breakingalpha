/**
 * Client-side trigger for the memo PDF download.
 *
 * Replaces the per-surface `new Blob([memo], { type: "text/markdown" })`
 * pattern. The memo text travels to /api/memo/export-pdf, which renders it
 * with @react-pdf/renderer and returns an attachment.
 */

export interface MemoPdfRequest {
  /** Exact memo text on screen, including any in-browser edits. */
  memo: string;
  /** Subject name shown in the surface header. */
  title: string;
  /** Type label, e.g. "Deal Memo". Optional. */
  kicker?: string;
  /** Base filename. The route sanitizes it and appends .pdf. */
  filename: string;
}

export async function downloadMemoPdf(req: MemoPdfRequest): Promise<void> {
  const res = await fetch("/api/memo/export-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${req.filename.replace(/\.(md|pdf)$/i, "")}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")        // strip HTML tags
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")  // markdown links [text](url) → text
    .replace(/https?:\/\/\S+/g, "")  // bare URLs
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

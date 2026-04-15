import { NextRequest, NextResponse } from "next/server";

interface GDELTArticle {
  url: string;
  title: string;
  seendate: string; // format: "20260414T120000Z"
  domain: string;
  language: string;
  sourcecountry: string;
}

interface GDELTResponse {
  articles?: GDELTArticle[];
}

function parseGDELTDate(seendate: string): string {
  // Format: "20260414T120000Z" → ISO string
  try {
    const year = seendate.slice(0, 4);
    const month = seendate.slice(4, 6);
    const day = seendate.slice(6, 8);
    const hour = seendate.slice(9, 11);
    const min = seendate.slice(11, 13);
    const sec = seendate.slice(13, 15);
    return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function makeId(url: string): string {
  // Create a stable short id from the url without using Buffer (edge-compatible)
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return "gdelt-" + Math.abs(hash).toString(36).padStart(8, "0");
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 2) {
    return NextResponse.json({ articles: [] });
  }

  try {
    const gdeltUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q.trim())}&mode=artlist&maxrecords=10&format=json&sort=DateDesc`;

    const res = await fetch(gdeltUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Signalera/1.0" },
    });

    if (!res.ok) {
      return NextResponse.json({ articles: [] });
    }

    const data: GDELTResponse = await res.json();
    const raw = data.articles;

    if (!Array.isArray(raw) || raw.length === 0) {
      return NextResponse.json({ articles: [] });
    }

    const now = new Date().toISOString();

    const articles = raw
      .filter((item) => item.language === "English")
      .map((item) => ({
        id: makeId(item.url),
        title: item.title,
        source: item.domain,
        url: item.url,
        summary: "",
        published_at: parseGDELTDate(item.seendate),
        ingested_at: now,
        sector: null,
        primary_company: null,
        industry_verticals: null,
        activity_types: null,
        relevance_score: null,
      }));

    return NextResponse.json({ articles });
  } catch {
    return NextResponse.json({ articles: [] });
  }
}

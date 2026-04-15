import { NextRequest, NextResponse } from "next/server";

interface ClearbitSuggestion {
  name: string;
  domain: string;
  logo: string;
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");
  if (!q || q.length < 2) return NextResponse.json({ results: [] });

  try {
    const url = `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(q)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return NextResponse.json({ results: [] });

    const data: ClearbitSuggestion[] = await res.json();
    if (!Array.isArray(data)) return NextResponse.json({ results: [] });

    const results = data.slice(0, 8).map((item) => ({
      name: item.name,
      domain: item.domain,
    }));

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}

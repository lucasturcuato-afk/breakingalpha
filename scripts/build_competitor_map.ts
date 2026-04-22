import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

async function main() {
  const { data: articles } = await supabase
    .from("articles")
    .select("id, companies")
    .not("companies", "is", "null")
    .order("ingested_at", { ascending: false })
    .limit(2000);

  if (!articles) { console.log("No articles"); return; }

  const coMentions = new Map<string, number>();

  for (const article of articles) {
    let companies = article.companies;
    if (typeof companies === "string") {
      try { companies = JSON.parse(companies); } catch { continue; }
    }
    if (!Array.isArray(companies) || companies.length < 2) continue;

    const names = companies
      .map((c: string) => c.trim().toLowerCase())
      .filter((c: string) => c.length > 1)
      .slice(0, 10);

    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const key = [names[i], names[j]].sort().join("|||");
        coMentions.set(key, (coMentions.get(key) ?? 0) + 1);
      }
    }
  }

  console.log(`Found ${coMentions.size} company pairs`);

  const significant = Array.from(coMentions.entries())
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);

  console.log(`${significant.length} significant pairs (3+ co-mentions)`);

  let inserted = 0;
  for (const [key, count] of significant) {
    const [a, b] = key.split("|||");
    for (const [ticker, competitor] of [[a, b], [b, a]]) {
      const { error } = await supabase
        .from("competitor_map")
        .upsert(
          { ticker, competitor_ticker: competitor, co_mention_count: count, last_seen: new Date().toISOString() },
          { onConflict: "ticker,competitor_ticker" },
        );
      if (!error) inserted++;
    }
  }

  console.log(`Upserted ${inserted} competitor relationships`);

  const { data: top } = await supabase
    .from("competitor_map")
    .select("ticker, competitor_ticker, co_mention_count")
    .order("co_mention_count", { ascending: false })
    .limit(10);
  console.log("\nTop competitor pairs:");
  top?.forEach(r => console.log(`  ${r.ticker} <-> ${r.competitor_ticker}: ${r.co_mention_count} co-mentions`));
}

main().catch(console.error);

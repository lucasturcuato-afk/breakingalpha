// Shared data for the 3 Company Intel directions.
// NVIDIA = canonical-with-aliases case. Pershing Square = typo-routing case.

const NVIDIA = {
  canonical: "NVIDIA Corp",
  display: "NVIDIA",
  ticker: "NVDA",
  exchange: "NASDAQ",
  sector: "Technology",
  industry: "Semiconductors",
  aliases: ["Nvidia", "NVIDIA", "Nvidia Corp", "NVIDIA Corporation"],
  // W2-A: alias-table backed
  aliasMentions: [{ name: "Nvidia", n: 47 }, { name: "NVIDIA", n: 26 }, { name: "Nvidia Corp", n: 8 }],
  mentions: 81,
  mentions7d: [4, 7, 6, 12, 9, 14, 11, 18],         // sparkline
  sentiment7d: [0.34, 0.41, 0.28, 0.55, 0.48, 0.62, 0.71, 0.66], // -1..1 normalized 0..1
  price: "918.42",
  change: 2.14,
  marketCap: "$2.26T",
  // Memo body — broken into structured paragraphs with inline [n] citations.
  memo: {
    tldr: "NVIDIA enters Q2 with the strongest demand signal of any large-cap tech name: data-center revenue is now running at a $115B annualized pace [1], the Blackwell cycle has crossed the 'production bottleneck' inflection [2], and hyperscaler capex guidance for FY26 implies further upside to the consensus model [3]. The bear case has narrowed to two questions: when does the export-control envelope tighten, and when does ASIC competition (TPU v6, MTIA, Trainium2) dent gross margin [4][5]. Neither is a near-term catalyst.",
    paragraphs: [
      {
        kind: "lead",
        text: "Q1 earnings reset the bar. Data-center revenue printed $39.1B against a $37.0B Street estimate, a 144% YoY increase [1]. Networking ($4.0B) and software/services ($1.9B) both grew above 100% [1]. CFO Colette Kress framed Blackwell as 'production-rate-limited not demand-limited' for the third consecutive quarter [2], and CEO Jensen Huang told analysts the company has visibility through 'late 2026' on the Blackwell-Ultra and Rubin platforms [2].",
      },
      {
        kind: "context",
        text: "Hyperscaler capex commentary supports the through-cycle view. Microsoft raised FY26 guidance to $96B [3], Meta to $72B with a $4B incremental skew toward AI infrastructure [3], and Alphabet maintained $85B with explicit language that 'Gemini-class training requires proportional acceleration spend' [6]. The aggregate FY26 hyperscaler capex envelope (MSFT, META, GOOGL, AMZN, ORCL) now stands at $410B versus $278B last year — a 47% YoY increase [3][6][7]. Even allocating only the AI-infra share, the implied compute purchase is large enough to absorb Blackwell, Rubin, and the early ramp of the next-gen networking stack.",
      },
      {
        kind: "watch",
        text: "Two risks remain non-trivial. First, the BIS rumored to be considering tighter performance thresholds on the H20-class export SKU [4]; consensus models do not haircut China revenue further. Second, custom-silicon: Google's TPU v6 and Meta's MTIA-2 enter volume in 2H26, and AWS Trainium2 is reportedly winning a portion of Anthropic's training cluster [5]. NVIDIA's response — selling networking and CUDA-platform value rather than just compute — is intact, but gross margin guidance has been revised down 80bps QoQ for the second time [1].",
      },
    ],
  },
  themes: [
    { label: "Blackwell ramp", weight: 0.94, tone: "BULLISH", count: 31 },
    { label: "Hyperscaler capex", weight: 0.81, tone: "BULLISH", count: 24 },
    { label: "Export controls", weight: 0.62, tone: "BEARISH", count: 18 },
    { label: "Custom silicon competition", weight: 0.54, tone: "WATCH", count: 14 },
    { label: "Sovereign AI", weight: 0.41, tone: "NEUTRAL", count: 9 },
    { label: "Networking attach", weight: 0.38, tone: "BULLISH", count: 7 },
  ],
  articles: [
    { id: 1, title: "NVIDIA Posts Q1 Beat as Data-Center Revenue Hits $39.1B; Blackwell 'Production-Rate Limited'", source: "Bloomberg", time: "4h", tone: "BULLISH", credit: 0.94, score: 96, dealType: "EARNINGS", isDevelopment: true, sector: "Technology", summary: "Total revenue $44.0B vs $42.5B est. Data-center +144% YoY. Networking $4.0B (+98%). Guides Q2 to $46B mid." },
    { id: 2, title: "Huang Says Blackwell-Ultra and Rubin Have 'Visibility Through Late 2026'", source: "Reuters", time: "4h", tone: "BULLISH", credit: 0.91, score: 92, dealType: "GUIDANCE", isDevelopment: true, sector: "Technology", summary: "On the post-earnings call, CEO Jensen Huang told analysts the company has clear demand signals on the next two architectures." },
    { id: 3, title: "Microsoft Lifts FY26 Capex to $96B; Cites 'Demand Above Available Compute'", source: "Wall Street Journal", time: "1d", tone: "BULLISH", credit: 0.93, score: 89, dealType: null, isDevelopment: false, sector: "Technology", summary: "Capex revision adds $7B to consensus; AI infrastructure cited as primary driver of the upward revision." },
    { id: 4, title: "BIS Considering Tighter H20 Performance Cap; Industry Pushback Centers on Recoupling Risk", source: "Financial Times", time: "2d", tone: "BEARISH", credit: 0.95, score: 88, dealType: "REGULATORY", isDevelopment: true, sector: "Technology", summary: "Bureau of Industry and Security weighing reduced FLOPS thresholds on China-bound SKUs ahead of October review." },
    { id: 5, title: "AWS Trainium2 Wins Anthropic Training-Cluster Allocation, Per Filings", source: "The Information", time: "3d", tone: "WATCH", credit: 0.88, score: 84, dealType: null, isDevelopment: false, sector: "Technology", summary: "Reported Anthropic-AWS expanded compute commitment leans toward custom silicon for next-gen Claude training runs." },
    { id: 6, title: "Alphabet Maintains $85B Capex; TPU v6 'Material Internal Allocation' for Gemini-Class Workloads", source: "Bloomberg", time: "3d", tone: "NEUTRAL", credit: 0.94, score: 81, dealType: null, isDevelopment: false, sector: "Technology", summary: "Sundar Pichai reframes capex as 'training-class compute,' implying continued external accelerator purchases alongside TPU." },
    { id: 7, title: "Meta Raises FY26 Capex to $72B; $4B Incremental Allocation to AI Infrastructure", source: "CNBC", time: "4d", tone: "BULLISH", credit: 0.86, score: 79, dealType: "GUIDANCE", isDevelopment: true, sector: "Technology", summary: "On Q1 call, CFO Susan Li flagged 'continued investment in our AI infrastructure stack' through 2027." },
    { id: 8, title: "Sovereign AI Pipeline: Saudi Arabia, UAE, France Each Sign Multi-Year Compute Commitments", source: "Reuters", time: "5d", tone: "BULLISH", credit: 0.90, score: 76, dealType: null, isDevelopment: false, sector: "Technology", summary: "Sovereign-AI bookings now estimated at $14B over the next two years; not yet in consensus model." },
    { id: 9, title: "Goldman Raises NVDA PT to $1,050; Cites 'Networking Attach Mispriced by Street'", source: "Goldman Sachs Research", time: "5d", tone: "BULLISH", credit: 0.87, score: 73, dealType: null, isDevelopment: false, sector: "Technology", summary: "Networking + CUDA-platform value framed as the structural moat versus emerging custom silicon." },
  ],
  sources: [
    { n: 1, name: "NVIDIA Q1 FY27 Earnings Release", url: "investor.nvidia.com", type: "primary" },
    { n: 2, name: "NVIDIA Q1 Conference Call (transcript)", url: "investor.nvidia.com", type: "primary" },
    { n: 3, name: "Microsoft Q3 FY26 Earnings", url: "microsoft.com/investor", type: "primary" },
    { n: 4, name: "FT — BIS H20 Review", url: "ft.com", type: "tier-1" },
    { n: 5, name: "The Information — Anthropic Training Allocation", url: "theinformation.com", type: "tier-1" },
    { n: 6, name: "Alphabet Q1 Capex Disclosure", url: "abc.xyz/investor", type: "primary" },
    { n: 7, name: "Bloomberg — Hyperscaler Capex Tracker", url: "bloomberg.com", type: "tier-1" },
  ],
};

const PERSHING = {
  canonical: "Pershing Square Capital Management",
  display: "Pershing Square",
  query: "Perishing Square", // user typo
  aliases: ["Pershing Square", "Pershing Square Capital", "Pershing Square USA", "PSCM"],
  sector: "Financial Services",
  industry: "Hedge Funds & Activist",
  mentions: 6,
};

// Directory data — 28 companies, alias-deduped mention counts.
// "x" suffix = canonical mention count after alias resolution.
const DIRECTORY = [
  { name: "OpenAI",         ticker: null,   mentions: 190, d7: [12,18,15,22,28,31,34], tone: "BULLISH", lastTime: "12m", sector: "AI",          aliases: 4, watch: true },
  { name: "Anthropic",      ticker: null,   mentions: 188, d7: [14,16,19,24,26,30,29], tone: "BULLISH", lastTime: "28m", sector: "AI",          aliases: 3, watch: true },
  { name: "Meta",           ticker: "META", mentions: 127, d7: [11,14,12,16,19,22,23], tone: "BULLISH", lastTime: "1h",  sector: "Technology",  aliases: 5, watch: false },
  { name: "Alphabet",       ticker: "GOOGL",mentions: 125, d7: [10,12,14,15,18,21,25], tone: "BULLISH", lastTime: "1h",  sector: "Technology",  aliases: 6, watch: true },
  { name: "Apple",          ticker: "AAPL", mentions: 99,  d7: [8,9,11,14,12,18,17],   tone: "MIXED",   lastTime: "2h",  sector: "Technology",  aliases: 3, watch: false },
  { name: "Amazon",         ticker: "AMZN", mentions: 93,  d7: [9,8,11,13,14,15,18],   tone: "BULLISH", lastTime: "2h",  sector: "Technology",  aliases: 4, watch: false },
  { name: "NVIDIA",         ticker: "NVDA", mentions: 90,  d7: [4,7,6,12,9,14,18],     tone: "BULLISH", lastTime: "4h",  sector: "Technology",  aliases: 3, watch: true },
  { name: "Microsoft",      ticker: "MSFT", mentions: 83,  d7: [7,9,10,11,13,14,16],   tone: "BULLISH", lastTime: "5h",  sector: "Technology",  aliases: 2, watch: true },
  { name: "SpaceX",         ticker: null,   mentions: 72,  d7: [6,8,9,10,12,13,14],    tone: "NEUTRAL", lastTime: "6h",  sector: "Aerospace",   aliases: 2, watch: false },
  { name: "Tesla",          ticker: "TSLA", mentions: 63,  d7: [12,9,10,8,7,6,7],      tone: "BEARISH", lastTime: "6h",  sector: "Automotive",  aliases: 3, watch: false },
  { name: "Goldman Sachs",  ticker: "GS",   mentions: 43,  d7: [4,5,5,6,7,8,9],        tone: "NEUTRAL", lastTime: "8h",  sector: "Financials",  aliases: 4, watch: false },
  { name: "Blackstone",     ticker: "BX",   mentions: 36,  d7: [3,4,5,5,6,6,7],        tone: "BULLISH", lastTime: "9h",  sector: "Financials",  aliases: 2, watch: false },
  { name: "Lockheed Martin",ticker: "LMT",  mentions: 30,  d7: [3,3,4,4,5,5,6],        tone: "BULLISH", lastTime: "10h", sector: "Aerospace",   aliases: 2, watch: false },
  { name: "Intel",          ticker: "INTC", mentions: 30,  d7: [6,5,4,4,4,4,3],        tone: "BEARISH", lastTime: "12h", sector: "Technology",  aliases: 2, watch: true },
  { name: "Robinhood",      ticker: "HOOD", mentions: 28,  d7: [2,3,4,4,4,5,6],        tone: "BULLISH", lastTime: "12h", sector: "Financials",  aliases: 2, watch: false },
  { name: "Oracle",         ticker: "ORCL", mentions: 26,  d7: [2,3,3,4,4,5,5],        tone: "BULLISH", lastTime: "14h", sector: "Technology",  aliases: 2, watch: false },
  { name: "Samsung",        ticker: null,   mentions: 25,  d7: [3,3,4,3,4,4,4],        tone: "NEUTRAL", lastTime: "16h", sector: "Technology",  aliases: 4, watch: false },
  { name: "Boeing",         ticker: "BA",   mentions: 24,  d7: [4,4,3,4,3,3,3],        tone: "BEARISH", lastTime: "16h", sector: "Aerospace",   aliases: 2, watch: false },
  { name: "Stripe",         ticker: null,   mentions: 22,  d7: [2,3,3,3,3,4,4],        tone: "BULLISH", lastTime: "18h", sector: "Financials",  aliases: 1, watch: false },
  { name: "Pershing Square",ticker: null,   mentions: 19,  d7: [2,2,3,3,3,3,3],        tone: "NEUTRAL", lastTime: "1d",  sector: "Financials",  aliases: 4, watch: false },
  { name: "JPMorgan",       ticker: "JPM",  mentions: 18,  d7: [2,2,3,3,2,3,3],        tone: "NEUTRAL", lastTime: "1d",  sector: "Financials",  aliases: 3, watch: false },
  { name: "Coinbase",       ticker: "COIN", mentions: 17,  d7: [2,2,3,2,3,2,3],        tone: "MIXED",   lastTime: "1d",  sector: "Financials",  aliases: 1, watch: false },
  { name: "Palantir",       ticker: "PLTR", mentions: 16,  d7: [2,2,2,2,3,2,3],        tone: "BULLISH", lastTime: "1d",  sector: "Technology",  aliases: 1, watch: false },
  { name: "Berkshire",      ticker: "BRK.B",mentions: 14,  d7: [2,2,2,1,2,2,3],        tone: "NEUTRAL", lastTime: "1d",  sector: "Financials",  aliases: 3, watch: false },
  { name: "Citadel",        ticker: null,   mentions: 13,  d7: [1,2,2,2,2,2,2],        tone: "NEUTRAL", lastTime: "2d",  sector: "Financials",  aliases: 2, watch: false },
  { name: "AMD",            ticker: "AMD",  mentions: 12,  d7: [1,2,2,1,2,2,2],        tone: "WATCH",   lastTime: "2d",  sector: "Technology",  aliases: 1, watch: false },
  { name: "Disney",         ticker: "DIS",  mentions: 11,  d7: [2,1,2,2,1,2,1],        tone: "BEARISH", lastTime: "2d",  sector: "Media",       aliases: 1, watch: false },
  { name: "Northrop Grumman",ticker:"NOC",  mentions: 10,  d7: [1,1,1,2,1,2,2],        tone: "BULLISH", lastTime: "2d",  sector: "Aerospace",   aliases: 2, watch: false },
];
const SECTORS = ["All", "AI", "Technology", "Financials", "Aerospace", "Automotive", "Media"];
const MARKETS = [
  { label: "S&P 500", value: "5,827.04", change: 0.42 },
  { label: "VIX",     value: "17.6",     change: 3.8 },
  { label: "10Y",     value: "4.31%",    change: -0.6 },
  { label: "DXY",     value: "104.2",    change: 0.18 },
];

window.NVIDIA = NVIDIA;
window.PERSHING = PERSHING;
window.DIRECTORY = DIRECTORY;
window.SECTORS = SECTORS;
window.MARKETS = MARKETS;

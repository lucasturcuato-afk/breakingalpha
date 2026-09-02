// Unit tests for the watchlist title-arm precision filter
// (src/lib/watchlist-title-precision.ts).
//
// The defect: buildArticleOrFilter emits an unanchored
//   title.ilike.%<term>%
// for every search term of 6 characters or more. Financial headlines carry an
// exchange qualifier by house style, so a NDAQ entry matches every
// "(NASDAQ:XXXX)" headline in the corpus.
//
// The fixtures below are VERBATIM prod rows. They are the first 30 rows of the
// exact query src/app/radar/watchlist/page.tsx issues for a NDAQ ticker entry
//   or=(primary_company.ilike.%Nasdaq Inc%,title.ilike.%Nasdaq Inc%,
//       primary_company.ilike.%Nasdaq%,title.ilike.%Nasdaq%,
//       primary_company.ilike.%NDAQ%)
//   order=ingested_at.desc limit=30
// read from prod on 2026-08-31. 18 of the 30 arrived only through the title
// arm and none of the 18 were about Nasdaq, Inc.
//
// The contract locked here:
//   exchange qualifier tags     -> dropped, either orientation
//   venue / index constructions -> dropped
//   primary_company corroborates-> kept, unconditionally
//   genuine title mention       -> kept, even when primary_company differs
//   sector entries              -> untouched
//
// Run: npx tsx --test tests/unit/watchlist-title-precision.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterImpreciseTitleMatches,
  titleMentionIsGenuine,
  companyCorroborates,
} from "../../src/lib/watchlist-title-precision.ts";

type Row = { title: string; primary_company: string | null };

/** Verbatim prod rows, NDAQ entry, ingested_at desc, 2026-08-31. */
const NDAQ_ROWS: Row[] = [
  { primary_company: "Victory Capital", title: "Victory Capital to acquire First Eagle Investments in $7B deal (VCTR:NASDAQ)" },
  { primary_company: "Urban Outfitters", title: "Urban Outfitters (NASDAQ:URBN) Downgraded by Wall Street Zen to Hold" },
  { primary_company: "StubHub", title: "StubHub (NASDAQ: STUB) product chief sells 305K shares over two days" },
  { primary_company: "Summit", title: "Summit rises as lead drug bests Astra's Imfinzi (SMMT:NASDAQ)" },
  { primary_company: "SEI Investments", title: "SEI Investments (NASDAQ: SEIC) exec plans new stock sale after July cash-out" },
  { primary_company: "Revolution Medicines", title: "Revolution Medicines: RASONQUE's FDA Approval Portends A New Oncology Titan (NASDAQ:RVMD)" },
  { primary_company: "Richtech Robotics", title: "Richtech Robotics: An Easy Pass Based On Lackluster RaaS Growth Quality (NASDAQ:RR)" },
  { primary_company: "Eightco Holdings", title: "Eightco Holdings (NASDAQ: ORBS) Reports $336M Treasury: OpenAI, WLD, ETH and Cash Holdings" },
  { primary_company: "Nasdaq, Inc.", title: "161,001 Shares in Nasdaq, Inc. $NDAQ Purchased by Corient Private Wealth LP" },
  { primary_company: "Nasdaq, Inc.", title: "Rakuten Investment Management Inc. Purchases New Shares in Nasdaq, Inc. $NDAQ" },
  { primary_company: "Nasdaq, Inc.", title: "Lombard Odier Asset Management Europe Ltd Takes $2.79 Million Position in Nasdaq, Inc." },
  { primary_company: "Nasdaq, Inc.", title: "208,742 Shares in Nasdaq, Inc. $NDAQ Acquired by Public Employees Retirement System of Ohio" },
  { primary_company: "Nasdaq, Inc.", title: "Northstar Asset Management Inc. Sells 14,422 Shares of Nasdaq, Inc. $NDAQ" },
  { primary_company: "Nasdaq, Inc.", title: "17,911 Shares in Nasdaq, Inc. $NDAQ Bought by Jefferies Financial Group Inc." },
  { primary_company: "Nasdaq, Inc.", title: "Nasdaq, Inc. $NDAQ Shares Sold by Benjamin Edwards Inc." },
  { primary_company: "Nasdaq, Inc.", title: "11,480 Shares in Nasdaq, Inc. $NDAQ Bought by Centaurus Financial Inc." },
  { primary_company: "Nasdaq, Inc.", title: "Susquehanna Fundamental Investments LLC Takes $17.71 Million Position in Nasdaq, Inc." },
  { primary_company: "Nasdaq, Inc.", title: "Two Sigma Securities LLC Invests $1.61 Million in Nasdaq, Inc. $NDAQ" },
  { primary_company: "Nasdaq", title: "Nasdaq (NDAQ) Stock Could Be 13% Rich As Extended Trading Nears" },
  { primary_company: "Nasdaq, Inc.", title: "Headlands Technologies LLC Sells 25,180 Shares of Nasdaq, Inc. $NDAQ" },
  { primary_company: "Hemnet", title: "Hemnet Steps Up Share Buybacks on Nasdaq Stockholm" },
  { primary_company: null, title: "Stock market today: Dow, S&P 500, Nasdaq futures fall as US strikes Iran, rate-hike bets" },
  { primary_company: "MicroStrategy", title: "Strategy makes first bitcoin purchases in about two months (MSTR:NASDAQ)" },
  { primary_company: "Microsoft", title: "Microsoft: The Rerating Is Probably Over For Now (Rating Downgrade) (NASDAQ:MSFT)" },
  { primary_company: "Meta", title: "Meta: When An $18 Billion Settlement Is Bullish (NASDAQ:META)" },
  { primary_company: "Meta Platforms", title: "Meta Platforms Beats The Man, Again - We Move To Accumulate Rating (NASDAQ:META)" },
  { primary_company: "MARA Holdings", title: "MARA Holdings: One Foot In Bitcoin, One Foot In AI (NASDAQ:MARA)" },
  { primary_company: "LexinFintech", title: "LexinFintech (NASDAQ: LX) flags Q3 loss risk after 80% profit drop" },
  { primary_company: "LexinFintech", title: "LexinFintech stock tumbles after warning of Q3 loss, changing dividend to annual" },
  { primary_company: "Lotus Technology Inc.", title: "Lotus Technology Inc. 2026 Q2 - Results - Earnings Call Presentation (NASDAQ:LOT)" },
];

/** Verbatim prod rows: title matches "Anthropic", primary_company does not. */
const ANTHROPIC_ROWS: Row[] = [
  { primary_company: "CrowdStrike", title: "OpenAI and Anthropic models power CrowdStrike's expanded AI security project" },
  { primary_company: "Salesforce", title: "Salesforce Stock Just Soared. Thank Anthropic." },
  { primary_company: "Amazon", title: "Amazon Stock Gets a Boost. AWS Adds Anthropic, Meta and OpenAI Models" },
  { primary_company: "Salesforce", title: "CRM Stock's Best Week In 5 Years On Anthropic AI Deal - Salesforce (NYSE:CRM)" },
  { primary_company: "Salesforce", title: "Why Salesforce's Alliance With Anthropic Changes Everything (NYSE:CRM)" },
  { primary_company: "TeraWulf", title: "TeraWulf Stock Powers Higher On Anthropic AI Megadeal And Kentucky Win" },
  { primary_company: "WULF", title: "WULF Stock Climbs As Massive Anthropic AI Deal Locks In Revenue" },
  { primary_company: "Google", title: "Google takes aim at Anthropic, Microsoft with budget-friendly AI pricing" },
  { primary_company: "Meta", title: "Meta Projected It Could Spend $10 Billion on Anthropic's A.I." },
];

test("prod replay: NDAQ entry keeps only the 12 rows about the company", () => {
  const kept = filterImpreciseTitleMatches(NDAQ_ROWS, "NDAQ", "Nasdaq Inc", "ticker");
  assert.equal(NDAQ_ROWS.length, 30, "fixture is the full measured page");
  assert.equal(kept.length, 12, "18 title-arm-only rows are dropped");
  for (const row of kept) {
    assert.match(
      (row.primary_company || "").toLowerCase(),
      /nasdaq/,
      `kept row is not about Nasdaq, Inc.: ${row.title}`,
    );
  }
});

test("exchange qualifier tags lose in both orientations", () => {
  // NASDAQ:TICKER
  assert.equal(titleMentionIsGenuine("Urban Outfitters (NASDAQ:URBN) Downgraded", "Nasdaq"), false);
  // NASDAQ: TICKER, with a space
  assert.equal(titleMentionIsGenuine("StubHub (NASDAQ: STUB) product chief sells", "Nasdaq"), false);
  // TICKER:NASDAQ
  assert.equal(titleMentionIsGenuine("Victory Capital to acquire First Eagle (VCTR:NASDAQ)", "Nasdaq"), false);
});

test("venue and index constructions lose", () => {
  assert.equal(titleMentionIsGenuine("Hemnet Steps Up Share Buybacks on Nasdaq Stockholm", "Nasdaq"), false);
  assert.equal(titleMentionIsGenuine("Dow, S&P 500, Nasdaq futures fall as US strikes Iran", "Nasdaq"), false);
  assert.equal(titleMentionIsGenuine("Nasdaq Composite closes higher", "Nasdaq"), false);
});

test("a genuine mention survives even next to an unrelated exchange tag", () => {
  // The tag is (NYSE:CRM); the term "Anthropic" is not inside it, so the
  // check must stay scoped to the term and not reject the whole title.
  assert.equal(
    titleMentionIsGenuine("CRM Stock's Best Week In 5 Years On Anthropic AI Deal - Salesforce (NYSE:CRM)", "Anthropic"),
    true,
  );
  // "Nasdaq (NDAQ)" is the company plus its symbol, not a venue tag: no colon.
  assert.equal(titleMentionIsGenuine("Nasdaq (NDAQ) Stock Could Be 13% Rich", "Nasdaq"), true);
});

test("prod replay: the title arm's real recall is preserved in full", () => {
  // Every one of these is genuine Anthropic news filed under a different
  // primary_company. Requiring corroboration would delete all nine.
  const kept = filterImpreciseTitleMatches(ANTHROPIC_ROWS, "Anthropic", null, "company");
  assert.equal(kept.length, ANTHROPIC_ROWS.length);
});

test("primary_company corroboration keeps a row regardless of headline shape", () => {
  const rows: Row[] = [
    { primary_company: "Nasdaq, Inc.", title: "Nasdaq futures slip ahead of the open" },
  ];
  // Reads as venue usage, but the row genuinely belongs to the company.
  assert.equal(titleMentionIsGenuine(rows[0].title, "Nasdaq"), false);
  assert.equal(filterImpreciseTitleMatches(rows, "NDAQ", "Nasdaq Inc", "ticker").length, 1);
});

test("token boundaries: a substring inside a larger word does not count", () => {
  assert.equal(titleMentionIsGenuine("Nasdaqish startup raises a round", "Nasdaq"), false);
  assert.equal(titleMentionIsGenuine("Visanet expands in Brazil", "Visa"), false);
  assert.equal(titleMentionIsGenuine("Visa raises guidance", "Visa"), true);
});

test("terms ending in punctuation still anchor", () => {
  assert.equal(titleMentionIsGenuine("Lotus Technology Inc. posts Q2 results", "Lotus Technology Inc."), true);
});

test("sector entries are returned untouched", () => {
  const rows: Row[] = [{ primary_company: "Anything", title: "Anything at all" }];
  assert.equal(filterImpreciseTitleMatches(rows, "Technology", null, "sector").length, 1);
});

test("short company entries are unaffected: the filter is a no-op there", () => {
  // type=company sends displayName null, so the only term is the identifier,
  // and below 6 characters the title arm never fired. Every row the query
  // returned already satisfied primary_company ILIKE, so none may be dropped.
  const rows: Row[] = [
    { primary_company: "Visa Inc", title: "Payments volume climbs in Q3" },
    { primary_company: "Visa", title: "Card network expands tokenization" },
  ];
  assert.equal(filterImpreciseTitleMatches(rows, "Visa", null, "company").length, 2);
});

test("companyCorroborates is case-insensitive and null-safe", () => {
  assert.equal(companyCorroborates("Nasdaq, Inc.", ["nasdaq"]), true);
  assert.equal(companyCorroborates(null, ["nasdaq"]), false);
  assert.equal(companyCorroborates("", ["nasdaq"]), false);
  assert.equal(companyCorroborates("Meta", ["nasdaq"]), false);
});

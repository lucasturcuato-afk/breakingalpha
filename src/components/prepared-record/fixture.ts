import type { RecordData, RecordEntry } from "./record-data";

/**
 * Sample content for the Prepared record. SERVER ONLY.
 *
 * NOTHING IN THIS FILE MAY BE IMPORTED BY A CLIENT COMPONENT. The gate is a
 * runtime constant, so it stops the render and not the download: every string
 * below reaches `.next/static` the moment a `"use client"` module imports this
 * path, whether or not it can ever paint. `RecordScreen` used to import
 * `countsByState` from here and that alone put all forty-one invented claims,
 * signed with an invented name, into the production browser bundle.
 *
 * `src/app/record/page.tsx` is a server component and imports this module by
 * path. The barrel does not re-export it, because the barrel is reachable from
 * the client graph through `record-screen`. The shape, the pure helpers and
 * the no-record constant live in `./record-data`; the gate lives on its own in
 * `./fixture-gate`. Both of those are content-free and safe to cross the
 * boundary. This file is not.
 *
 * The screen has no data source in this unit. `src/lib/your-record.ts` is the
 * correct model for it (see the provenance note in the PR body) but it yields
 * counts only: no entries list, no date range, no month grouping. So the screen
 * is built against a typed fixture, and the shape in `./record-data` IS the
 * contract a real loader has to satisfy. Swapping the fixture for a query
 * should not touch a single component.
 *
 * COMPLIANCE: no aggregate figure anywhere, including here. Nothing in this
 * file is a rate, a ratio or a percentage of the record. The per-entry figures
 * are one instrument's move against one benchmark over one window, which is
 * the evidence for a single claim rather than a summary of the record.
 * `ENTRIES` is authored as one strict reverse-chronological sequence and
 * nothing sorts, filters or ranks by state.
 */

/**
 * The entries, newest first. Thirteen are the design's own, verbatim. The rest
 * are authored to the same anatomy so the screen carries the density the design
 * specifies: the design draws five month rules, and its own range line ("June
 * 2, 2026 and February 20, 2027") asks for nine months of them.
 */
const ENTRIES: RecordEntry[] = [
  {
    id: "r-2027-02-20",
    date: "2027-02-20",
    state: "awaiting",
    claim: "Ethane cracker utilisation on the US Gulf coast stays above 95% through the March quarter.",
    note: "Feedstock economics are the widest they have been since 2023 and two turnarounds finished early.",
    window: "Inside its window until May 21, 2027.",
  },
  {
    id: "r-2027-02-19",
    date: "2027-02-19",
    state: "challenged",
    claim: "Grid equipment backlogs extend past 2027 as transformer lead times stay above 30 months.",
    note: "Utilities capex is committed and the queue is physical, not financial.",
    result: "ETN −3.90% against XLI +4.11%. Clean read.",
  },
  {
    id: "r-2027-02-18",
    date: "2027-02-18",
    state: "awaiting",
    claim: "Danish wind developers take a second round of impairments on US offshore projects.",
    note: "The tax credit transfer market repriced in January and the sanctioned pipeline has not moved.",
    window: "Inside its window until May 19, 2027.",
  },
  {
    id: "r-2027-02-17",
    date: "2027-02-17",
    state: "supported",
    claim: "Semicap orders reaccelerate on HBM capacity adds into the March quarter.",
    note: "Memory is the constraint and tool orders lead capacity by two quarters.",
    result: "AMAT +14.02% against SOXX +5.31%. Clean read.",
  },
  {
    id: "r-2027-02-14",
    date: "2027-02-14",
    state: "awaiting",
    claim: "Copper treatment charges stay negative through the annual benchmark settlement.",
    note: "Smelter capacity ran ahead of concentrate supply for three years and nothing new arrives before 2028.",
    window: "Inside its window until May 15, 2027.",
  },
  {
    id: "r-2027-02-12",
    date: "2027-02-12",
    state: "challenged",
    claim: "Transpacific spot freight rates stay soft through the Lunar New Year restock.",
    note: "Capacity additions outrun the restock every year and this year has more of them.",
    result: "ZIM +22.60% against the sector +6.02%. Clean read.",
  },
  {
    id: "r-2027-02-10",
    date: "2027-02-10",
    state: "awaiting",
    claim: "European gas storage exits winter above 45% full.",
    note: "A mild January and steady Norwegian flows leave the withdrawal curve well under the five-year path.",
    window: "Inside its window until April 15, 2027.",
  },
  {
    id: "r-2027-02-09",
    date: "2027-02-09",
    state: "developing",
    claim: "Regional bank net interest margin compression bottoms by the March quarter.",
    note: "Deposit betas lag the cut cycle and their books reprice faster than the funding.",
    result: "ZION +3.71% against XLF +3.44%. The move could not be separated from the sector.",
  },
  {
    id: "r-2027-01-30",
    date: "2027-01-30",
    state: "awaiting",
    claim: "Pharmacy benefit reform lands without a change to the rebate pass-through rule.",
    note: "The January draft dropped the pass-through language and the comment window closes in March.",
    window: "Inside its window until April 30, 2027.",
  },
  {
    id: "r-2027-01-28",
    date: "2027-01-28",
    state: "challenged",
    claim: "Luxury demand in China stabilises by the holiday quarter.",
    note: "Two quarters of easing and the comps get very soft in December.",
    result: "RMS.PA −6.10% against the sector −0.44%. Clean read.",
  },
  {
    id: "r-2027-01-26",
    date: "2027-01-26",
    state: "awaiting",
    claim: "Airlines guide the March quarter above consensus on premium cabin demand.",
    note: "Corporate contracted volume recovered through the autumn and the premium mix has not given back a point.",
    window: "Inside its window until April 26, 2027.",
  },
  {
    id: "r-2027-01-21",
    date: "2027-01-21",
    state: "supported",
    claim: "Refinery crack spreads widen into the winter maintenance window.",
    note: "Turnaround schedules are heavier than last year and inventories start lower.",
    result: "VLO +9.80% against XLE +2.11%. Clean read.",
  },
  {
    id: "r-2027-01-14",
    date: "2027-01-14",
    state: "supported",
    claim: "Datacentre capex guides move higher across the four largest hyperscalers.",
    note: "Every one of them is supply constrained and none has guided to the constraint yet.",
    result: "Macro basket +7.40% against SPY +1.90%. Clean read.",
  },
  {
    id: "r-2027-01-08",
    date: "2027-01-08",
    state: "awaiting",
    claim: "Titanium sponge pricing stays above 2026 contract levels through the first half.",
    note: "Aerospace build rates finally moved and the qualified supplier list is three names long.",
    window: "Inside its window until April 8, 2027.",
  },
  {
    id: "r-2026-12-18",
    date: "2026-12-18",
    state: "challenged",
    claim: "Freight brokerage margins recover as spot and contract converge.",
    note: "The spread has been negative for six quarters and mean reversion is overdue.",
    result: "CHRW −4.20% against XTN +1.80%. Clean read.",
  },
  {
    id: "r-2026-12-16",
    date: "2026-12-16",
    state: "supported",
    claim: "Uranium term contracting volume finishes the year above 160 million pounds.",
    note: "Utilities left it late two years running and the enrichment bottleneck forces earlier commitments.",
    result: "CCJ +11.30% against XLE +2.40%. Clean read.",
  },
  {
    id: "r-2026-12-11",
    date: "2026-12-11",
    state: "supported",
    claim: "Ad-supported tiers pass half of gross new sign-ups at the two largest streaming services.",
    note: "The October price rise pushed the mix, and the tier is where the inventory is being built.",
    result: "NFLX +8.10% against XLC +1.60%. Clean read.",
  },
  {
    id: "r-2026-12-04",
    date: "2026-12-04",
    state: "supported",
    claim: "Ozempic supply constraints ease enough to lift script growth above trend.",
    note: "The second fill line came online in November and the backlog is known.",
    result: "NVO +8.90% against XLV +1.20%. Clean read.",
  },
  {
    id: "r-2026-12-02",
    date: "2026-12-02",
    state: "developing",
    claim: "Insurance brokers keep organic growth above 7% as property rates soften.",
    note: "The mix shift into employee benefits carries the number even when property gives back.",
    result: "AJG +2.10% against XLF +1.90%. The move could not be separated from the sector.",
  },
  {
    id: "r-2026-11-24",
    date: "2026-11-24",
    state: "supported",
    claim: "Rare earth separation capacity outside China doubles announced tonnage by year end.",
    note: "Two offtake agreements signed in October carry price floors, which is what was missing before.",
    result: "MP +18.40% against XME +3.20%. Clean read.",
  },
  {
    id: "r-2026-11-20",
    date: "2026-11-20",
    state: "developing",
    claim: "Private credit spreads compress as bank retrenchment slows.",
    note: "Three of the largest direct lenders repriced unitranche paper inside 500 over base.",
    result: "No clean read. The move could not be separated from the credit complex.",
  },
  {
    id: "r-2026-11-13",
    date: "2026-11-13",
    state: "challenged",
    claim: "US natural gas storage ends the injection season under 3,900 Bcf.",
    note: "LNG feedgas demand steps up in November and production has been flat since August.",
    result: "UNG −7.60% against XLE +0.90%. Clean read.",
  },
  {
    id: "r-2026-11-06",
    date: "2026-11-06",
    state: "supported",
    claim: "Card networks report cross-border volume growth above 12% for the September quarter.",
    note: "Travel corridors into Asia reopened fully and the comparison base is soft.",
    result: "V +6.70% against XLF +1.10%. Clean read.",
  },
  {
    id: "r-2026-11-03",
    date: "2026-11-03",
    state: "challenged",
    claim: "Enterprise software seat expansion turns positive again in the October quarter.",
    note: "Headcount stabilised across the customer base two quarters ago and seats follow with a lag.",
    result: "CRM −5.40% against IGV +2.30%. Clean read.",
  },
  {
    id: "r-2026-10-27",
    date: "2026-10-27",
    state: "supported",
    claim: "Container liners announce a second blank sailing programme before the December contracting round.",
    note: "Rates fell under operating cost on the Asia to Europe leg and the alliances have done this every cycle.",
    result: "MAERSK-B.CO +9.20% against the sector +1.70%. Clean read.",
  },
  {
    id: "r-2026-10-21",
    date: "2026-10-21",
    state: "challenged",
    claim: "Lithium carbonate spot pricing bottoms before the December quarter.",
    note: "Two Australian mines went to care and maintenance in September and the cost curve says that is the floor.",
    result: "ALB −12.80% against XME −1.20%. Clean read.",
  },
  {
    id: "r-2026-10-15",
    date: "2026-10-15",
    state: "supported",
    claim: "Medicare Advantage medical cost ratios stay above 88% for the September quarter.",
    note: "Utilisation never normalised after the deferred procedure backlog cleared.",
    result: "UNH −9.10% against XLV −0.80%. Clean read.",
  },
  {
    id: "r-2026-10-08",
    date: "2026-10-08",
    state: "developing",
    claim: "Data-centre power agreements clear above $80 per megawatt hour in PJM.",
    note: "The capacity auction cleared at the cap and behind-the-meter deals are following it.",
    result: "CEG +3.30% against XLU +3.10%. The move could not be separated from the sector.",
  },
  {
    id: "r-2026-10-01",
    date: "2026-10-01",
    state: "supported",
    claim: "Auto insurers keep rate increases under 5% in the fourth quarter filings.",
    note: "Loss cost inflation broke lower in the summer data and the filings lag it by a quarter.",
    result: "PGR +7.20% against XLF +1.40%. Clean read.",
  },
  {
    id: "r-2026-09-24",
    date: "2026-09-24",
    state: "supported",
    claim: "Memory contract pricing rises for a third consecutive quarter into December.",
    note: "Every supplier has committed its 2027 wafer starts to HBM, which starves the commodity node.",
    result: "MU +15.60% against SOXX +4.10%. Clean read.",
  },
  {
    id: "r-2026-09-17",
    date: "2026-09-17",
    state: "challenged",
    claim: "European auto registrations turn positive year on year in the fourth quarter.",
    note: "The base is very soft and the fleet renewal incentives land in October.",
    result: "VOW3.DE −6.90% against the sector −0.70%. Clean read.",
  },
  {
    id: "r-2026-09-10",
    date: "2026-09-10",
    state: "supported",
    claim: "Gold miners expand all-in sustaining margins for a fourth straight quarter.",
    note: "Diesel and labour have flattened while the metal has not, and that gap is the whole quarter.",
    result: "GDX +13.40% against SPY +1.20%. Clean read.",
  },
  {
    id: "r-2026-09-03",
    date: "2026-09-03",
    state: "challenged",
    claim: "Homebuilder gross margins stabilise as incentive spending peaks.",
    note: "Lumber is off its highs and the incentive line has been flat for two quarters.",
    result: "DHI −8.30% against XHB −1.10%. Clean read.",
  },
  {
    id: "r-2026-08-26",
    date: "2026-08-26",
    state: "supported",
    claim: "Aircraft engine aftermarket revenue grows above 20% for the September quarter.",
    note: "Shop visit volume is set by the 2019 delivery cohort and that cohort is arriving now.",
    result: "RTX +8.60% against XLI +1.30%. Clean read.",
  },
  {
    id: "r-2026-08-19",
    date: "2026-08-19",
    state: "challenged",
    claim: "Agricultural equipment order books stabilise before the autumn order season.",
    note: "Used inventory finally cleared and the replacement cycle is eight years old.",
    result: "DE −7.10% against XLI +1.90%. Clean read.",
  },
  {
    id: "r-2026-08-12",
    date: "2026-08-12",
    state: "supported",
    claim: "Municipal water rate cases clear above 6% in three of four state filings.",
    note: "Lead line replacement mandates are funded through the rate base and the commissions have said so.",
    result: "AWK +5.90% against XLU +1.00%. Clean read.",
  },
  {
    id: "r-2026-07-15",
    date: "2026-07-15",
    state: "developing",
    claim: "SoFi's deposit costs peak in the June quarter.",
    note: "Deposit betas lag the cut cycle by a quarter and their book reprices faster than the funding does.",
    result: "SOFI +4.02% against XLF +3.71%. The move could not be separated from the sector.",
  },
  {
    id: "r-2026-07-08",
    date: "2026-07-08",
    state: "supported",
    claim: "Azure growth reaccelerates above 30% when the June quarter prints.",
    note: "Capacity was the constraint, not demand. June is when the second-half racks land.",
    result: "MSFT +6.41% against XLK +1.02%. Clean read.",
  },
  {
    id: "r-2026-07-01",
    date: "2026-07-01",
    state: "challenged",
    claim: "Nordic salmon spot pricing recovers above 80 NOK before the autumn harvest.",
    note: "Biomass in the water is down year on year and the biological issues have not cleared.",
    result: "MOWI.OL −9.40% against the sector −1.60%. Clean read.",
  },
  {
    id: "r-2026-06-24",
    date: "2026-06-24",
    state: "challenged",
    claim: "Novo Nordisk narrows the US script gap against Lilly by the July IQVIA prints.",
    note: "CagriSema's label read better than the print suggested. I read the June slowdown as inventory, not demand.",
    result: "NVO −8.13% against XLV −0.44%. Clean read.",
  },
  {
    id: "r-2026-06-02",
    date: "2026-06-02",
    state: "supported",
    claim: "Industrial property net effective rents stop falling in the second quarter.",
    note: "New completions dropped by half and the absorption number turned in April.",
    result: "PLD +7.80% against XLRE +1.50%. Clean read.",
  },
];

export const RECORD_FIXTURE: RecordData = {
  name: "Maya Reyes",
  entries: ENTRIES,
  settledSincePrepared: 3,
  /* After the newest entry, not before it. A record cannot have been prepared
     on February 18 and contain calls entered on the 19th and the 20th, and the
     stale notice prints this date directly above a range line ending on the
     20th. */
  preparedAt: "February 21, 2027",
};

/** The record when the user has calls but nothing of theirs has resolved. */
export const RECORD_UNRESOLVED_FIXTURE: RecordData = {
  ...RECORD_FIXTURE,
  entries: ENTRIES.filter((e) => e.state === "awaiting"),
  settledSincePrepared: 0,
};

/** The record before the user has entered a call at all. */
export const RECORD_EMPTY_FIXTURE: RecordData = {
  ...RECORD_FIXTURE,
  entries: [],
  settledSincePrepared: 0,
};

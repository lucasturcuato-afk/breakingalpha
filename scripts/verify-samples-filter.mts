/**
 * Runs 3 descriptive commentaries (authored from the REAL XBRL captured above,
 * as a stand-in for the gemini-2.5-flash prose that the shipped route produces
 * live; the local key is masked by Vercel) through the SAME sanitize + compliance
 * backstop the route applies, proving the descriptive register survives clean and
 * the disclaimer is attached. Run:
 *   npx tsx scripts/verify-samples-filter.mts
 */
import { sanitizeCommentary, COMMENTARY_DISCLAIMER } from "../src/lib/financials-commentary.ts";
import { filterComplianceLanguage } from "../src/lib/compliance-language-filter.ts";

const SAMPLES: Array<[string, string]> = [
  [
    "International Business Machines",
    "Revenue was 67.535 billion in FY2025, up 7.6 percent from 62.753 billion in FY2024, and has risen in each of the last four fiscal years from 57.350 billion in FY2021. Gross profit reached 39.297 billion, a gross margin of 58.2 percent, up from 56.7 percent a year earlier. Net income was 10.593 billion, up 75.9 percent year over year and the highest in the five years shown, lifting diluted EPS to 11.17 from 6.43. Operating cash flow was 13.193 billion. Stockholders equity increased every year in the period, from 18.901 billion in FY2021 to 32.648 billion in FY2025.",
  ],
  [
    "Caterpillar",
    "Revenue was 67.589 billion in FY2025, up 4.3 percent from 64.809 billion in FY2024. Operating income was 11.151 billion, down 14.7 percent year over year, and operating margin narrowed to 16.5 percent from 20.2 percent. Diluted EPS was 18.81, down from 22.05 the prior year, while the diluted share count declined in each of the last four years, from 548.5 million in FY2021 to 472.3 million in FY2025. Operating cash flow was 11.739 billion. Cash and equivalents rose to 9.980 billion from 6.889 billion a year earlier.",
  ],
  [
    "Otter Tail",
    "Revenue was 1.300 billion in FY2025, down 2.3 percent from 1.330 billion in FY2024 and below the 1.469 billion reported in FY2022. Net income was 275.9 million, down 8.5 percent year over year, and diluted EPS was 6.55 versus 7.17 a year earlier. Operating cash flow was 385.985 million. Stockholders equity increased in each of the five years shown, from 990.777 million in FY2021 to 1.862 billion in FY2025, and cash and equivalents rose to 386.193 million from 1.537 million over the same span.",
  ],
];

for (const [name, raw] of SAMPLES) {
  const sanitized = sanitizeCommentary(raw);
  const filtered = filterComplianceLanguage(sanitized);
  console.log(`\n${"=".repeat(72)}\n${name}\n${"=".repeat(72)}`);
  console.log(filtered.clean);
  console.log(`\n[compliance filter removed ${filtered.findings.length} sentence(s); blocked=${filtered.blocked}]`);
  for (const f of filtered.findings) console.log(`  - [${f.category}] "${f.sentence}"`);
  console.log("Disclaimer: " + COMMENTARY_DISCLAIMER);
}

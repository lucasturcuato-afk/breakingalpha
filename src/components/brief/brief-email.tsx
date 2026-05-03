/**
 * Signalera Morning/Evening Brief — HTML email template (react-email).
 *
 * Mirrors the PDF content but single-column, max-width 600px, inline styles,
 * web-safe fonts (Georgia/Arial). Heritage Gold #c9922a accents. Consumed by
 * `src/app/api/brief/send-email/route.ts` via `render()`.
 */

import {
  Html,
  Head,
  Body,
  Container,
  Heading,
  Text,
  Section,
  Hr,
  Link,
  Preview,
} from "@react-email/components";

/* ── Types (kept local so we don't import the PDF file on the email path) ─ */

export interface EmailTopDeal {
  company?: string;
  value?: string;
  deal_type?: string;
  one_liner?: string;
}

export interface EmailMarketPulse {
  sentiment_word?: string;
  narrative?: string;
  headlines?: Array<{ title: string; href?: string }>;
}

export interface BriefEmailPayload {
  id?: string;
  headline?: string;
  summary?: string;
  market_tone?: string;
  sections?: Record<string, string> | null;
  top_deals?: EmailTopDeal[];
  sector_breakdown?: Record<string, string> | null;
  created_at?: string;
  market_pulse?: EmailMarketPulse | null;
  briefing_type?: "morning" | "evening";
  issue_number?: number | null;
}

interface BriefEmailProps {
  briefing: BriefEmailPayload;
  recipientName?: string;
  /** Absolute URL that opens this brief in a browser (signalera.ai/share/brief/...). */
  viewInBrowserUrl?: string;
  /** Absolute URL that one-click unsubscribes the recipient. */
  unsubscribeUrl?: string;
}

/* ── Tokens ────────────────────────────────────────────────────────────── */

const GOLD = "#c9922a";
const INK = "#1f1a14";
const MUTED = "#6b6458";
const RULE = "#e7dec8";
const BG = "#fbf8f1";

const SECTION_TITLES: Record<string, string> = {
  macro_and_rates: "Macro & Rates",
  deals_and_ma: "Deals & M&A",
  public_markets: "Public Markets",
  geopolitics: "Geopolitics",
  sector_spotlight: "Sector Spotlight",
  what_to_watch: "What to Watch",
  tomorrow_setup: "Tomorrow's Setup",
};

function titleForKey(k: string): string {
  return (
    SECTION_TITLES[k] ??
    k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function splitParagraphs(text?: string): string[] {
  if (!text) return [];
  return text
    .split(/\n\s*\n|\r\n\r\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function formatGeneratedAt(iso?: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return (
      d.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }) +
      " · " +
      d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    );
  } catch {
    return iso;
  }
}

/**
 * Format the issue header date as "Friday, May 1, 2026".
 *
 * Always en-US, always long weekday + month, no timezone conversion
 * surprises in mail clients (Date is parsed once, then formatted).
 */
function formatIssueDate(iso?: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

/* ── Main component ────────────────────────────────────────────────────── */

export function BriefEmail({
  briefing,
  recipientName,
  viewInBrowserUrl,
  unsubscribeUrl,
}: BriefEmailProps) {
  const label =
    (briefing.briefing_type ?? "morning") === "evening"
      ? "EVENING WRAP"
      : "MORNING BRIEF";
  const generatedAt = formatGeneratedAt(briefing.created_at);
  const issueDate = formatIssueDate(briefing.created_at);
  const issueNumber =
    typeof briefing.issue_number === "number" && briefing.issue_number > 0
      ? briefing.issue_number
      : null;
  const pulse = briefing.market_pulse ?? null;
  const sections = briefing.sections ?? {};
  const sectionEntries = Object.entries(sections).filter(
    ([, v]) => typeof v === "string" && (v as string).trim().length > 0,
  );
  const topDeals = (briefing.top_deals ?? []).filter(
    (d) => d && (d.company || d.value || d.one_liner),
  );

  const previewText =
    briefing.headline ||
    (label === "EVENING WRAP"
      ? "Signalera Evening Wrap"
      : "Signalera Morning Brief");

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body
        style={{
          backgroundColor: BG,
          fontFamily: 'Arial, "Helvetica Neue", Helvetica, sans-serif',
          margin: 0,
          padding: 0,
          color: INK,
        }}
      >
        <Container
          style={{
            maxWidth: "600px",
            margin: "0 auto",
            padding: "32px 24px 48px",
            backgroundColor: "#ffffff",
          }}
        >
          {/* View-in-browser bar (small/secondary, sits above masthead) */}
          {viewInBrowserUrl ? (
            <Section style={{ marginBottom: "16px" }}>
              <Text
                style={{
                  fontSize: "11px",
                  color: MUTED,
                  margin: 0,
                  textAlign: "right",
                }}
              >
                Trouble viewing this email?{" "}
                <Link
                  href={viewInBrowserUrl}
                  style={{
                    color: MUTED,
                    textDecoration: "underline",
                  }}
                >
                  View in browser
                </Link>
              </Text>
            </Section>
          ) : null}

          {/* Header */}
          <Section style={{ marginBottom: "12px" }}>
            <Heading
              as="h1"
              style={{
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontSize: "28px",
                color: GOLD,
                margin: 0,
                letterSpacing: "0.5px",
              }}
            >
              Signalera
            </Heading>
            <Text
              style={{
                fontSize: "10px",
                letterSpacing: "2px",
                color: MUTED,
                textTransform: "uppercase",
                margin: "2px 0 0 0",
                fontWeight: 700,
              }}
            >
              {label}
            </Text>
            {issueNumber || issueDate ? (
              <Text
                style={{
                  fontSize: "12px",
                  color: INK,
                  margin: "4px 0 0 0",
                  fontWeight: 600,
                }}
              >
                {issueNumber ? `Issue #${issueNumber}` : ""}
                {issueNumber && issueDate ? " · " : ""}
                {issueDate}
              </Text>
            ) : null}
            {generatedAt && !issueDate ? (
              <Text
                style={{
                  fontSize: "11px",
                  color: MUTED,
                  margin: "4px 0 0 0",
                }}
              >
                {generatedAt}
                {briefing.market_tone ? ` · Tone: ${briefing.market_tone}` : ""}
              </Text>
            ) : briefing.market_tone ? (
              <Text
                style={{
                  fontSize: "11px",
                  color: MUTED,
                  margin: "4px 0 0 0",
                }}
              >
                {`Tone: ${briefing.market_tone}`}
              </Text>
            ) : null}
          </Section>

          <Hr style={{ borderColor: GOLD, borderWidth: "1px", margin: "12px 0 20px" }} />

          {recipientName ? (
            <Text
              style={{
                fontSize: "14px",
                color: INK,
                margin: "0 0 16px 0",
              }}
            >
              Hi {recipientName},
            </Text>
          ) : null}

          {/* Market Pulse */}
          {pulse && (pulse.sentiment_word || pulse.narrative) ? (
            <Section style={{ marginBottom: "24px" }}>
              <Text style={labelStyle}>MARKET PULSE</Text>
              {pulse.sentiment_word ? (
                <Text
                  style={{
                    fontFamily: 'Georgia, "Times New Roman", serif',
                    fontStyle: "italic",
                    fontSize: "18px",
                    lineHeight: 1.45,
                    color: INK,
                    borderLeft: `3px solid ${GOLD}`,
                    paddingLeft: "12px",
                    margin: "0 0 12px 0",
                  }}
                >
                  &ldquo;Today the market is {pulse.sentiment_word}.&rdquo;
                </Text>
              ) : null}
              {splitParagraphs(pulse.narrative).map((p, i) => (
                <Text key={i} style={paraStyle}>
                  {p}
                </Text>
              ))}
              {pulse.headlines && pulse.headlines.length > 0 ? (
                <Section>
                  <Text style={{ ...paraStyle, color: MUTED, fontSize: "12px" }}>
                    Headlines driving this:
                  </Text>
                  {pulse.headlines.slice(0, 4).map((h, i) =>
                    h.href ? (
                      <Text key={i} style={{ ...paraStyle, color: MUTED, fontSize: "12px", margin: "0 0 4px 0" }}>
                        {"• "}
                        <Link href={h.href} style={{ color: GOLD, textDecoration: "none" }}>
                          {h.title}
                        </Link>
                      </Text>
                    ) : (
                      <Text key={i} style={{ ...paraStyle, color: MUTED, fontSize: "12px", margin: "0 0 4px 0" }}>
                        {"• "}{h.title}
                      </Text>
                    ),
                  )}
                </Section>
              ) : null}
            </Section>
          ) : null}

          {/* Today's Lead */}
          {(briefing.headline || briefing.summary) ? (
            <Section style={{ marginBottom: "24px" }}>
              <Text style={labelStyle}>TODAY&rsquo;S LEAD</Text>
              {briefing.headline ? (
                <Heading
                  as="h2"
                  style={{
                    fontFamily: 'Georgia, "Times New Roman", serif',
                    fontSize: "22px",
                    color: INK,
                    lineHeight: 1.25,
                    margin: "0 0 10px 0",
                  }}
                >
                  {briefing.headline}
                </Heading>
              ) : null}
              {splitParagraphs(briefing.summary).map((p, i) => (
                <Text key={i} style={paraStyle}>
                  {p}
                </Text>
              ))}
            </Section>
          ) : null}

          {/* Analyst Briefing */}
          {sectionEntries.length > 0 ? (
            <Section style={{ marginBottom: "24px" }}>
              <Text style={labelStyle}>ANALYST BRIEFING</Text>
              {sectionEntries.map(([key, body]) => (
                <Section key={key} style={{ marginBottom: "14px" }}>
                  <Heading
                    as="h3"
                    style={{
                      fontFamily: 'Georgia, "Times New Roman", serif',
                      fontSize: "15px",
                      color: INK,
                      margin: "0 0 4px 0",
                    }}
                  >
                    {titleForKey(key)}
                  </Heading>
                  {splitParagraphs(body as string).map((p, i) => (
                    <Text key={i} style={paraStyle}>
                      {p}
                    </Text>
                  ))}
                </Section>
              ))}
            </Section>
          ) : null}

          {/* Top Deals */}
          {topDeals.length > 0 ? (
            <Section style={{ marginBottom: "24px" }}>
              <Text style={labelStyle}>TOP DEALS TO WATCH</Text>
              {topDeals.map((deal, i) => (
                <Section
                  key={i}
                  style={{
                    padding: "10px 0",
                    borderBottom: `1px solid ${RULE}`,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: 'Georgia, "Times New Roman", serif',
                      fontSize: "14px",
                      fontWeight: 700,
                      color: INK,
                      margin: 0,
                    }}
                  >
                    {deal.company || "—"}
                    {deal.value ? (
                      <span style={{ color: GOLD, fontFamily: "Arial, sans-serif", fontSize: "12px", fontWeight: 700, marginLeft: "8px" }}>
                        {" "}{deal.value}
                      </span>
                    ) : null}
                    {deal.deal_type ? (
                      <span style={{ color: MUTED, fontSize: "11px", marginLeft: "8px", fontWeight: 400 }}>
                        {" "}· {deal.deal_type}
                      </span>
                    ) : null}
                  </Text>
                  {deal.one_liner ? (
                    <Text style={{ ...paraStyle, color: MUTED, fontSize: "12px", margin: "4px 0 0 0" }}>
                      {deal.one_liner}
                    </Text>
                  ) : null}
                </Section>
              ))}
            </Section>
          ) : null}

          {/* Footer */}
          <Hr style={{ borderColor: RULE, margin: "32px 0 16px" }} />
          <Text
            style={{
              fontSize: "11px",
              color: MUTED,
              textAlign: "center",
              margin: "0 0 8px 0",
            }}
          >
            Sent by{" "}
            <Link
              href="https://signalera.ai"
              style={{ color: GOLD, textDecoration: "none", fontWeight: 700 }}
            >
              Signalera
            </Link>
            {" · Premium market intelligence."}
          </Text>
          {unsubscribeUrl ? (
            <Text
              style={{
                fontSize: "11px",
                color: MUTED,
                textAlign: "center",
                margin: 0,
              }}
            >
              <Link
                href={unsubscribeUrl}
                style={{ color: MUTED, textDecoration: "underline" }}
              >
                Unsubscribe from Morning Brief
              </Link>
            </Text>
          ) : null}
        </Container>
      </Body>
    </Html>
  );
}

/* ── shared inline styles ──────────────────────────────────────────────── */

const labelStyle: React.CSSProperties = {
  fontSize: "10px",
  letterSpacing: "2px",
  color: GOLD,
  textTransform: "uppercase",
  fontWeight: 700,
  margin: "0 0 8px 0",
};

const paraStyle: React.CSSProperties = {
  fontSize: "14px",
  lineHeight: 1.55,
  color: INK,
  margin: "0 0 8px 0",
};

export default BriefEmail;

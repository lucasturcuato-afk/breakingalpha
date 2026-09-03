/**
 * Memo PDF renderer.
 *
 * Consumed by `src/app/api/memo/export-pdf/route.ts`.
 *
 * Faces are the app's own: Fraunces for display, Space Grotesk for body,
 * instanced to static weights and read off disk at module load. No network
 * fetch at render time. If a face fails to load we fall back to the built-in
 * PDF faces so an export never fails over typography.
 *
 * Copy rule: this file emits no prose of its own beyond the fixed footer
 * disclaimer. Every other word on the page comes from the memo.
 */

import fs from "node:fs";
import path from "node:path";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import type { MemoBlock, MemoInline, MemoSnapshotEntry } from "@/lib/memo-blocks";

/* ── Tokens, from src/styles/tokens.css light theme ────────────────────── */

const INK = "#1a1208"; // --text-primary / --espresso
const SECONDARY = "#6b5a3f"; // --text-secondary
const MUTED = "#7a6a4d"; // --text-muted
const FAINT = "#827158"; // --text-faint
const RULE = "#ede4d3"; // --border-base
const HAIRLINE = "#f0e8d6"; // --border-subtle

/* ── Faces ─────────────────────────────────────────────────────────────── */

const DISPLAY = "Fraunces";
const SANS = "SpaceGrotesk";

const FONT_DIR = path.join(process.cwd(), "public", "fonts", "memo-pdf");

/**
 * True when the app faces registered. False means the files were not on disk
 * (see the outputFileTracingIncludes note in the PR) and we are on built-ins.
 */
let fontsReady = false;

try {
  const face = (file: string) => {
    const full = path.join(FONT_DIR, file);
    if (!fs.existsSync(full)) throw new Error(`missing face ${file}`);
    return full;
  };
  Font.register({
    family: DISPLAY,
    fonts: [
      { src: face("Fraunces-Regular.ttf"), fontWeight: 400 },
      { src: face("Fraunces-SemiBold.ttf"), fontWeight: 600 },
      { src: face("Fraunces-Bold.ttf"), fontWeight: 700 },
    ],
  });
  Font.register({
    family: SANS,
    fonts: [
      { src: face("SpaceGrotesk-Regular.ttf"), fontWeight: 400 },
      { src: face("SpaceGrotesk-Bold.ttf"), fontWeight: 700 },
    ],
  });
  fontsReady = true;
} catch (e) {
  console.warn("[memo-pdf] app faces unavailable, using built-in PDF faces:", e);
}

// react-pdf hyphenates by default, which broke the title mid-word. Words stay
// whole and wrap to the next line instead.
Font.registerHyphenationCallback((word) => [word]);

const sansFamily = fontsReady ? SANS : "Helvetica";

/** Built-ins have no weight axis, so bold has to be named explicitly. */
const displayBold = fontsReady ? { fontFamily: DISPLAY, fontWeight: 700 as const } : { fontFamily: "Times-Bold" };
const displaySemi = fontsReady ? { fontFamily: DISPLAY, fontWeight: 600 as const } : { fontFamily: "Times-Bold" };
const sansBold = fontsReady ? { fontFamily: SANS, fontWeight: 700 as const } : { fontFamily: "Helvetica-Bold" };

/* ── Metrics ───────────────────────────────────────────────────────────── */

const MARGIN_X = 54;
/** Footer band height. Page bottom padding must clear it so nothing overlaps. */
const FOOTER_BAND = 46;

const styles = StyleSheet.create({
  page: {
    paddingTop: 46,
    paddingBottom: FOOTER_BAND + 20,
    paddingHorizontal: MARGIN_X,
    fontFamily: sansFamily,
    fontSize: 13,
    color: SECONDARY,
  },

  /* Header, first page only */
  wordmarkRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 14,
  },
  wordmark: {
    ...displaySemi,
    fontSize: 11,
    letterSpacing: 0.3,
    color: INK,
  },
  headerStamp: {
    fontFamily: sansFamily,
    fontSize: 8.5,
    color: FAINT,
  },
  title: {
    ...displayBold,
    fontSize: 24,
    lineHeight: 1.18,
    color: INK,
  },
  metaLine: {
    fontFamily: sansFamily,
    fontSize: 9,
    color: MUTED,
    marginTop: 7,
  },
  headerRule: {
    borderBottomWidth: 0.75,
    borderBottomColor: RULE,
    marginTop: 14,
    marginBottom: 18,
  },

  /* Snapshot */
  snapshot: {
    borderWidth: 0.75,
    borderColor: RULE,
    borderRadius: 3,
    paddingVertical: 11,
    paddingHorizontal: 13,
    marginBottom: 18,
  },
  snapshotTitle: {
    ...sansBold,
    fontSize: 9,
    color: MUTED,
    marginBottom: 7,
  },
  snapshotRow: {
    flexDirection: "row",
    marginBottom: 3.5,
  },
  snapshotLabel: {
    fontFamily: sansFamily,
    fontSize: 10,
    color: MUTED,
    width: 128,
  },
  snapshotValue: {
    ...sansBold,
    flex: 1,
    fontSize: 10,
    color: INK,
  },

  /* Body */
  h1: {
    ...displayBold,
    fontSize: 17,
    color: INK,
    marginTop: 16,
    marginBottom: 7,
  },
  h2: {
    ...displayBold,
    fontSize: 15,
    color: INK,
    marginTop: 14,
    marginBottom: 6,
  },
  h3: {
    ...displaySemi,
    fontSize: 15,
    color: INK,
    marginTop: 13,
    marginBottom: 5,
  },
  paragraph: {
    fontFamily: sansFamily,
    fontSize: 13,
    lineHeight: 1.62,
    color: SECONDARY,
    marginBottom: 8,
  },
  listRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  listMarker: {
    fontFamily: sansFamily,
    fontSize: 13,
    lineHeight: 1.62,
    color: MUTED,
    width: 15,
  },
  listBody: {
    flex: 1,
    fontFamily: sansFamily,
    fontSize: 13,
    lineHeight: 1.62,
    color: SECONDARY,
  },
  strong: {
    ...sansBold,
    color: INK,
  },
  rule: {
    borderBottomWidth: 0.75,
    borderBottomColor: HAIRLINE,
    marginVertical: 12,
  },

  /* Tables */
  table: {
    marginTop: 4,
    marginBottom: 12,
    borderTopWidth: 0.75,
    borderTopColor: RULE,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.75,
    borderBottomColor: HAIRLINE,
    paddingVertical: 5,
  },
  tableHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: 0.75,
    borderBottomColor: RULE,
    paddingVertical: 5,
  },
  tableCell: {
    fontFamily: sansFamily,
    fontSize: 10.5,
    lineHeight: 1.45,
    color: SECONDARY,
    paddingRight: 8,
  },
  tableHeaderCell: {
    ...sansBold,
    fontSize: 10.5,
    lineHeight: 1.45,
    color: INK,
    paddingRight: 8,
  },

  /* Footer, every page */
  footer: {
    position: "absolute",
    bottom: 24,
    left: MARGIN_X,
    right: MARGIN_X,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderTopWidth: 0.75,
    borderTopColor: HAIRLINE,
    paddingTop: 7,
  },
  footerText: {
    fontFamily: sansFamily,
    fontSize: 7.5,
    color: MUTED,
  },
});

/* ── Helpers ───────────────────────────────────────────────────────────── */

function Runs({ runs }: { runs: MemoInline[] }) {
  return (
    <>
      {runs.map((run, i) => (
        <Text key={i} style={run.bold ? styles.strong : undefined}>
          {run.text}
        </Text>
      ))}
    </>
  );
}

/** Generation stamp in Eastern time, the desk's clock. */
function etStamp(at: Date): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
  return `${formatted} ET`;
}

function SnapshotBlock({
  title,
  entries,
}: {
  title: string;
  entries: MemoSnapshotEntry[];
}) {
  return (
    <View style={styles.snapshot} wrap={false}>
      <Text style={styles.snapshotTitle}>{title}</Text>
      {entries.map((entry, i) => (
        <View key={i} style={styles.snapshotRow}>
          <Text style={styles.snapshotLabel}>{entry.label}</Text>
          <Text style={styles.snapshotValue}>
            <Runs runs={entry.value} />
          </Text>
        </View>
      ))}
    </View>
  );
}

function TableBlock({
  header,
  rows,
}: {
  header: MemoInline[][] | null;
  rows: MemoInline[][][];
}) {
  const columns = Math.max(header?.length ?? 0, ...rows.map((r) => r.length), 1);
  const width = `${100 / columns}%`;

  return (
    <View style={styles.table}>
      {header ? (
        <View style={styles.tableHeaderRow} wrap={false}>
          {Array.from({ length: columns }, (_, c) => (
            <Text key={c} style={[styles.tableHeaderCell, { width }]}>
              {header[c] ? <Runs runs={header[c]} /> : ""}
            </Text>
          ))}
        </View>
      ) : null}
      {rows.map((row, r) => (
        <View key={r} style={styles.tableRow} wrap={false}>
          {Array.from({ length: columns }, (_, c) => (
            <Text key={c} style={[styles.tableCell, { width }]}>
              {row[c] ? <Runs runs={row[c]} /> : ""}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

/* ── Document ──────────────────────────────────────────────────────────── */

export interface MemoPdfProps {
  /** Company or subject name, same string the modal header shows. */
  title: string;
  /** Type label, e.g. "Deal Memo". Passed through from the calling surface. */
  kicker: string;
  blocks: MemoBlock[];
  /** Ticker or resolved entity, shown on the metadata line when known. */
  entity?: string;
  /** Source publisher, shown on the metadata line when known. */
  sourcePublisher?: string;
  /** Generation time. Defaults to now; injectable so tests are stable. */
  generatedAt?: Date;
}

export function MemoPdf({
  title,
  kicker,
  blocks,
  entity,
  sourcePublisher,
  generatedAt,
}: MemoPdfProps) {
  const stamp = etStamp(generatedAt ?? new Date());

  // Snapshot blocks are hoisted directly under the header regardless of where
  // the model put them in the prose.
  const snapshots = blocks.filter((b) => b.kind === "snapshot");
  const body = blocks.filter((b) => b.kind !== "snapshot");

  const meta = [entity, kicker, sourcePublisher].filter(Boolean).join("   /   ");

  return (
    <Document title={title}>
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.wordmarkRow}>
          <Text style={styles.wordmark}>Signalera</Text>
          <Text style={styles.headerStamp}>{stamp}</Text>
        </View>
        <Text style={styles.title}>{title}</Text>
        {meta ? <Text style={styles.metaLine}>{meta}</Text> : null}
        <View style={styles.headerRule} />

        {snapshots.map((block, i) =>
          block.kind === "snapshot" ? (
            <SnapshotBlock key={`snap-${i}`} title={block.title} entries={block.entries} />
          ) : null,
        )}

        {body.map((block, i) => {
          if (block.kind === "rule") {
            return <View key={i} style={styles.rule} />;
          }
          if (block.kind === "heading") {
            const style =
              block.level === 1 ? styles.h1 : block.level === 2 ? styles.h2 : styles.h3;
            // minPresenceAhead keeps a heading from orphaning at a page bottom:
            // if this much body cannot follow it, the heading moves with it.
            return (
              <Text key={i} style={style} wrap={false} minPresenceAhead={64}>
                <Runs runs={block.runs} />
              </Text>
            );
          }
          if (block.kind === "table") {
            return <TableBlock key={i} header={block.header} rows={block.rows} />;
          }
          if (block.kind === "bullet" || block.kind === "ordered") {
            return (
              <View
                key={i}
                style={[styles.listRow, { paddingLeft: 4 + block.depth * 14 }]}
                wrap={false}
              >
                <Text style={styles.listMarker}>
                  {block.kind === "bullet" ? (block.depth > 0 ? "◦" : "•") : block.marker}
                </Text>
                <Text style={styles.listBody}>
                  <Runs runs={block.runs} />
                </Text>
              </View>
            );
          }
          return (
            <Text key={i} style={styles.paragraph}>
              <Runs runs={block.runs} />
            </Text>
          );
        })}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Informational only. Not investment advice.
          </Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) =>
              `${pageNumber} / ${totalPages}   ${stamp}   signalera.ai`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

export default MemoPdf;

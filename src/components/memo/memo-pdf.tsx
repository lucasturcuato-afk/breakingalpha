/**
 * Memo PDF renderer.
 *
 * Built with @react-pdf/renderer using the built-in Helvetica/Times faces so
 * no network font fetch happens at request time. Consumed by
 * `src/app/api/memo/export-pdf/route.ts`.
 *
 * Copy rule: this file emits no prose of its own beyond the type label the
 * modal header already shows. Every other word on the page comes from the
 * memo the user is looking at.
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { MemoBlock, MemoInline } from "@/lib/memo-blocks";

/* Tokens mirror src/components/brief/brief-pdf.tsx. */
const GOLD = "#c9922a";
const INK = "#1f1a14";
const MUTED = "#6b6458";
const RULE = "#e7dec8";

const styles = StyleSheet.create({
  page: {
    paddingTop: 44,
    paddingBottom: 48,
    paddingHorizontal: 46,
    fontFamily: "Helvetica",
    color: INK,
  },
  kicker: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 1.1,
    color: GOLD,
    marginBottom: 6,
  },
  title: {
    fontFamily: "Times-Bold",
    fontSize: 21,
    lineHeight: 1.2,
    color: INK,
  },
  masthead: {
    borderBottomWidth: 1.5,
    borderBottomColor: GOLD,
    paddingBottom: 10,
    marginBottom: 18,
  },
  h1: {
    fontFamily: "Times-Bold",
    fontSize: 15,
    marginTop: 14,
    marginBottom: 6,
  },
  h2: {
    fontFamily: "Times-Bold",
    fontSize: 13,
    marginTop: 12,
    marginBottom: 5,
  },
  h3: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    letterSpacing: 0.7,
    color: MUTED,
    marginTop: 12,
    marginBottom: 5,
  },
  paragraph: {
    fontSize: 10,
    lineHeight: 1.55,
    marginBottom: 7,
  },
  listRow: {
    flexDirection: "row",
    marginBottom: 4,
    paddingLeft: 4,
  },
  listMarker: {
    fontSize: 10,
    lineHeight: 1.55,
    color: GOLD,
    width: 14,
  },
  listBody: {
    flex: 1,
    fontSize: 10,
    lineHeight: 1.55,
  },
  bold: {
    fontFamily: "Helvetica-Bold",
  },
  rule: {
    borderBottomWidth: 1,
    borderBottomColor: RULE,
    marginVertical: 10,
  },
  footer: {
    position: "absolute",
    bottom: 26,
    left: 46,
    right: 46,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: MUTED,
  },
});

function Runs({ runs }: { runs: MemoInline[] }) {
  return (
    <>
      {runs.map((run, i) => (
        <Text key={i} style={run.bold ? styles.bold : undefined}>
          {run.text}
        </Text>
      ))}
    </>
  );
}

export interface MemoPdfProps {
  /** Company or subject name, same string the modal header shows. */
  title: string;
  /** Type label, e.g. "Deal Memo". Passed through from the calling surface. */
  kicker: string;
  blocks: MemoBlock[];
}

export function MemoPdf({ title, kicker, blocks }: MemoPdfProps) {
  return (
    <Document title={title}>
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.masthead}>
          {kicker ? <Text style={styles.kicker}>{kicker.toUpperCase()}</Text> : null}
          <Text style={styles.title}>{title}</Text>
        </View>

        {blocks.map((block, i) => {
          if (block.kind === "rule") {
            return <View key={i} style={styles.rule} />;
          }
          if (block.kind === "heading") {
            const style =
              block.level === 1 ? styles.h1 : block.level === 2 ? styles.h2 : styles.h3;
            return (
              <Text key={i} style={style} wrap={false}>
                <Runs runs={block.runs} />
              </Text>
            );
          }
          if (block.kind === "bullet" || block.kind === "ordered") {
            return (
              <View key={i} style={styles.listRow} wrap={false}>
                <Text style={styles.listMarker}>
                  {block.kind === "bullet" ? "•" : block.marker}
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
          <Text>Signalera</Text>
          <Text
            render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

export default MemoPdf;

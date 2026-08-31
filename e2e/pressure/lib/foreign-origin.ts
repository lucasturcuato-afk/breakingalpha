/**
 * A genuine foreign origin, on a second local port.
 *
 * THE POINT OF THE PORT. The ejection this exists to test only happens when the
 * entry into Signalera came from a page that is NOT ours: Slack, iMessage,
 * email, a search result. `navigation.entries()` is by spec the SAME-ORIGIN
 * CONTIGUOUS slice of the tab's history, so a referrer only stays out of that
 * slice if it is genuinely another origin. Same port, different path is our own
 * origin and would be in the slice, which would test nothing.
 *
 * A `data:` URL will not do it either: Chromium blocks top-level navigation to
 * `data:`, so the referring page could not exist. A second port is the cheapest
 * thing that is really foreign, and `localhost:3371` is a different origin from
 * `localhost:3370` under the same-origin rule (scheme, host AND port).
 *
 * The links are real anchors and the clicks are real clicks, so the reader
 * arrives the way a reader arrives.
 */
import { createServer, type Server } from "http";

export const FOREIGN_PORT = 3371;
export const FOREIGN_ORIGIN = `http://localhost:${FOREIGN_PORT}`;

/** The three screens that carry a history-aware back control. */
export const BACK_SCREENS = [
  { label: "Deal Flow", path: "/deal-flow" },
  { label: "Live Feed", path: "/live-feed" },
  { label: "Trends", path: "/trends-mobile" },
];

function page(appBase: string): string {
  const links = BACK_SCREENS.map(
    (s) => `<p><a id="to${s.path.replace(/\W/g, "")}" href="${appBase}${s.path}">${s.label}</a></p>`,
  ).join("\n");
  return `<!doctype html><meta charset="utf-8"><title>Not Signalera</title>
<h1>A page that is not Signalera</h1>
<p>Stands in for Slack, iMessage, email or a search result.</p>
${links}
<p><a id="toask" href="${appBase}/ask">Browse</a></p>`;
}

export async function startForeignOrigin(appBase: string): Promise<Server> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page(appBase));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(FOREIGN_PORT, "127.0.0.1", resolve);
  });
  return server;
}

export async function stopForeignOrigin(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

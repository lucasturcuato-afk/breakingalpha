/**
 * The walk itself: tap-driven, not a link crawl.
 *
 * A crawler reads `href` and enumerates a sitemap. This starts at the four
 * poles and only ever reaches a screen by ACTIVATING a control that was on the
 * screen before it, which is the only definition of "reachable" that describes
 * a reader. A route that only a URL bar can reach never enters the graph, and
 * that absence is the finding `routes-only-by-url` reports.
 */
import type { Page } from "@playwright/test";
import { enumerateControls, screenIsSelfMutating, tapAndObserve, type ControlInfo } from "./probe";
import { allRules, readScreenText } from "./rules";
import { controlLog, finding, note, routeVisit } from "./report";
import { warmGoto, type Theme } from "./harness";

export const POLE_ROUTES: Array<{ label: string; href: string }> = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Ledger", href: "/ledger" },
  { label: "Radar", href: "/watch" },
  { label: "Browse", href: "/ask" },
];

const MAX_ROUTES = 32;
const MAX_CONTROLS_PER_SCREEN = 40;

/** Same-origin app path, query and hash stripped for identity. */
function normalise(u: string, base: string): string | null {
  try {
    const url = new URL(u, base);
    if (url.origin !== new URL(base).origin) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

export interface WalkResult {
  visited: string[];
  edges: Array<{ from: string; to: string; via: string }>;
  deadControls: number;
  probed: number;
}

export async function runRules(page: Page, screen: string, theme: Theme, pass: "empty" | "populated") {
  const t = await readScreenText(page);
  const hits = allRules(t);
  for (const h of hits) {
    finding({
      severity:
        h.rule === "aggregate-rate" || h.rule === "outcome-vocabulary-token"
          ? "high"
          : h.rule === "banned-substring" || h.rule === "reader-sentence-in-empty-state"
            ? "medium"
            : "low",
      rule: h.rule,
      screen,
      theme,
      pass,
      title: `${h.rule} on ${screen}`,
      evidence: h.detail,
      basis: "measured",
    });
  }
  return hits.length;
}

/** Geometry and type size. No clicking; these are read off the layout. */
export function auditGeometry(controls: ControlInfo[], screen: string, theme: Theme, pass: "empty" | "populated") {
  for (const c of controls) {
    if (c.isTextEntry && c.fontSize < 16) {
      finding({
        severity: "high",
        rule: "text-entry-under-16px",
        screen,
        theme,
        pass,
        title: `text entry at ${c.fontSize}px zooms iOS Safari`,
        evidence: `${c.tag}${c.ariaLabel ? `[aria-label="${c.ariaLabel}"]` : ""} computed font-size ${c.fontSize}px, box ${c.rect.w}x${c.rect.h}, path ${c.path}`,
        basis: "measured",
      });
    }
    if (!c.interactiveRole && c.cursor !== "pointer") continue;
    /* THE VISUALLY-HIDDEN PATTERN IS NOT A SMALL TAP TARGET. A skip link is
       clipped to 1x1 until it takes focus, at which point it draws at full
       size; reporting it as a 1x1 target is reporting the accessibility
       affordance as the defect. Anything at or under 2x2 is that pattern, and
       it is recorded rather than counted. */
    if (c.rect.w <= 2 || c.rect.h <= 2) {
      note(
        "visually-hidden-control",
        screen,
        `${c.tag} "${c.text || c.ariaLabel || ""}" measures ${c.rect.w}x${c.rect.h}, the clipped/sr-only pattern. Not counted as a small tap target.`,
        "measured",
      );
      continue;
    }
    const small = c.rect.w < 44 || c.rect.h < 44;
    if (small && !c.isTextEntry) {
      finding({
        severity: c.rect.w < 30 || c.rect.h < 30 ? "high" : "medium",
        rule: "tap-target-under-44",
        screen,
        theme,
        pass,
        title: `${c.tag}${c.role ? `[role=${c.role}]` : ""} computed box ${c.rect.w}x${c.rect.h}`,
        evidence: `text="${c.text || c.ariaLabel || ""}" box ${c.rect.w}x${c.rect.h} (border box, the box a finger hits) path ${c.path}`,
        basis: "measured",
      });
    }
  }
}

/**
 * One screen: rules, geometry, then every control tapped.
 *
 * Returns the routes this screen led to.
 */
export async function probeScreen(
  page: Page,
  route: string,
  base: string,
  theme: Theme,
  pass: "empty" | "populated",
): Promise<{ next: Array<{ to: string; via: string }>; probed: number; dead: number }> {
  await runRules(page, route, theme, pass);

  /* LIST THREE. A screen the walk reached and could not put into a meaningful
     state. Three distinguishable causes, and they are not the same finding:
       - unwired: the screen says so itself, no loader behind it
       - empty:   the read worked and the account has nothing to draw
       - failed:  the read faulted
     Recorded per screen so the report can say which, rather than lumping every
     thin screen into "no data". */
  const state = await page.evaluate(() => {
    const t = ((document.body as HTMLElement).innerText ?? "").toLowerCase();
    return {
      unwired: /not wired|unwired|does not answer yet|not set up yet|migration pending/.test(t),
      empty: /nothing on your|you follow nothing|nothing to show|no entries|nothing yet|there is nothing/.test(t),
      failed: /could not load|could not read|something went wrong|try again/.test(t),
      chars: t.replace(/\s+/g, " ").trim().length,
      sample: ((document.body as HTMLElement).innerText ?? "").replace(/\s+/g, " ").slice(0, 300),
    };
  });
  if (state.unwired || state.empty || state.failed) {
    note(
      "no-meaningful-state",
      route,
      `${[state.unwired ? "UNWIRED" : "", state.empty ? "EMPTY" : "", state.failed ? "FAILED-READ" : ""].filter(Boolean).join(" + ")} (${pass} pass, ${theme}). Rendered text: "${state.sample}"`,
      "measured",
    );
  }

  /* Establish whether the screen mutates on its own before attributing any DOM
     change to a tap. */
  const volatile_ = await screenIsSelfMutating(page);
  if (volatile_) {
    note(
      "screen-self-mutating",
      route,
      `the DOM changed with no interaction over one settle window (${pass} pass, ${theme}). An inert control on this screen can read as live, so absence of a handler-does-nothing finding here is not evidence there is none.`,
      "measured",
    );
  }

  let controls = await enumerateControls(page);
  auditGeometry(controls, route, theme, pass);
  controls = controls.slice(0, MAX_CONTROLS_PER_SCREEN);

  const next: Array<{ to: string; via: string }> = [];
  let probed = 0;
  let dead = 0;

  for (let i = 0; i < controls.length; i++) {
    const c = controls[i];
    if (c.disabled) {
      controlLog({ route, theme, pass, control: c.path, text: c.text, verdict: "disabled-skipped" });
      continue;
    }
    if (c.isTextEntry) {
      controlLog({ route, theme, pass, control: c.path, text: c.text, verdict: "text-entry-not-tapped" });
      continue;
    }
    /* Reset to a known screen so control i is the control that was enumerated. */
    const cur = normalise(page.url(), base);
    if (cur !== route) {
      await warmGoto(page, route);
    } else {
      const dirty = await page.evaluate(
        () => document.querySelectorAll("[role=dialog],dialog[open],[aria-modal=true]").length > 0,
      );
      if (dirty) await warmGoto(page, route);
    }

    const out = await tapAndObserve(page, c.path);
    probed += 1;
    const appRequests = out.requests.filter((r) => !/\.(js|css|woff2?|png|jpg|svg|ico|map)(\?|$)/.test(r));
    const forced = out.error === "clicked with force (ordinary click was not actionable)";
    const inert = !out.navigated && !out.domChanged && appRequests.length === 0 && (!out.error || forced);

    controlLog({
      route,
      theme,
      pass,
      control: c.path,
      tag: c.tag,
      role: c.role,
      text: c.text,
      href: c.href,
      cursor: c.cursor,
      box: c.rect,
      navigated: out.navigated,
      urlAfter: out.urlAfter,
      domChanged: out.domChanged,
      requests: appRequests.slice(0, 8),
      error: out.error,
      verdict: inert ? "INERT" : out.navigated ? "navigated" : out.domChanged ? "changed-dom" : "fired-request",
    });

    if (out.error === "control not found after reload") {
      note("control-vanished", route, `${c.tag} "${c.text}" at ${c.path} was not present after reload; not probed`, "measured");
      continue;
    }

    if (inert) {
      dead += 1;
      finding({
        severity: c.interactiveRole ? "medium" : "low",
        rule: c.interactiveRole ? "handler-does-nothing" : "cursor-pointer-no-handler",
        screen: route,
        theme,
        pass,
        title: c.interactiveRole
          ? `${c.tag}${c.role ? `[role=${c.role}]` : ""} "${c.text || c.ariaLabel || ""}" activates and changes nothing`
          : `${c.tag} draws cursor:pointer and activates nothing`,
        evidence: `path ${c.path}; after tap: url unchanged (${out.urlAfter}), structural DOM signature unchanged, 0 app requests${volatile_ ? "; NOTE this screen self-mutates, so the DOM half of this reading is weak and the request half is what carries it" : ""}`,
        basis: "measured",
      });
    }

    if (out.navigated) {
      const to = normalise(out.urlAfter, base);
      if (to && to !== route) next.push({ to, via: `${c.tag} "${c.text || c.ariaLabel || c.href || ""}"` });
    }
  }

  return { next, probed, dead };
}

export async function walk(page: Page, base: string, theme: Theme, pass: "empty" | "populated"): Promise<WalkResult> {
  const visited = new Set<string>();
  const edges: WalkResult["edges"] = [];
  const queue: Array<{ route: string; via: string }> = POLE_ROUTES.map((p) => ({
    route: p.href,
    via: `pole:${p.label}`,
  }));
  let deadControls = 0;
  let probed = 0;

  while (queue.length && visited.size < MAX_ROUTES) {
    const item = queue.shift()!;
    if (visited.has(item.route)) continue;
    visited.add(item.route);

    const status = await warmGoto(page, item.route);
    const finalUrl = page.url();
    const landed = normalise(finalUrl, base);
    routeVisit({ route: item.route, reachedBy: item.via, status, finalUrl, pass });

    if (landed !== item.route) {
      finding({
        severity: "high",
        rule: "route-redirected",
        screen: item.route,
        theme,
        pass,
        title: `${item.route} did not stay put; landed on ${landed}`,
        evidence: `HTTP ${status}, final URL ${finalUrl}. Reached by ${item.via}.`,
        basis: "measured",
      });
      continue;
    }
    if (status && status >= 400) {
      finding({
        severity: "high",
        rule: "route-error-status",
        screen: item.route,
        theme,
        pass,
        title: `${item.route} answered HTTP ${status}`,
        evidence: `Reached by ${item.via}.`,
        basis: "measured",
      });
      continue;
    }

    const r = await probeScreen(page, item.route, base, theme, pass);
    probed += r.probed;
    deadControls += r.dead;
    for (const n of r.next) {
      edges.push({ from: item.route, to: n.to, via: n.via });
      if (!visited.has(n.to)) queue.push({ route: n.to, via: `tap:${n.via} from ${item.route}` });
    }
  }

  if (queue.length) {
    note(
      "walk-truncated",
      "(walk)",
      `route cap ${MAX_ROUTES} reached with ${queue.length} still queued: ${queue.map((q) => q.route).join(", ")}`,
      "measured",
    );
  }

  return { visited: Array.from(visited), edges, deadControls, probed };
}

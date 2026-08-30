/**
 * Control probing: what is on the screen, what happens when it is tapped, and
 * how big it actually is.
 *
 * The four defects this looks for, in the prompt's own words:
 *   1. a handler that does nothing
 *   2. cursor: pointer with no handler
 *   3. a tap target under 44px, MEASURED AS THE COMPUTED BOX
 *   4. a text-entry control under 16px computed
 *
 * (3) is the one that is easy to get wrong. `box-sizing: content-box` plus
 * `min-height: 44px` plus vertical padding is this app's own idiom: the drawn
 * glyph is smaller than 44 and the box is not. `getBoundingClientRect` returns
 * the border box, which is the box a finger hits, so that is what is read and
 * that is what is reported.
 *
 * Shadow roots are descended explicitly.
 */
import type { Page } from "@playwright/test";

export interface ControlInfo {
  index: number;
  tag: string;
  role: string | null;
  text: string;
  href: string | null;
  ariaLabel: string | null;
  cursor: string;
  interactiveRole: boolean;
  rect: { w: number; h: number };
  disabled: boolean;
  visible: boolean;
  fontSize: number;
  isTextEntry: boolean;
  path: string;
}

const ENUMERATE = () => {
  const out: Record<string, unknown>[] = [];
  const roots: Array<Document | ShadowRoot> = [document];
  const seenRoots = new Set<unknown>();
  while (roots.length) {
    const root = roots.shift()!;
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);
    root.querySelectorAll("*").forEach((el) => {
      const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      if (sr) roots.push(sr);
    });

    const els = Array.from(root.querySelectorAll<HTMLElement>("*"));
    for (const el of els) {
      const cs = getComputedStyle(el);
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role");
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      const isTextEntry =
        tag === "textarea" ||
        el.isContentEditable ||
        (tag === "input" && ["", "text", "email", "password", "search", "url", "tel", "number"].includes(type));
      const interactiveRole =
        ["a", "button", "select", "summary", "label", "input", "textarea"].includes(tag) ||
        ["button", "link", "tab", "switch", "checkbox", "radio", "menuitem", "option"].includes(role ?? "");
      const pointer = cs.cursor === "pointer";
      if (!interactiveRole && !pointer && !isTextEntry) continue;
      /* An element that merely CONTAINS a control is not a control. If a
         descendant is itself interactive or pointer-cursored, the ancestor is
         a wrapper and probing it would double-count the child's behaviour. */
      if (!interactiveRole && pointer) {
        const inner = el.querySelector("a,button,[role=button],input,textarea,select,summary");
        if (inner) continue;
      }
      const r = el.getBoundingClientRect();
      const visible = cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.01 && r.width > 0 && r.height > 0;
      if (!visible) continue;

      /* A stable-enough path so the same control can be found again after a
         reload. nth-of-type chain from the root. */
      const seg = (n: Element): string => {
        const p = n.parentElement;
        if (!p) return n.tagName.toLowerCase();
        const same = Array.from(p.children).filter((c) => c.tagName === n.tagName);
        return `${n.tagName.toLowerCase()}:nth-of-type(${same.indexOf(n) + 1})`;
      };
      const parts: string[] = [];
      let cur: Element | null = el;
      const rootNode: Node = root as unknown as Node;
      while (cur && (cur as Node) !== rootNode && parts.length < 20) {
        parts.unshift(seg(cur));
        cur = cur.parentElement;
      }

      out.push({
        tag,
        role,
        text: (el.innerText ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80),
        href: el.getAttribute("href"),
        ariaLabel: el.getAttribute("aria-label"),
        cursor: cs.cursor,
        interactiveRole,
        rect: { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 },
        disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
        visible,
        fontSize: parseFloat(cs.fontSize),
        isTextEntry,
        path: parts.join(" > "),
      });
    }
  }
  return out;
};

export async function enumerateControls(page: Page): Promise<ControlInfo[]> {
  const raw = (await page.evaluate(ENUMERATE)) as unknown as Omit<ControlInfo, "index">[];
  return raw.map((c, i) => ({ ...c, index: i }));
}

/** A cheap content hash of the rendered body, for before/after comparison. */
export async function domSignature(page: Page): Promise<string> {
  return page.evaluate(() => {
    const html = document.body.innerHTML;
    let h = 0;
    for (let i = 0; i < html.length; i++) {
      h = (h * 31 + html.charCodeAt(i)) | 0;
    }
    const openDialogs = document.querySelectorAll("[role=dialog],dialog[open],[aria-modal=true]").length;
    return `${html.length}:${h}:${openDialogs}:${document.activeElement?.tagName ?? ""}`;
  });
}

export interface TapOutcome {
  navigated: boolean;
  urlAfter: string;
  domChanged: boolean;
  requests: string[];
  error: string | null;
}

/**
 * Tap one control and record what it did.
 *
 * "Fires no request" is measured on the network, not guessed: every request
 * the page makes between the tap and the settle is recorded, and a control
 * that produced no URL change, no DOM change and no request is the dead one.
 */
export async function tapAndObserve(
  page: Page,
  path: string,
  settleMs = 700,
): Promise<TapOutcome> {
  const requests: string[] = [];
  const onReq = (r: { method: () => string; url: () => string }) => {
    requests.push(`${r.method()} ${r.url()}`);
  };
  page.on("request", onReq);
  const urlBefore = page.url();
  const sigBefore = await domSignature(page);
  let error: string | null = null;
  try {
    const handle = await page.evaluateHandle((p) => {
      const el = document.querySelector(p) as HTMLElement | null;
      return el;
    }, path);
    const el = handle.asElement();
    if (!el) {
      error = "control not found after reload";
    } else {
      await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await el.click({ timeout: 4000, noWaitAfter: true });
    }
  } catch (e) {
    error = String((e as Error).message ?? e).split("\n")[0].slice(0, 200);
  }
  await page.waitForTimeout(settleMs);
  let urlAfter = urlBefore;
  let sigAfter = sigBefore;
  try {
    urlAfter = page.url();
    sigAfter = await domSignature(page);
  } catch {
    /* navigation in flight */
  }
  page.off("request", onReq);
  return {
    navigated: urlAfter !== urlBefore,
    urlAfter,
    domChanged: sigAfter !== sigBefore,
    requests,
    error,
  };
}

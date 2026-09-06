/**
 * Refuse to test a server that is not this checkout.
 *
 * The server on the port answers GET /api/e2e-identity with a hash of its
 * working directory and its git HEAD (src/app/api/e2e-identity/route.ts).
 * This computes the same two values for the checkout the runner is in and
 * compares. Any mismatch, and any server too old to have the endpoint, is
 * an error that names both sides. It is never a skip and never a warning:
 * on 2026-09-05 a foreign dev server on :3000 was reused silently and three
 * weeks of local runs tested old code.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export interface ServerIdentity {
  cwd_hash: string;
  commit: string | null;
  node_env: string | null;
}

export function localCwdHash(cwd: string = process.cwd()): string {
  let real = cwd;
  try {
    real = realpathSync(cwd);
  } catch {
    /* hash as given */
  }
  return createHash("sha256").update(real).digest("hex").slice(0, 16);
}

export function localGitHead(cwd: string = process.cwd()): string | null {
  try {
    const dotGit = join(cwd, ".git");
    if (!existsSync(dotGit)) return null;
    let dir = dotGit;
    let common = dotGit;
    if (!statSync(dotGit).isDirectory()) {
      const m = /^gitdir:\s*(.+)$/.exec(readFileSync(dotGit, "utf8").trim());
      if (!m) return null;
      dir = resolve(cwd, m[1]);
      const commonFile = join(dir, "commondir");
      common = existsSync(commonFile) ? resolve(dir, readFileSync(commonFile, "utf8").trim()) : dir;
    }
    const head = readFileSync(join(dir, "HEAD"), "utf8").trim();
    const ref = /^ref:\s*(.+)$/.exec(head);
    if (!ref) return /^[0-9a-f]{40}$/.test(head) ? head : null;
    for (const base of [dir, common]) {
      const p = join(base, ref[1]);
      if (existsSync(p)) return readFileSync(p, "utf8").trim();
    }
    const packed = join(common, "packed-refs");
    if (existsSync(packed)) {
      const hit = readFileSync(packed, "utf8").split("\n").find((l) => l.endsWith(" " + ref[1]));
      if (hit) return hit.split(" ")[0];
    }
    return null;
  } catch {
    return null;
  }
}

const RUNBOOK = "docs/runbooks/e2e-suites.md, section 3";

/**
 * Throws unless the server at `baseURL` is this checkout. `expectNodeEnv`
 * lets the pressure suite insist on a production build.
 */
export async function assertServerIsThisCheckout(
  baseURL: string,
  opts: { expectNodeEnv?: "production" | "development"; cwd?: string } = {},
): Promise<ServerIdentity> {
  const cwd = opts.cwd ?? process.cwd();
  const want = { cwd_hash: localCwdHash(cwd), commit: localGitHead(cwd) };
  const url = baseURL.replace(/\/$/, "") + "/api/e2e-identity";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  let res: Response;
  try {
    // A production build answers only with the shared secret; a dev server
    // answers regardless. Both sides read E2E_IDENTITY_SECRET from .env.local.
    const headers: Record<string, string> = { accept: "application/json" };
    const secret = process.env.E2E_IDENTITY_SECRET;
    if (secret) headers["x-e2e-identity"] = secret;
    res = await fetch(url, { signal: ctrl.signal, redirect: "manual", headers });
  } catch (e) {
    throw new Error(`WRONG OR MISSING SERVER: ${url} did not answer (${(e as Error).message}). ${RUNBOOK}`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) {
    const secretNote = process.env.E2E_IDENTITY_SECRET
      ? "E2E_IDENTITY_SECRET is set here; if the server is a production build it must have been started with the same value"
      : "E2E_IDENTITY_SECRET is not set here; a production build answers 404 without it";
    throw new Error(
      `WRONG SERVER on ${baseURL}: /api/e2e-identity answered 404. Either the server is a build older than ` +
        `this checkout, or it is a production build refusing the request (${secretNote}). ` +
        `This checkout is ${want.commit ?? "unknown"} at cwd hash ${want.cwd_hash}. ${RUNBOOK}`,
    );
  }
  if (!res.ok) {
    throw new Error(`WRONG OR BROKEN SERVER on ${baseURL}: /api/e2e-identity answered ${res.status}. ${RUNBOOK}`);
  }
  const got = (await res.json()) as ServerIdentity;
  const problems: string[] = [];
  if (got.cwd_hash !== want.cwd_hash) {
    problems.push(`working directory: server ${got.cwd_hash}, this checkout ${want.cwd_hash}`);
  }
  if (got.commit && want.commit && got.commit !== want.commit) {
    problems.push(`commit: server ${got.commit.slice(0, 12)}, this checkout ${want.commit.slice(0, 12)}`);
  }
  if (opts.expectNodeEnv && got.node_env !== opts.expectNodeEnv) {
    problems.push(`NODE_ENV: server ${got.node_env ?? "unset"}, expected ${opts.expectNodeEnv}`);
  }
  if (problems.length) {
    throw new Error(
      `WRONG SERVER on ${baseURL}: it is not this checkout.\n  ${problems.join("\n  ")}\n` +
        `A server from another worktree or an older build answers this port. Stop it and start one from ` +
        `here, or point E2E_LOCAL_URL / PRESSURE_BASE_URL at the right one. ${RUNBOOK}`,
    );
  }
  return got;
}

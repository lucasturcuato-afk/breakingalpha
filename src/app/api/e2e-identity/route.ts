/**
 * GET /api/e2e-identity: which checkout is answering this port.
 *
 * WHY. On 2026-09-05 the e2e config reused a dev server that another worktree
 * had started three weeks earlier on :3000, and every local e2e run for three
 * weeks tested old code: 60 of 85 failures were that checkout's 404s. The
 * runner now asks the server who it is before running anything
 * (e2e/server-identity.ts) and refuses a mismatch loudly.
 *
 * WHAT IT EXPOSES, and why that is safe on a public route:
 *   cwd_hash  sha256 of the server process's real working directory, first
 *             16 hex chars. A hash of a path names nothing; two checkouts
 *             differ in it, and that is all the runner needs.
 *   commit    the git HEAD the checkout is on, when it can be read cheaply
 *             (VERCEL_GIT_COMMIT_SHA on Vercel, .git/HEAD locally, including
 *             worktrees), else null. Public repository, so the sha is public.
 *   node_env  so a runner expecting a production build can tell a dev server.
 *
 * No auth: the proxy leaves /api/ to its routes, and this one must answer a
 * signed-out runner. No database, no secrets, no environment values beyond
 * the three fields. Never add anything here that identifies a person.
 */
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const dynamic = "force-dynamic";

export function cwdHash(cwd: string): string {
  let real = cwd;
  try {
    real = realpathSync(cwd);
  } catch {
    /* an unreadable cwd hashes as given */
  }
  return createHash("sha256").update(real).digest("hex").slice(0, 16);
}

/** Resolve the git dir for a checkout, following a worktree's `.git` file. */
function gitDir(cwd: string): { dir: string; common: string } | null {
  const dotGit = join(cwd, ".git");
  if (!existsSync(dotGit)) return null;
  if (statSync(dotGit).isDirectory()) return { dir: dotGit, common: dotGit };
  const line = readFileSync(dotGit, "utf8").trim();
  const m = /^gitdir:\s*(.+)$/.exec(line);
  if (!m) return null;
  const dir = resolve(cwd, m[1]);
  const commonFile = join(dir, "commondir");
  const common = existsSync(commonFile) ? resolve(dir, readFileSync(commonFile, "utf8").trim()) : dir;
  return { dir, common };
}

export function gitHead(cwd: string): string | null {
  try {
    const g = gitDir(cwd);
    if (!g) return null;
    const head = readFileSync(join(g.dir, "HEAD"), "utf8").trim();
    const ref = /^ref:\s*(.+)$/.exec(head);
    if (!ref) return /^[0-9a-f]{40}$/.test(head) ? head : null;
    for (const base of [g.dir, g.common]) {
      const p = join(base, ref[1]);
      if (existsSync(p)) return readFileSync(p, "utf8").trim();
    }
    const packed = join(g.common, "packed-refs");
    if (existsSync(packed)) {
      const hit = readFileSync(packed, "utf8")
        .split("\n")
        .find((l) => l.endsWith(" " + ref[1]));
      if (hit) return hit.split(" ")[0];
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET() {
  const cwd = process.cwd();
  return NextResponse.json(
    {
      cwd_hash: cwdHash(cwd),
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? gitHead(cwd),
      node_env: process.env.NODE_ENV ?? null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

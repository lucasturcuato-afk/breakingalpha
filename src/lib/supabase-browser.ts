"use client";

/**
 * On-demand loader for the Supabase browser client.
 *
 * Why this exists. `@supabase/ssr` plus the `@supabase/supabase-js` graph it
 * pulls in is ~58 KB gzipped, and three shell files imported it statically:
 * `app-shell.tsx`, `sidebar.tsx` and `user-avatar.tsx`. A static import puts
 * the whole package in the entry chunk of every AppShell route, so it is
 * downloaded, parsed and compiled before the load event on routes that make
 * no Supabase request at all. `/ledger` and `/compose` are both in that
 * category.
 *
 * Every one of those three call sites uses the client only inside a
 * `useEffect`, and only to resolve auth state that starts out unresolved. So
 * nothing about the first paint depends on the package being present: the
 * signed-out brand mark renders either way, and the signed-in state fills in
 * when the client answers, exactly as it did before. Moving the import behind
 * `import()` takes the bytes off the pre-load critical path and puts them on
 * the path that already had to wait for a network answer.
 *
 * The module promise is memoised here rather than at each call site so the
 * five effects in the sidebar share one fetch.
 *
 * This does NOT change how many clients are constructed. Each caller still
 * gets its own, matching the behaviour before the split. Collapsing them into
 * one shared client is a separate change with its own auth-listener
 * consequences.
 */

type CreateBrowserClient = typeof import("@supabase/ssr").createBrowserClient;

let factoryPromise: Promise<CreateBrowserClient> | null = null;

function loadFactory(): Promise<CreateBrowserClient> {
  if (!factoryPromise) {
    factoryPromise = import("@supabase/ssr").then((m) => m.createBrowserClient);
  }
  return factoryPromise;
}

/** Same arguments the three shell call sites were passing inline. */
export async function createBrowserClientAsync() {
  const createBrowserClient = await loadFactory();
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

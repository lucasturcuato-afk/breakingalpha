import type { User } from "@supabase/supabase-js";

/**
 * One derivation of a reader's initials, for every surface that draws them.
 *
 * It exists because two surfaces derived them differently and could therefore
 * disagree about the same reader. The mobile Ledger's masthead disc read
 * `user_profiles.full_name`; `src/components/shell/user-avatar.tsx` reads the
 * auth record's `user_metadata`. Nothing keeps those two stores in step, so a
 * reader who set a name in one and not the other saw one set of letters on the
 * masthead and a different set in the shell. Saying two surfaces cannot
 * disagree, while they read different columns through different code, is not a
 * guarantee. This is: same record, same function.
 *
 * The algorithm is `user-avatar.tsx`'s, moved here unchanged, so the shell's
 * rendered output is identical before and after the extraction.
 *
 * WHAT IS DELIBERATELY NOT SHARED: what to do when nothing is derivable. This
 * gives back `null` and each caller decides. The shell falls back to a last-resort
 * letter because its avatar is a persistent chrome affordance that must always
 * be visible. The Ledger draws an empty disc instead, because a masthead is not
 * a place to put a letter nothing supports. That difference is a policy, it is
 * stated at both call sites, and it is the only one left.
 */
export function initialsFromUser(user: User | null | undefined): string | null {
  if (!user) return null;

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fullName =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    "";

  const source = fullName || user.email?.split("@")[0] || "";

  const letters = source
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return letters || null;
}

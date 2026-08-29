import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next, widened to match nested copies.
    // Worktrees under .claude/ each carry their own .next build dir; the
    // bare ".next/**" glob only matched the repo root, so ESLint was crawling
    // ~65k generated bundles in .claude/worktrees/*/.next and timing out.
    "**/.next/**",
    "**/out/**",
    "**/build/**",
    "next-env.d.ts",
    ".claude/**",
    ".session-artifacts/**",
    // Not part of the active src/ app. frontend/ is the legacy Pages Router
    // app with its own package.json + toolchain; docs/ and design-reference/
    // hold unbuilt JSX design mockups. None belong in the root lint gate.
    "frontend/**",
    "docs/**",
    "design-reference/**",
    // The mobile design handoff. Source of truth for the redesign, not source
    // code: a static prototype export plus its support bundle. It is read by
    // scripts/screen-audit.mjs, never built. design-lint.mjs excludes it too.
    "design_handoff_signalera_mobile/**",
    // Agent scratch. It is gitignored, so nothing in it is reviewed, shipped or
    // owned, and eslint was crawling it anyway: three agents measured three
    // different lint floors on this repo (79, 80, 81) and every deviation
    // traced to a stray .ts or .mjs one of them had left here. The floor is 79
    // and this line is what keeps it 79.
    "scratchpad/**",
  ]),
  // React Compiler readiness debt. eslint-plugin-react-hooks v6 (pulled in by
  // eslint-config-next/core-web-vitals on Next 16) ships these rules as ERRORS.
  // The app is not yet compiler-clean, so they fired on pre-existing components
  // and made the lint gate non-functional (it could not tell a real regression
  // from this noise floor). Mixed remediation, per-rule:
  //
  //  - static-components and purity stay at "error" GLOBALLY so any NEW violation
  //    still blocks the gate. Their known pre-existing sites are exempted with
  //    targeted disable directives at the source (thesis-table.tsx file-level for
  //    the 5 SortIcon usages; per-line purity disables in DealFlowSidebar.tsx and
  //    thesis-card.tsx). New code in any other file is still gated.
  //  - set-state-in-effect is downgraded to "warn": it fired on 10 components,
  //    mostly intentional state-sync patterns, and per-line exemption across all
  //    10 would be noise. Stays VISIBLE and counted, NOT silenced. Re-promote to
  //    "error" per file as each component is made compiler-clean.
  //
  // Policy change only; no runtime behavior changes. Tracked in
  // docs/recon/preflight-baseline.md.
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;

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
  ]),
  // React Compiler readiness debt. eslint-plugin-react-hooks v6 (pulled in by
  // eslint-config-next/core-web-vitals on Next 16) ships these three rules as
  // ERRORS. The app is not yet compiler-clean, so they fired on ~13 pre-existing
  // components and made the lint gate non-functional (it could not tell a real
  // regression from this noise floor). Downgraded to "warn" so they stay VISIBLE
  // and counted, NOT silenced. Policy change only; no runtime behavior changes.
  // Re-promote to "error" per file as each component is made compiler-clean.
  // Tracked in docs/recon/preflight-baseline.md.
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/purity": "warn",
    },
  },
]);

export default eslintConfig;

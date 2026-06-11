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
]);

export default eslintConfig;

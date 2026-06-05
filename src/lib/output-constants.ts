/** Version strings for prompt/model tracking. Bump when prompts change materially. */
// WD127 (2026-05-26): coverage-balance rule + isStrictDevelopment Earnings/M&A
// null-primary fallback. Bumped so substrate rows generated under the new
// prompt are version-distinguishable for grading and downstream analysis.
// Voice register (2026-06-04): institutional-register guardrail added to both
// memo prompts (buildMemoSystemPrompt + buildWebFallbackMemoSystemPrompt) and
// the thesis route prompt; bumped so new rows are version-distinguishable.
// Signal label separator (2026-06-05): buildSignalLabel em-dash replaced with
// a plain hyphen so the verbatim Signal Quality reproduction cannot leak an
// em-dash into memo output (see PR #323 validation side-finding).
export const MEMO_PROMPT_VERSION = 'memo_v1.3';
export const CHAT_PROMPT_VERSION = 'chat_v1.0';
export const THESIS_FRONTEND_PROMPT_VERSION = 'thesis_frontend_v1.1';

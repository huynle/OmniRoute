type JsonRecord = Record<string, unknown>;

// Models that reject `thinking.type:"adaptive"` and `output_config.effort` —
// Claude Haiku generations before 5 (4.5 / 3.5 / 3, dated and aliased). Adaptive
// thinking + the effort knob landed on Sonnet 4.6 / Opus 4.5+ only; sending
// either on those Haiku models is a hard 400 from the Messages API. Haiku 5.x is
// the opposite: it is adaptive-only and rejects `thinking.type:"enabled"`
// ("Use thinking.type.adaptive and output_config.effort"), so it must be left alone.
const HAIKU_CONSTRAINT_PATTERN = /haiku/i;
const FIRST_ADAPTIVE_HAIKU_MAJOR = 5;

// "claude-haiku-5-5", "anthropic.claude-haiku-4-5-…" → 5 / 4;
// legacy "claude-3-5-haiku-…", "claude-3-haiku-…" → 3. Unknown shape → null.
function haikuMajorVersion(modelId: string): number | null {
  const legacy = /claude-(\d+)(?:[-.]\d+)?-haiku/i.exec(modelId);
  if (legacy) return Number(legacy[1]);
  // 1–2 digit major only, so a date suffix ("haiku-20241022") is never read as a version.
  const modern = /haiku[-.](\d{1,2})(?!\d)/i.exec(modelId);
  return modern ? Number(modern[1]) : null;
}

// Default budget when collapsing `thinking.type:"adaptive"` to a manual shape
// on Haiku. Mirrors the upstream 9router decision (`claude.js`, commit
// 401d93bd5) — a conservative ~10K budget keeps reasoning enabled without
// hitting Haiku's output-token cap.
const HAIKU_FALLBACK_THINKING_BUDGET = 10000;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function modelRejectsAdaptiveAndEffort(modelId: string | null | undefined): boolean {
  if (typeof modelId !== "string" || modelId.length === 0) return false;
  if (!HAIKU_CONSTRAINT_PATTERN.test(modelId)) return false;
  const major = haikuMajorVersion(modelId);
  return major === null || major < FIRST_ADAPTIVE_HAIKU_MAJOR;
}

/**
 * Strip Claude-API params that Haiku-tier models reject.
 *
 * Anthropic restricts two extended-reasoning knobs to Sonnet 4.6 / Opus 4.5+:
 *   1. `thinking.type:"adaptive"` — Haiku only accepts manual `"enabled"` (with a
 *      `budget_tokens`) or `"disabled"`.
 *   2. `output_config.effort` — only the larger models steer reasoning via effort.
 * Sending either of these to Haiku is a hard `400` from the Messages API.
 *
 * Multiple OmniRoute paths can still emit those shapes on a Haiku target:
 *   - native Claude passthrough from newer Claude Code / Cowork clients;
 *   - the OpenAI→Claude translator when `reasoning_effort` is `max`/`xhigh`
 *     (see `request/openai-to-claude.ts`) — Haiku isn't `adaptiveThinkingOnly`,
 *     so it falls into the branch that emits `{type:"adaptive"}` + `effort`;
 *   - per-model thinking defaults from the request flow / combo routing.
 *
 * This normalizer is the final, provider-agnostic guard keyed on the resolved
 * upstream model. It runs after model substitution in `chatCore.ts`, so it
 * covers every routing mode (single-model, combo, fallback).
 *
 * Returns a NEW object only when it changes the body. No-op for non-Haiku
 * models, for Haiku 5+ (adaptive-only, see above), when the body carries no thinking/output_config, or when neither
 * `thinking.type:"adaptive"` nor `output_config.effort` is present — so the
 * existing Sonnet/Opus paths and Haiku bodies without these fields are
 * unaffected.
 *
 * Mirrors upstream 9router commit 401d93bd5 (`open-sse/translator/formats/claude.js`).
 */
export function normalizeClaudeHaikuConstraints<T extends Record<string, unknown>>(
  body: T,
  model: string | null | undefined
): T {
  if (!modelRejectsAdaptiveAndEffort(model)) return body;
  const record = asRecord(body);
  if (!record) return body;

  const thinking = asRecord(record.thinking);
  const outputConfig = asRecord(record.output_config);

  const needsThinkingRewrite = thinking?.type === "adaptive";
  const needsEffortStrip = outputConfig != null && outputConfig.effort != null;
  if (!needsThinkingRewrite && !needsEffortStrip) return body;

  const next: JsonRecord = { ...record };

  if (needsThinkingRewrite && thinking) {
    next.thinking = {
      ...thinking,
      type: "enabled",
      budget_tokens: HAIKU_FALLBACK_THINKING_BUDGET,
    };
  }

  if (needsEffortStrip && outputConfig) {
    const nextOutputConfig: JsonRecord = { ...outputConfig };
    delete nextOutputConfig.effort;
    if (Object.keys(nextOutputConfig).length === 0) {
      delete next.output_config;
    } else {
      next.output_config = nextOutputConfig;
    }
  }

  return next as T;
}

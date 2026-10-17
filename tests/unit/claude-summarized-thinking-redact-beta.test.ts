// A client that explicitly asks for readable thinking (`thinking.display:
// "summarized"`, e.g. @ai-sdk/anthropic / OpenCode) must not have every thinking
// block blanked by the `redact-thinking-2026-02-12` beta that OmniRoute adds on
// its own (selectBetaFlags for opaque / interleaved-thinking clients, and the
// static API-key beta set). OMNIROUTE_REDACT_THINKING=false disables the
// OmniRoute-added redact beta globally. A client that negotiated the redact beta
// itself keeps it.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-redact-thinking-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const { DefaultExecutor } = await import("../../open-sse/executors/default.ts");
const { selectBetaFlags } = await import("../../open-sse/executors/claudeIdentity.ts");
const {
  isRedactThinkingDisabledByEnv,
  requestsSummarizedThinking,
  shouldSuppressRedactThinking,
  stripRedactThinkingBetaForVisibleThinking,
} = await import("../../open-sse/executors/base/redactThinkingBeta.ts");

const REDACT = "redact-thinking-2026-02-12";
const INTERLEAVED = "interleaved-thinking-2025-05-14";
const originalFetch = globalThis.fetch;
const originalEnv = process.env.OMNIROUTE_REDACT_THINKING;

test.after(() => {
  globalThis.fetch = originalFetch;
  if (originalEnv === undefined) delete process.env.OMNIROUTE_REDACT_THINKING;
  else process.env.OMNIROUTE_REDACT_THINKING = originalEnv;
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

function body(thinking?: Record<string, unknown>) {
  return {
    model: "claude-haiku-4-5",
    max_tokens: 64,
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    ...(thinking ? { thinking } : {}),
  };
}

const SUMMARIZED = { type: "adaptive", display: "summarized" };

test("requestsSummarizedThinking only matches an explicit summarized display", () => {
  assert.equal(requestsSummarizedThinking(body(SUMMARIZED)), true);
  assert.equal(requestsSummarizedThinking(body({ type: "adaptive" })), false);
  assert.equal(requestsSummarizedThinking(body({ type: "adaptive", display: "omitted" })), false);
  assert.equal(requestsSummarizedThinking(body()), false);
  assert.equal(requestsSummarizedThinking(null), false);
});

test("OMNIROUTE_REDACT_THINKING=false disables the OmniRoute-added redact beta", () => {
  assert.equal(isRedactThinkingDisabledByEnv({ OMNIROUTE_REDACT_THINKING: "false" }), true);
  assert.equal(isRedactThinkingDisabledByEnv({ OMNIROUTE_REDACT_THINKING: "0" }), true);
  assert.equal(isRedactThinkingDisabledByEnv({ OMNIROUTE_REDACT_THINKING: "true" }), false);
  assert.equal(isRedactThinkingDisabledByEnv({}), false);
  assert.equal(
    shouldSuppressRedactThinking(body(), null, { OMNIROUTE_REDACT_THINKING: "off" }),
    true
  );
});

test("client-negotiated redact beta always wins", () => {
  assert.equal(
    shouldSuppressRedactThinking(body(SUMMARIZED), `${INTERLEAVED},${REDACT}`, {}),
    false
  );
});

test("selectBetaFlags keeps redact-thinking by default (opaque and interleaved clients)", () => {
  assert.ok(
    selectBetaFlags(body({ type: "adaptive" }))
      .split(",")
      .includes(REDACT)
  );
  assert.ok(
    selectBetaFlags(body({ type: "adaptive" }), null, INTERLEAVED)
      .split(",")
      .includes(REDACT)
  );
});

test("selectBetaFlags omits redact-thinking when the client asks for summarized thinking", () => {
  for (const clientBeta of [null, INTERLEAVED]) {
    const flags = selectBetaFlags(body(SUMMARIZED), null, clientBeta).split(",");
    assert.ok(!flags.includes(REDACT), `clientBeta=${clientBeta}`);
    assert.ok(flags.includes(INTERLEAVED));
    assert.ok(flags.includes("thinking-token-count-2026-05-13"));
  }
});

test("strip helper removes redact-thinking from the static API-key beta header", () => {
  const headers = {
    "Anthropic-Beta": `claude-code-20250219,${INTERLEAVED},${REDACT},effort-2025-11-24`,
  };
  assert.equal(
    stripRedactThinkingBetaForVisibleThinking(headers, body(SUMMARIZED), null, { env: {} }),
    true
  );
  assert.equal(headers["Anthropic-Beta"], `claude-code-20250219,${INTERLEAVED},effort-2025-11-24`);

  const untouched = { "anthropic-beta": `${INTERLEAVED},${REDACT}` };
  assert.equal(
    stripRedactThinkingBetaForVisibleThinking(untouched, body({ type: "adaptive" }), null, {
      env: {},
    }),
    false
  );
  assert.equal(untouched["anthropic-beta"], `${INTERLEAVED},${REDACT}`);

  const optedIn = { "anthropic-beta": `${INTERLEAVED},${REDACT}` };
  assert.equal(
    stripRedactThinkingBetaForVisibleThinking(optedIn, body(SUMMARIZED), null, {
      connectionOptedIn: true,
      env: {},
    }),
    false
  );
  assert.equal(optedIn["anthropic-beta"], `${INTERLEAVED},${REDACT}`);
});

function captureFetchHeaders(): Array<Record<string, string>> {
  const captured: Array<Record<string, string>> = [];
  globalThis.fetch = (async (url: unknown, init: { headers?: Record<string, string> } = {}) => {
    if (String(url).includes("/v1/messages")) captured.push({ ...(init.headers || {}) });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return captured;
}

function betaOf(headers: Record<string, string>): string[] {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === "anthropic-beta");
  return key ? headers[key].split(",").map((v) => v.trim()) : [];
}

async function dispatch(
  provider: string,
  credentials: Record<string, unknown>,
  reqBody: Record<string, unknown>
) {
  const captured = captureFetchHeaders();
  await new DefaultExecutor(provider).execute({
    model: "claude-haiku-4-5",
    body: reqBody,
    stream: false,
    credentials,
    clientHeaders: { "anthropic-beta": INTERLEAVED, "user-agent": "ai-sdk/anthropic" },
  });
  assert.equal(captured.length, 1);
  return betaOf(captured[0]);
}

test("claude OAuth dispatch: summarized thinking drops redact beta, default keeps it", async () => {
  delete process.env.OMNIROUTE_REDACT_THINKING;
  const creds = { accessToken: "sk-ant-oat-test-token" };
  assert.ok((await dispatch("claude", creds, body({ type: "adaptive" }))).includes(REDACT));
  const summarized = await dispatch("claude", creds, body(SUMMARIZED));
  assert.ok(!summarized.includes(REDACT));
  assert.ok(summarized.includes(INTERLEAVED));
});

test("anthropic API-key dispatch: summarized thinking drops the static redact beta", async () => {
  delete process.env.OMNIROUTE_REDACT_THINKING;
  const creds = { apiKey: "sk-ant-api-test" };
  assert.ok((await dispatch("anthropic", creds, body({ type: "adaptive" }))).includes(REDACT));
  assert.ok(!(await dispatch("anthropic", creds, body(SUMMARIZED))).includes(REDACT));
});

test("OMNIROUTE_REDACT_THINKING=false drops redact beta at dispatch", async () => {
  process.env.OMNIROUTE_REDACT_THINKING = "false";
  try {
    const creds = { accessToken: "sk-ant-oat-test-token" };
    assert.ok(!(await dispatch("claude", creds, body({ type: "adaptive" }))).includes(REDACT));
  } finally {
    delete process.env.OMNIROUTE_REDACT_THINKING;
  }
});

import test from "node:test";
import assert from "node:assert/strict";

import { kimi_codingProvider } from "../../open-sse/config/providers/registry/kimi/coding/index.ts";
import {
  KIMI_CODING_ANTHROPIC_URL,
  KIMI_CODING_BASE_URL,
  KIMI_CODING_MODELS_URL,
  KIMI_CODING_OPENAI_URL,
} from "../../open-sse/config/providers/registry/kimi/coding/runtime.ts";
import { getExtractionConfig } from "../../open-sse/services/tokenExtractionConfig.ts";
import { isKimiCodingBaseUrl } from "../../open-sse/services/usage/moonshotOpenPlatform.ts";
import { KIMI_CODING_CONFIG } from "../../src/lib/oauth/constants/oauth.ts";
import { PROVIDER_ENDPOINTS } from "../../src/shared/constants/config.ts";
import { WEB_SESSION_CREDENTIAL_REQUIREMENTS } from "../../src/shared/providers/webSessionCredentials.ts";
import { KIMI_CODE_ADDITIONAL_CREDITS_URL } from "../../src/shared/utils/kimiBilling.ts";

test("Kimi Code uses the global kimi.ai OAuth and API endpoints", () => {
  assert.equal(KIMI_CODING_BASE_URL, "https://api.kimi.ai/coding/v1");
  assert.equal(KIMI_CODING_MODELS_URL, "https://api.kimi.ai/coding/v1/models");
  assert.equal(KIMI_CODING_OPENAI_URL, "https://api.kimi.ai/coding/v1/chat/completions");
  assert.equal(KIMI_CODING_ANTHROPIC_URL, "https://api.kimi.ai/coding/v1/messages?beta=true");
  assert.equal(PROVIDER_ENDPOINTS["kimi-coding"], "https://api.kimi.ai/coding/v1/messages");
  assert.equal(PROVIDER_ENDPOINTS["kimi-coding-apikey"], "https://api.kimi.ai/coding/v1/messages");
  assert.equal(isKimiCodingBaseUrl(KIMI_CODING_BASE_URL), true);
});

test("Kimi Code device OAuth uses the global auth.kimi.ai host everywhere", () => {
  const tokenUrl = "https://auth.kimi.ai/api/oauth/token";
  const deviceCodeUrl = "https://auth.kimi.ai/api/oauth/device_authorization";

  assert.equal(KIMI_CODING_CONFIG.tokenUrl, tokenUrl);
  assert.equal(KIMI_CODING_CONFIG.deviceCodeUrl, deviceCodeUrl);
  assert.equal(kimi_codingProvider.oauth?.tokenUrl, tokenUrl);
  assert.equal(kimi_codingProvider.oauth?.refreshUrl, tokenUrl);
  assert.equal(kimi_codingProvider.oauth?.authUrl, deviceCodeUrl);
});

test("Kimi account links and web-session extraction use kimi.ai", () => {
  assert.equal(
    KIMI_CODE_ADDITIONAL_CREDITS_URL,
    "https://www.kimi.ai/membership/subscription?tab=quota&aff=omniroute"
  );

  const web = getExtractionConfig("kimi-web");
  assert.ok(web);
  assert.equal(web.loginUrl, "https://www.kimi.ai/");
  assert.equal(web.homeUrl, "https://www.kimi.ai");
  assert.equal(web.cookieDomain, ".kimi.ai");
  assert.deepEqual(web.tokenSources, [
    { type: "localStorage", key: "access_token" },
    { type: "cookie", name: "kimi-auth", domain: ".kimi.ai" },
  ]);
  assert.equal(
    WEB_SESSION_CREDENTIAL_REQUIREMENTS["kimi-web"].placeholder,
    "access_token from www.kimi.ai localStorage"
  );
});

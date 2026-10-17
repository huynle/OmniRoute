// Visible-thinking guard for the `redact-thinking-*` Anthropic beta.
//
// OmniRoute adds `redact-thinking-2026-02-12` for opaque Claude clients and for
// clients that negotiated `interleaved-thinking-2025-05-14` (selectBetaFlags),
// and the static API-key beta set includes it too. With that beta active,
// Anthropic returns thinking blocks with an empty `thinking` string (signature
// only), which silently overrides a client that explicitly asked for readable
// thinking via `thinking.display: "summarized"`.
//
// Rule: the redact beta is dropped when the request body asks for summarized
// thinking, or when the operator sets OMNIROUTE_REDACT_THINKING=false — unless
// the client itself negotiated a redact-thinking beta in its own anthropic-beta
// (or a CC-compatible connection explicitly opted in via requestDefaults).

export const REDACT_THINKING_BETA_PREFIX = "redact-thinking-";

type EnvLike = Record<string, string | undefined>;

function isRedactThinkingToken(token: string): boolean {
  return token.trim().toLowerCase().startsWith(REDACT_THINKING_BETA_PREFIX);
}

export function isRedactThinkingDisabledByEnv(env: EnvLike = process.env): boolean {
  const raw = env.OMNIROUTE_REDACT_THINKING;
  if (typeof raw !== "string") return false;
  return ["false", "0", "off", "no"].includes(raw.trim().toLowerCase());
}

export function requestsSummarizedThinking(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const thinking = (body as Record<string, unknown>).thinking;
  if (!thinking || typeof thinking !== "object") return false;
  const display = (thinking as Record<string, unknown>).display;
  return typeof display === "string" && display.trim().toLowerCase() === "summarized";
}

export function clientNegotiatedRedactThinking(clientBeta: string | null | undefined): boolean {
  if (typeof clientBeta !== "string") return false;
  return clientBeta.split(",").some(isRedactThinkingToken);
}

/** True when OmniRoute must not add/keep a redact-thinking beta on its own. */
export function shouldSuppressRedactThinking(
  body: unknown,
  clientBeta?: string | null,
  env: EnvLike = process.env
): boolean {
  if (clientNegotiatedRedactThinking(clientBeta)) return false;
  return requestsSummarizedThinking(body) || isRedactThinkingDisabledByEnv(env);
}

/**
 * Remove `redact-thinking-*` tokens from the outbound anthropic-beta header
 * (any casing) when shouldSuppressRedactThinking() holds and the connection did
 * not explicitly opt into redact-thinking. Returns true when the header changed.
 */
export function stripRedactThinkingBetaForVisibleThinking(
  headers: Record<string, string>,
  body: unknown,
  clientHeaders?: Record<string, string> | null,
  options: { connectionOptedIn?: boolean; env?: EnvLike } = {}
): boolean {
  if (options.connectionOptedIn === true) return false;
  const env = options.env ?? process.env;
  const clientBeta = clientHeaders
    ? (Object.entries(clientHeaders).find(([key]) => key.toLowerCase() === "anthropic-beta")?.[1] ??
      null)
    : null;
  if (!shouldSuppressRedactThinking(body, clientBeta, env)) return false;

  let changed = false;
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== "anthropic-beta" || typeof headers[key] !== "string") continue;
    const tokens = headers[key]
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const kept = tokens.filter((value) => !isRedactThinkingToken(value));
    if (kept.length !== tokens.length) {
      headers[key] = kept.join(",");
      changed = true;
    }
  }
  return changed;
}

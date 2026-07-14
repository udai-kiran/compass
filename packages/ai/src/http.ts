import { AiUnavailableError } from "./types.ts";

/** POST JSON with a hard timeout; retries transient failures with backoff.
 * Any exhausted failure surfaces as {@link AiUnavailableError} so callers can
 * degrade gracefully rather than 500. */
export async function postJson(
  url: string,
  body: unknown,
  opts: { headers?: Record<string, string>; timeoutMs?: number; retries?: number } = {},
): Promise<unknown> {
  const { headers = {}, timeoutMs = 30_000, retries = 2 } = opts;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.status === 429 || res.status >= 500) {
        // transient — retry
        lastErr = new AiUnavailableError(`Upstream ${res.status}`);
      } else if (!res.ok) {
        // permanent (4xx, e.g. bad API key) — do not retry, don't leak the body
        throw new AiUnavailableError(`AI provider rejected the request (${res.status})`);
      } else {
        return await res.json();
      }
    } catch (err) {
      lastErr = err;
      // 4xx is a permanent config error (bad key etc.) — surface it, don't retry.
      if (err instanceof AiUnavailableError && /\(4\d\d\)/.test(err.message)) throw err;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await sleep(250 * 2 ** attempt);
  }
  // Normalise every exhausted failure (network error, timeout, 5xx) to
  // AiUnavailableError with a user-safe message — the upstream detail is not
  // leaked to the client (it only reaches server logs via the thrown stack).
  if (lastErr instanceof AiUnavailableError) throw lastErr;
  throw new AiUnavailableError();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Pull the first fenced or bare JSON value out of a model's text response.
 * Returns `undefined` when nothing parseable is found (caller discards). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.search(/[[{]/);
  if (start === -1) return undefined;
  // Walk to the matching closing bracket to tolerate trailing prose.
  const open = candidate[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === open) depth++;
    else if (candidate[i] === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

import { AiUnavailableError, type AiObserver } from "./types.ts";

function stringifyBody(body: unknown): string {
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

/**
 * Parse a provider's response body, tolerating keep-alive padding. Some providers
 * (notably OpenRouter, for slow reasoning models) prepend the JSON with blank
 * lines and `: OPENROUTER PROCESSING` SSE comments to hold the connection open.
 * Plain whitespace is fine for `JSON.parse`, but a leading `:` comment is not —
 * so on failure we skip to the first JSON value. Returns a discriminated result
 * (never a sentinel) so a legitimate `null`/`false` body isn't mistaken for a
 * parse failure.
 */
function parseResponseBody(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    const extracted = extractJson(text);
    return extracted === undefined ? { ok: false } : { ok: true, value: extracted };
  }
}

/**
 * Report one model round-trip to the observer. Fired exactly once per
 * {@link postJson} call (not per retry). Never throws.
 *
 * Callers invoke this fire-and-forget (`void report(...)`) — the event-log write
 * runs in the background so a slow or failing observer can never add latency to,
 * or break, the model call it describes. That matters most for the streaming
 * assistant, which makes several model calls per answer. The outcome (latency,
 * ok/error, raw response) is captured at call time and passed in, so the logged
 * event is still accurate even though persistence is deferred.
 */
async function report(
  observe: AiObserver | undefined,
  request: string,
  startedAt: number,
  outcome: { response: string; ok: boolean; error?: string },
): Promise<void> {
  if (!observe) return;
  try {
    await observe({ request, latencyMs: Date.now() - startedAt, ...outcome });
  } catch {
    // swallow — the AI event log is best-effort
  }
}

/** POST JSON with a hard timeout; retries transient failures with backoff.
 * Any exhausted failure surfaces as {@link AiUnavailableError} so callers can
 * degrade gracefully rather than 500. When `observe` is set, the exact request
 * body and raw response are reported once for the AI event log. */
export async function postJson(
  url: string,
  body: unknown,
  opts: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    retries?: number;
    observe?: AiObserver;
  } = {},
): Promise<unknown> {
  const { headers = {}, timeoutMs = 30_000, retries = 2, observe } = opts;
  const startedAt = Date.now();
  const request = stringifyBody(body);
  let lastErr: unknown;
  // Raw body of the last attempt that got an HTTP response — carried into the
  // final error observation so an unparseable/empty reply is still visible.
  let lastResponse = "";

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
        // transient — capture the body for the event log, then retry
        lastResponse = await res.text().catch(() => "");
        lastErr = new AiUnavailableError(`Upstream ${res.status}`);
      } else if (!res.ok) {
        // permanent (4xx, e.g. bad API key) — do not retry. Keep the raw body for
        // the event log; the thrown message stays generic so it never leaks to
        // the client.
        lastResponse = await res.text().catch(() => "");
        throw new AiUnavailableError(`AI provider rejected the request (${res.status})`);
      } else {
        // Read the raw text, then parse — only a successfully parsed response is
        // a real success. A 200 with an unparseable body is unusable, so treat it
        // like a transient failure and retry (never emit a premature ok event).
        const text = await res.text();
        lastResponse = text;
        const parsed = parseResponseBody(text);
        if (parsed.ok) {
          void report(observe, request, startedAt, { response: text, ok: true });
          return parsed.value;
        }
        lastErr = new AiUnavailableError("AI response was not valid JSON");
      }
    } catch (err) {
      lastErr = err;
      // 4xx is a permanent config error (bad key etc.) — surface it, don't retry.
      if (err instanceof AiUnavailableError && /\(4\d\d\)/.test(err.message)) {
        void report(observe, request, startedAt, { response: lastResponse, ok: false, error: err.message });
        throw err;
      }
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await sleep(250 * 2 ** attempt);
  }
  // Normalise every exhausted failure (network error, timeout, 5xx, unparseable
  // body) to AiUnavailableError with a user-safe message — the upstream detail is
  // not leaked to the client (it only reaches server logs via the thrown stack).
  const finalErr = lastErr instanceof AiUnavailableError ? lastErr : new AiUnavailableError();
  void report(observe, request, startedAt, { response: lastResponse, ok: false, error: finalErr.message });
  throw finalErr;
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

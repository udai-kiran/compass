import { AiUnavailableError, base64ByteLength, type AiObserver } from "./types.ts";

/** Placeholder written to the AI event log in place of image bytes. */
function imagePlaceholder(mediaType: string, bytes: number): string {
  return `[image omitted: ${mediaType}, ${bytes} bytes]`;
}

/** Case-insensitive: data-URI schemes and media types are, and a `DATA:` variant
 *  would otherwise skip redaction AND leave `hadImage` false. */
const DATA_URI_RE = /^data:([^;,]+);base64,([\s\S]*)$/i;

/** Threaded through {@link redactImages} so one walk both redacts the body and
 *  reports whether it carried an image. A separate predicate would be a second
 *  source of truth, free to drift from the redactor. */
interface RedactionState {
  hadImage: boolean;
}

/**
 * Copy a plain-JSON `value`, replacing every provider image payload with a short
 * placeholder. Only ever called on the output of a `JSON.parse(JSON.stringify(…))`
 * round-trip, so every input is a plain object, array or primitive.
 * Applied ONLY to the string handed to the observer — the body actually POSTed is
 * serialized separately from the untouched original — so `ai_events` records
 * that an image was sent, plus its type and size, without storing megabytes of
 * base64 (which `recordAiEvent` would only truncate into noise anyway).
 */
function redactImages(value: unknown, state: RedactionState): unknown {
  if (Array.isArray(value)) return value.map((v) => redactImages(v, state));
  if (value === null || typeof value !== "object") return value;

  // Walk every property FIRST, then apply this node's own image redaction to the
  // result. Redacting first and returning early would copy the node's other keys
  // verbatim, so a second image sitting in a sibling property would survive.
  const walked: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    walked[k] = redactImages(v, state);
  }

  // Anthropic: { type: "image", source: { type: "base64", media_type, data } }
  if (walked.type === "image" && walked.source !== null && typeof walked.source === "object") {
    const source = walked.source as Record<string, unknown>;
    if (typeof source.data === "string") {
      const mediaType = typeof source.media_type === "string" ? source.media_type : "unknown";
      state.hadImage = true;
      return {
        ...walked,
        source: { ...source, data: imagePlaceholder(mediaType, base64ByteLength(source.data)) },
      };
    }
  }

  // OpenAI-compatible: { type: "image_url", image_url: { url: "data:<type>;base64,<data>" } }
  // A non-data URL carries no bytes, so it is left intact.
  if (walked.type === "image_url" && walked.image_url !== null && typeof walked.image_url === "object") {
    const imageUrl = walked.image_url as Record<string, unknown>;
    if (typeof imageUrl.url === "string") {
      const match = DATA_URI_RE.exec(imageUrl.url);
      if (match) {
        state.hadImage = true;
        return {
          ...walked,
          image_url: {
            ...imageUrl,
            url: imagePlaceholder(match[1]!.toLowerCase(), base64ByteLength(match[2]!)),
          },
        };
      }
    }
  }

  return walked;
}

/**
 * Replace IMAGE data-URI payloads echoed back by a provider. Some endpoints
 * include the submitted body in an error reply, which would otherwise store
 * megabytes of base64 in `ai_events.response_raw`. Everything else in the reply
 * is preserved verbatim — that field is the provider's raw response and its
 * debugging value depends on being unaltered — so only `data:image/...;base64,`
 * payloads are touched, and `data:text/plain`, `data:application/pdf` and the
 * like are deliberately left alone.
 *
 * Two properties are load-bearing:
 *  - The character classes are FLAT. An alternation such as
 *    `(?:[A-Za-z0-9+=]|\\/|\\u002[fF])+` blows the regex stack on a
 *    multi-megabyte payload, and because this runs inside `report`'s try/catch
 *    the resulting RangeError would be swallowed and the audit record lost.
 *  - The classes include `\` so a JSON-escaped separator (`image\/png`) or
 *    payload character (`AAA\/AAAA`, `AAA\u002fAAAA`) is consumed rather than
 *    cutting the match short and leaving image bytes behind. Some providers
 *    escape `/` in JSON strings; PHP's `json_encode` does so by default. The
 *    separator class after `image` is what keeps this image-only: without it,
 *    a media type merely beginning with "image" (`imagefoo/png`) would be
 *    rewritten too.
 *  - The `data:`, `;` and `,` delimiters may each arrive JSON-escaped (`\u003a`,
 *    `\u003b`, `\u002c`), so each accepts both forms. These are fixed-length
 *    one-off alternations, not quantified ones, so they add no backtracking risk.
 *
 * Bare base64 is only redacted where the surrounding JSON structure identifies it
 * as an image (Anthropic's `source.data`); loose base64 in prose is indistinguishable
 * from ordinary text and is deliberately not touched. When the reply is JSON and
 * mentions base64 at all it is re-serialized, so its values survive but its
 * formatting is normalized and an own `__proto__` key would be dropped — an
 * acceptable trade for not storing megabytes.
 */
/** Cheap case-insensitive pre-filter for the response redactor. Not `/g` — a
 *  global regex would carry `lastIndex` between `.test()` calls. */
const BASE64_HINT_RE = /base64/i;
const RESPONSE_IMAGE_DATA_URI_RE =
  /data(?::|\\u003[aA])(image[\\/][\w.+\\/-]*)(?:;|\\u003[bB])base64(?:,|\\u002[cC])([A-Za-z0-9+/=\\]+)/gi;

/** Collapse JSON escape forms of `/` so the placeholder reports a clean media
 *  type and an accurate byte count. */
function unescapeSlashes(value: string): string {
  return value.replace(/\\u002[fF]/g, "/").replace(/\\\//g, "/");
}

/** Scan one string for `data:image/...;base64,...` payloads. */
function redactDataUriImages(text: string): string {
  return text.replace(RESPONSE_IMAGE_DATA_URI_RE, (_match, mediaType: string, data: string) =>
    imagePlaceholder(unescapeSlashes(mediaType).toLowerCase(), base64ByteLength(unescapeSlashes(data))),
  );
}

/** Apply the data-URI scan to every string inside an already-parsed JSON value. */
function redactStringValues(value: unknown): unknown {
  if (typeof value === "string") return redactDataUriImages(value);
  if (Array.isArray(value)) return value.map(redactStringValues);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = redactStringValues(v);
  }
  return out;
}

function redactResponseImages(text: string): string {
  // Fast path. Every provider image shape contains the literal `base64` —
  // Anthropic's block as `"type":"base64"`, OpenAI's inside its data URI — so an
  // ordinary reply never pays for what follows. A JSON reply may unicode-escape
  // characters of that marker, so a `\u00` escape also opens the gate; the parse
  // below then resolves every escape.
  // `/base64/i` rather than `.toLowerCase().includes(...)`: the latter would
  // allocate a full lowercase copy of every response, and these can be megabytes.
  if (!BASE64_HINT_RE.test(text) && !text.includes("\\u00")) return text;

  // Use the SAME notion of "is this JSON" as the parser that accepted this body.
  // `postJson` tolerates OpenRouter keep-alive padding via `extractJson`, so a bare
  // `JSON.parse` here would reject a body the client already treated as a valid
  // response and fall back to a text scan that an escaped marker defeats. Note the
  // padding itself is dropped from the logged copy, which is noise anyway.
  const parsed = parseResponseBody(text);
  if (!parsed.ok) {
    // Genuinely not JSON — a plain-text upstream error, say. Scan it for data URIs;
    // there is no structure to inspect.
    return redactDataUriImages(text);
  }

  try {
    // Two passes. `redactImages` catches both providers' NATIVE shapes, including
    // Anthropic's bare base64 at `source.data`, which no text scan could tell
    // apart from prose. `redactStringValues` then catches data URIs, with every
    // JSON escape already resolved by the parse — which is why this is a parse
    // rather than an ever-growing set of escape cases in the regex.
    // The response path ignores the flag; only the request decides suppression.
    return JSON.stringify(redactStringValues(redactImages(parsed.value, { hadImage: false })));
  } catch {
    // The body parsed but could not be walked or re-serialized — in practice
    // nesting deep enough to exhaust the stack (about 5,000 levels). We cannot
    // prove it carries no image, and the text scan cannot see bare base64, so the
    // body is dropped rather than logged raw.
    //
    // Deliberately NO hint regex here: any raw-text check for an image marker is
    // itself defeated by escaping the token it searches for (`"base64"`
    // is valid JSON for `"base64"`). So this fails closed on ANY walk failure. A
    // reply nested that deeply loses its audit body even if it held no image —
    // an acceptable trade on a path that should never occur.
    return "[response omitted: image payload could not be redacted]";
  }
}

/**
 * The request as recorded for the AI event log. Serializing BEFORE redacting is
 * deliberate and load-bearing: `JSON.stringify` applies `toJSON()` and getters,
 * so a `Date` still becomes an ISO string, and parsing back leaves only plain
 * JSON values — so no object can smuggle image bytes past `redactImages` behind
 * a custom `toJSON`. Never falls back to `String(body)`: a hostile or broken
 * `toString()` would throw out of here, and this is called on the model-call
 * path, so the audit log would break the request it merely describes.
 * Also reports whether the body carried an image, so the caller can suppress the
 * raw response for that call.
 */
function stringifyBody(body: unknown): { text: string; hadImage: boolean } {
  const state: RedactionState = { hadImage: false };
  try {
    const plain = JSON.parse(JSON.stringify(body)) as unknown;
    return { text: JSON.stringify(redactImages(plain, state), null, 2), hadImage: state.hadImage };
  } catch {
    // The body could not be serialized, so we cannot prove it carried no image.
    // Report `hadImage` so the response is omitted too — the same fail-closed
    // direction taken everywhere else on this path.
    return { text: "[unserializable request body]", hadImage: true };
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

/** Content-free stand-in for a response the audit log must not keep. The
 *  character length is retained because it is useful for diagnosing a truncated
 *  or empty reply and reveals nothing about the content. Characters (not bytes)
 *  are reported because `response.length` counts UTF-16 code units, and the unit
 *  matches the clamp applied by `recordAiEvent` (`slice(0, MAX_FIELD_CHARS)`). */
function omittedResponse(response: string): string {
  return `[response omitted: request contained an image (${response.length} chars)]`;
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
  requestHadImage: boolean,
  startedAt: number,
  outcome: { response: string; ok: boolean; error?: string },
): Promise<void> {
  if (!observe) return;
  try {
    await observe({
      request,
      latencyMs: Date.now() - startedAt,
      ...outcome,
      // A request carrying an image never gets its raw response persisted: a
      // provider echoing the submitted body could otherwise write those bytes
      // into the audit log in any shape it liked. Pattern-matching the reply for
      // every possible embedding proved unwinnable. Calls with no image keep the
      // full reply, with the data-URI scan as a secondary defence.
      response: requestHadImage
        ? omittedResponse(outcome.response)
        : redactResponseImages(outcome.response),
    });
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
  const { text: request, hadImage: requestHadImage } = stringifyBody(body);
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
          void report(observe, request, requestHadImage, startedAt, { response: text, ok: true });
          return parsed.value;
        }
        lastErr = new AiUnavailableError("AI response was not valid JSON");
      }
    } catch (err) {
      lastErr = err;
      // 4xx is a permanent config error (bad key etc.) — surface it, don't retry.
      if (err instanceof AiUnavailableError && /\(4\d\d\)/.test(err.message)) {
        void report(observe, request, requestHadImage, startedAt, { response: lastResponse, ok: false, error: err.message });
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
  void report(observe, request, requestHadImage, startedAt, { response: lastResponse, ok: false, error: finalErr.message });
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

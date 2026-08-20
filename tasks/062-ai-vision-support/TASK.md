# Task: 062 — Vision support in `packages/ai` (board task 8.1)

## Status

COMPLETE — all seven acceptance criteria met, each pinned by a test proven to bite via
mutation. Eleven Codex review rounds; every confident finding either fixed or dismissed with
recorded evidence.

**Evidence caveat, stated plainly:** the external Postgres and Redis (`192.168.2.196`)
were unreachable for the whole of this work, so `apps/api` tests and one
`apps/extractor` test could not run locally. This change touches `apps/api` only through
the type system, and `npm run typecheck` passes across all seven workspaces. CI (Node 24
+ real `postgres:18`) is the authority for the api suite. Local runs were also on **Node
22**, not the Node 24 that `engines.node` and CI pin.

## What shipped

`ChatMessage`'s **user** member widened from `content: string` to
`content: string | ContentBlock[]`, where a block is `TextBlock | ImageBlock`. The
`assistant` and `tool` members are unchanged. Because `string` remains a member of the
union, no existing call site changed behaviour, and a text-only request serializes to a
**byte-identical** wire body — pinned by `deepEqual` assertions on `messages` in both
provider test files.

| Provider | Image wire shape |
|---|---|
| anthropic | `{type:"image", source:{type:"base64", media_type, data}}` |
| openai-compat | `{type:"image_url", image_url:{url:"data:<type>;base64,<data>"}}` |
| ollama | rejected by `assertNoImages` before any HTTP call |

Guards, all throwing **before** any HTTP call:
- `assertNoImages` → `AiVisionUnsupportedError` (ollama has no image path, mirroring how
  forced tool-calling deliberately skips it).
- `assertImagesValid` → `AiImageRejectedError` for unsupported media type, non-string
  `data`, a `data:` URI prefix passed by mistake, non-canonical base64, or a payload over
  `MAX_IMAGE_BYTES` (5 MiB). Deliberately **not** an `AiUnavailableError`: this is bad
  input, not a provider outage, so it must not be retried or reported as a transient fault.

## The audit-log problem, which was the real work

`http.ts` builds the observer's `request` string from the same body it POSTs, and that
string lands in `ai_events.request_context` (clamped at 64,000 chars by `recordAiEvent`).
Naively adding images would have written ~64 KB of truncated base64 per vision call.

The fix is `stringifyBody` doing `JSON.parse(JSON.stringify(body))` **first**, then
redacting that plain-JSON copy. Serialize-before-redact is load-bearing twice over:
`JSON.stringify` applies `toJSON()` so a `Date` still becomes an ISO string, and parsing
back leaves only plain JSON values so nothing can smuggle image bytes past the redactor
behind a custom `toJSON`. The body actually POSTed is serialized independently from the
untouched original, so the redacted copy can never reach a provider.

Response text is redacted too, at the single chokepoint inside `report`, because some
endpoints echo the submitted body in an error reply and would otherwise put base64 into
`ai_events.response_raw`.

## Defects found and fixed during review

1. **`toJSON` bypass (Codex, confirmed by reproduction).** A `Object.getPrototypeOf`
   guard — added to stop an entries-rebuild discarding `toJSON` — itself created a hole:
   an object whose `toJSON()` returned an image block leaked raw bytes. Serialize-first
   removed both the hole and the guard.
2. **`catch { return String(body) }` could break a model call.** A throwing `toString()`
   escaped `stringifyBody`, which is called outside any `try` in `postJson`. Now returns a
   constant. Pre-existing, not a regression. Verified: the old path threw a raw `Error`
   with **no observation recorded**; the new one normalises to `AiUnavailableError` and
   still logs.
3. **Permissive base64 regex.** `/^[A-Za-z0-9+/]+={0,2}$/` accepted `"A"` and `"A="`,
   which decode to **zero bytes**. Replaced with a flat character class plus arithmetic
   length checks in `isCanonicalBase64`.
4. **A canonical-base64 regex that blew the stack.** The obvious fix,
   `(?:[A-Za-z0-9+/]{4})*`, throws `RangeError: Maximum call stack size exceeded` on the
   10 MB string the oversized test uses. Caught before it shipped; the flat form runs in
   ~10 ms. The same trap recurred later in the response redactor and was rejected there
   too — an alternation inside `+` backtracks per character. **Both regexes must stay
   flat.** In the response redactor the consequence would have been worse than a failing
   test: it runs inside `report`'s `try/catch`, so the `RangeError` would be swallowed and
   the audit record silently lost.
5. **Response redaction was too broad and escape-blind.** It altered
   `data:text/plain` (contradicting its own docs) and a JSON-escaped `image\/png` defeated
   it — some providers escape `/` in JSON strings; PHP's `json_encode` does by default.
   Now image-only and escape-tolerant.
6. **The guard and the serializers disagreed, creating a bypass.** `assertImagesValid`
   skipped any block whose `type` was not `"image"`, while **both** serializers treated
   every non-`"text"` block *as* an image. So a runtime-shaped
   `{type:"not-image", mediaType:"image/tiff", data:<8 MB>}` skipped the media-type and
   size checks and reached the provider as an image. TypeScript forbids it, but this guard
   exists precisely for values that never went through the type system — which is what
   task 9.5 will feed it. Now the guard rejects unknown block types and both serializers
   handle `"text"` and `"image"` explicitly, dropping anything else.
7. **The response redactor was not actually image-only.** `image[\w.+\\/-]*` also matched
   media types merely *beginning* with "image", so `data:imagefoo/png` was rewritten,
   contradicting the documented preservation contract. Now anchored on a separator class,
   `image[\\/][...]`, which still accepts `image/png`, `image\/png` and `image\u002fpng`.
8. **The response redactor missed JSON-escaped delimiters.** `data:image/png\u003bbase64\u002c<bytes>`
   passed straight through, because both the fast path and the matcher required the literal
   `;base64,`. Each delimiter now accepts its escaped form as a fixed-length one-off
   alternation — quantified alternations are what blow the stack, one-offs do not.
9. **Anthropic-shaped echoed images leaked into `response_raw`.** The response scan only
   knew `data:image/...;base64,...`, but an Anthropic request carries **bare** base64 at
   `source.data`. A provider or relay echoing that body logged the whole payload —
   reproduced. A text scan cannot safely spot bare base64, but the JSON *structure* is
   unmistakable, and `redactImages` already knows both providers' native shapes because it
   is what redacts the request side. The response path now parses JSON, runs `redactImages`
   structurally, then scans the remaining string values for data URIs. Parsing also
   resolves every JSON escape, which closed a `base64`-spelled-with-`\u0036\u0034` case
   that no raw-text regex could catch — a parse replaces an ever-growing set of escape
   special-cases rather than adding to it.
10. **Response redaction was case-sensitive.** `data:image/png;BASE64,...` slipped the
   fast-path gate and `data:IMAGE/PNG;base64,...` slipped the matcher — both standards-valid
   (RFC 2045 makes the token and media types case-insensitive). Reproduced. The gate is now
   `/base64/i.test(text)` rather than `.toLowerCase().includes(...)`, which would allocate a
   full lowercase copy of every response; the matcher gained the `i` flag; and the logged
   media type is canonicalised to lower case.
11. **A deeply nested reply could still leak a bare Anthropic payload.** The structural walk
   raises `RangeError` past roughly 5,000 levels of nesting, and the raw-text fallback cannot
   recognise bare base64 at `source.data`. So the walk failing meant an Anthropic-shaped
   image was logged raw — reproduced. It now fails **closed**: if the structural pass could
   not run and the text still looks like it carries a base64 block, the body is dropped for
   a placeholder. Losing debugging detail in a pathological case beats writing the image
   into the audit row.
12. **The fail-closed check was itself defeatable.** The first version decided whether to
   drop the body by testing the raw text for `"type":"base64"` — which an attacker or a
   quirky encoder defeats by escaping the very token it searches for (`"base\u0036\u0034"`
   is valid JSON for `"base64"`). Reproduced. The fix removes the hint entirely and instead
   separates "the body was not JSON" (scan the text) from "the body parsed but could not be
   walked" (fail closed unconditionally). **This closed the ESCAPING axis by construction
   rather than by a better pattern** (though not, as the next two findings show, every
   axis): the failure path no longer inspects
   content, so there is no token left to escape. It also deleted a regex rather than adding
   one.
13. **`redactImages` skipped a redacted node's sibling keys.** On matching an image it
   returned `{ ...obj, source: {...} }` and never recursed into the node's other properties,
   so a second image in a sibling key was copied verbatim. Reproduced. **This leaked into
   `request_context` as well as `response_raw`**, since `stringifyBody` uses the same
   function — the one AC most directly at stake. Fixed by walking children first and applying
   the node's own redaction to the walked result. No escaping trick was needed to trigger it;
   plain valid JSON sufficed.
14. **The redactor and the response parser disagreed about what JSON is.** `postJson` accepts
   OpenRouter keep-alive-padded bodies through `parseResponseBody` → `extractJson`, but the
   redactor used a bare `JSON.parse`, which threw on the padding and dropped to the text scan
   that an escaped marker defeats. So a body the client had already accepted as a valid
   response leaked. Reproduced. Fixed by reusing `parseResponseBody` itself, so the two can
   no longer drift apart.
15. **Three tests that did not bite.** A "non-text block is dropped" test containing only
   text blocks (a duplicate of its neighbour); an image-only test using one block, where
   `[""].join("\n")` and `[].join("\n")` are both `""`; and an echo test stubbing HTTP 200
   so it never exercised the error report path.
16. **`as unknown as ChatMessage[]` throughout the new tests**, which switched off type
   checking for precisely the property AC1 claims. A zero-cast probe file typechecked
   clean, proving the casts were removable noise. One cast survives, on `data: 123`, to
   force an invalid runtime value into a guard whose whole purpose is untrusted input.
17. **Rejection tests asserting only the error class.** All five `assertImagesValid` rules
   throw the same class, so a test could pass because the wrong rule fired. Each now
   asserts its specific message.

## The design that ended the whack-a-mole

Ten rounds of pattern-matching the response text for image bytes produced ten real leaks,
each a different embedding. The last one, reproduced: a provider returns valid JSON that
embeds our request as a JSON **string** —

```js
const embedded = JSON.stringify({ type: "image", source: { type: "base64", data: image } });
const response = JSON.stringify({ error: { echoed_request: embedded } });
```

— where the structural pass sees `echoed_request` only as a string and the string pass looks
for data URIs, not bare `source.data`. Closing that would have closed one example, not the
class.

So the rule changed: **when the REQUEST carried an image, the raw response is not persisted
at all** — only `[response omitted: request contained an image (N bytes)]`. Echoed-image
leakage now stops depending on the provider's error format entirely.

Three properties make it hold:
- **One walk, one source of truth.** `redactImages` threads a `RedactionState` and sets
  `hadImage` in both image branches. A separate predicate would be a second source of truth
  free to drift from the redactor — which is exactly how the `parseResponseBody` bug arose.
- **Fail closed.** `stringifyBody`'s catch returns `hadImage: true`: if the body could not be
  serialized, we cannot prove it carried no image.
- **Scoped, not blanket.** Calls with no image keep their full reply, with the structural and
  data-URI redaction retained as a secondary defence. The mutation drill proves the scoping:
  reverting the gate fails the two suppression tests while the no-image test still passes.

The byte length is kept in the placeholder because it distinguishes an empty reply from a
truncated one and reveals nothing about content.

**Accepted cost:** the AI event log no longer shows a raw provider response for vision calls.
That is a deliberate trade of debuggability for audit hygiene, taken with the user's explicit
agreement.

## Findings dismissed, with reasons

- **Non-canonical pad bits** (`AB==`, `ABC=` accepted). Verified `AB==` and `AA==` both
  decode to the identical byte `0`, and `ABC=`/`ABA=` both to `0,16`. Pad bits cannot
  corrupt an image or skew `base64ByteLength`, so enforcing them is complexity for no
  user-visible benefit. Codex accepted this on re-review.
- **The union widening is a source-compatibility break.** True and deliberate: the union
  forces consumers to handle image content rather than silently assuming a string. The
  sole in-repo consumer (`assistant.ts:25`) passes `string`, which remains valid; the HTTP
  surface (`AiChatMessageSchema`) stays `z.string()`, so no route can accept an image yet
  — that is task 9.5. One narrowing cast was needed in `apps/extractor/src/extract.test.ts`
  because `assert.match` requires a `string`; it still fails loudly on an array, since
  `assert.match` throws on a non-string argument. Codex accepted this on re-review.
- **Defer `report()` so a synchronous observer cannot block the model call.** Raised twice,
  the second time proposing `queueMicrotask`. **Measured and refuted:** with a 120 ms
  busy-loop observer, the delay experienced by a caller doing `await postJson(...)` is
  120 ms when calling `report` directly and **120 ms via `queueMicrotask`** — identical,
  because the caller's own `await` continuation is a microtask queued *after* ours, so it
  still waits for the busy loop. Only `setImmediate` reaches 0 ms, and a macrotask would
  make observations land after `await postJson(...)` returns: every synchronous observation
  assertion becomes racy (the exact flake pattern already diagnosed here) and a record can
  be lost if the process exits first. The underlying observation is true but inherent to
  JS single-threading and predates this change; every observer actually constructed in this
  repo is an async DB insert (`routes/ai.ts` builds `(obs) => recordAiEvent(...)`), which
  returns at its first `await`. Cost mitigated instead with a `text.includes("base64,")`
  short-circuit, so realistic responses never pay for the redaction scan.
- **A pasted image data URI inside ordinary prompt text** is logged as prompt text. Codex
  called this the practical limit and I agree: inside free text it is indistinguishable from
  legitimate content, and it is pre-existing audit behaviour, not something vision introduced.
- **An own `__proto__` key is dropped** when a JSON reply is re-serialized. Audit-copy
  fidelity only, never the provider result. The JSDoc now says so rather than claiming JSON
  semantics are preserved wholesale.
- **A Proxy or stateful accessor can defeat the image guard** — a block whose `type` getter
  returns `"text"` during validation and `"image"` during serialization. Real and
  reproduced by the reviewer, but it needs an exotic in-process object: JSON from an HTTP
  boundary can never produce one, and anyone able to pass a Proxy into `ai.chat()` already
  has code execution and could call the provider directly, so the guard is not a security
  boundary against them. Snapshotting every block before validating would copy every image
  payload on every call to defend against an adversary who does not need the bypass.
- **Duplicate test titles across the two provider files.** Pre-existing repo practice
  (present at committed HEAD for four titles), and `node --test` prints the file path in
  `location:` on failure. Cosmetic.

## Verification

Three consecutive `packages/ai` runs, identical each time: **89 tests, 89 pass, 0 fail,
exit 0**. `npm run typecheck` exit 0 across all seven workspaces; `npm run lint` exit 0.
`packages/shared` 212/212, `apps/web` 297/297, `apps/ingestor` 12/12,
`apps/extractor` 78/79 (the holdout requires `DATABASE_URL`). `packages/ai` went from 32
tests to 89. No relative import is missing its `.ts` extension; no `RangeError`,
unhandled rejection or `ExperimentalWarning` in any run.

The redaction work converged over eleven review rounds, each finding narrower than the last:
structural bypass, then media-type overreach, then escaped delimiters, then the Anthropic
bare-base64 shape, then case-sensitivity, then deep nesting, then an escapable fail-closed
hint, and finally two structural leaks that had nothing to do with encoding at all.

Two lessons for whoever touches this next. First, **a regex over raw text cannot be made
airtight** — every round found one more encoding that slipped the previous pattern, and what
closed that axis was not a better pattern but removing the content sniffing: parse the JSON,
reuse the request-side matcher, and where the parse or walk cannot run, fail closed without
inspecting anything.

Second, and more chastening: having closed the encoding axis I claimed the class was closed
"by construction", and the next review found two leaks on a completely different axis —
`redactImages` returning early and never walking a matched node's sibling keys, and the
redactor using a bare `JSON.parse` while `postJson` accepts keep-alive-padded bodies via
`extractJson`. Neither needed an escaping trick. **A confident argument about one axis says
nothing about the others.**

Every load-bearing test was proven to bite by reverting only the behaviour it names and
observing the failure, then restoring and confirming a byte-identical `sha256sum`:
request redaction, the ollama guard, the Anthropic wire shape, `toOllamaContent`'s
`flatMap`, the `toJSON` bypass, the `String(body)` fallback, response-side escape
handling, and the image-only restriction.

One process failure worth recording: an early mutation-drill brief told a worker to
restore with `git checkout --`, forgetting the fix under test was itself uncommitted. That
discarded the working-tree `ollama.ts`. Recovered from the brief's own literal text, but
the reconstruction differed behaviourally (`map` emitting `""` for a non-text block,
versus `flatMap` dropping it — `"a\n\nb"` instead of `"a\nb"`). Every later drill brief
forbade all git write commands and required hand restoration plus a checksum match.

## Acceptance criteria

- [x] Message union carries image content without breaking any existing text-only call site
- [x] Anthropic and openai-compat send the correct native image wire shape (asserted in tests)
- [x] Sending an image to ollama fails fast with a clear error, before any HTTP call
- [x] Oversized/unsupported image types rejected with a typed error
- [x] `ai_events` records that an image was sent without embedding the image bytes
- [x] Existing `packages/ai` tests still green; app still boots with AI disabled
- [x] typecheck + lint + test green

## Follow-ups this opened

- **9.5 photo capture** is now unblocked. It must widen `AiChatMessageSchema` in
  `packages/shared` before any route can accept an image, and add an upload size/type
  guard at the HTTP boundary — `assertImagesValid` is a library net, not an input filter.
- **The AI event log's response pane is now empty for vision calls** (`[response omitted:
  ...]`). If that proves too blunt in use, the safe direction is an allowlisted structural
  summary — finish_reason, token counts, error code — extracted from the parsed reply, never
  the raw text. Do NOT reintroduce raw response logging for image calls.
- **The local `.env` is stale.** It points at `192.168.2.196/compass-dev`, which `INFRA.md:23`
  records as decommissioned ("nothing depends on the old LAN box at 192.168.2.196 any more"),
  so `apps/api` tests cannot run locally. `192.168.2.183` is reachable on 5432/6379 but
  neither the `.env` credentials nor the production ones authenticate there. Note the
  production cluster on `192.168.2.228` publishes NO host port for Postgres or Valkey
  (`INFRA.md:63-64`), and its database `compass` is live data — not a test target.
- `apps/extractor`'s test script lacks `--env-file-if-exists=../../.env` (unlike
  `apps/api`'s), so `statement-duplicate.test.ts` needs `DATABASE_URL` exported by hand.
  Pre-existing; not touched here.

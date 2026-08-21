No remaining BLOCKING findings.

**Findings**
- non-blocking: `modelSupportsVision()` is still substring-based for the retained family markers in [types.ts](/work/personal/compass/packages/ai/src/types.ts:268), so an intentionally misleading custom alias like `not-llava-text-model` or `fake-pixtral-text` would still return true. I do not consider this a remaining task-9.5 blocker because the review-3 false-positive sources, bare `vision`, bare `gemini`, and bare `claude`, are removed, and the retained substrings are the requested genuine vision-family markers.

**Confirmations**
- False-positive defect resolved for the requested cases. [types.ts](/work/personal/compass/packages/ai/src/types.ts:271) now only allows `gpt-4o`, `gpt-4.1`, `gpt-4-turbo`, `claude-3`, `claude-4`, `llava`, `-vl`, `qwen2-vl`, and `pixtral`; it no longer checks bare `vision`, `gemini`, or `claude`. I verified directly that `not-vision`, `my-vision-benchmark-text-model`, `claude-2`, `claude-instant-1`, `deepseek-chat`, `vision`, `gemini`, and `claude` all return `false`, while `gpt-4o`, `gpt-4o-mini`, `anthropic/claude-3.5-sonnet`, `claude-3-opus`, `llava-1.6`, `qwen2-vl-7b`, and `pixtral-12b` return `true`.

- False-negative tradeoff is safe. OpenAI-compatible providers derive `supportsVision` from the helper in [openai-compat.ts](/work/personal/compass/packages/ai/src/openai-compat.ts:75). When that is false, `parseListImage()` returns `{ available:false, items:[], message:"Photo capture requires a vision-capable AI provider" }` before `storage.put()` or `ai.chat()` in [parse-image.ts](/work/personal/compass/apps/api/src/modules/shopping/services/parse-image.ts:77). So `gemini-1.5` and names like `claude-haiku-4-5-20251001` degrade without sending the image or crashing. That is the conservative, acceptable direction for AC5.

- Vision-capability tests are correct and non-vacuous. Positive cases are asserted in [vision-capability.test.ts](/work/personal/compass/packages/ai/src/vision-capability.test.ts:17), including the requested real vision families through [vision-capability.test.ts](/work/personal/compass/packages/ai/src/vision-capability.test.ts:65). Negative cases are asserted in [vision-capability.test.ts](/work/personal/compass/packages/ai/src/vision-capability.test.ts:71), including `not-vision`, `my-vision-benchmark-text-model`, `claude-2`, `claude-instant-1`, and `deepseek-chat`. The old broad-behavior true assertions for `gemini`/bare `claude`/bare `vision` were correctly removed.

- Image-route event test is now non-vacuous. The mocked `parseListImage` invokes `observe` in [capture-image.hermetic.test.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/capture-image.hermetic.test.ts:40), the mocked `recordAiEvent` records `input.kind` in [capture-image.hermetic.test.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/capture-image.hermetic.test.ts:67), and the AC5 test asserts `recordedKinds.includes("shopping_parse")` in [capture-image.hermetic.test.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/capture-image.hermetic.test.ts:301).

- No new provider-flag regression found. Anthropic is still independently `supportsVision: true` in [anthropic.ts](/work/personal/compass/packages/ai/src/anthropic.ts:70), Ollama is `false` in [ollama.ts](/work/personal/compass/packages/ai/src/ollama.ts:48), and NullProvider is `false` in [null-provider.ts](/work/personal/compass/packages/ai/src/null-provider.ts:12). The helper tightening only affects OpenAI-compatible providers.

**Verification**
- `node --experimental-test-module-mocks --test packages/ai/src/vision-capability.test.ts` passed: 30/30.
- `node --experimental-test-module-mocks --test apps/api/src/modules/shopping/routes/capture-image.hermetic.test.ts` passed: 8/8.
- `node --experimental-test-module-mocks --test apps/api/src/modules/shopping/services/parse-image.test.ts` passed: 7/7.
- `npm run typecheck` passed.
- `npm run lint` passed.

Implementation is ready to commit.
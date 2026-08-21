**Verdict: ready to implement, with one implementation note.**

All 3 prior blocking findings are resolved in the revised plan.

**B1 Image Lifecycle**

Resolved. The revised plan now gates before storage, then uses transient `storage.put` followed by `storage.delete(key)` in `finally`, with the vision call using the in-memory buffer and no `storageKey` in the response schema: [TASK.md](/work/personal/compass/tasks/068-photo-capture/TASK.md:52), [TASK.md](/work/personal/compass/tasks/068-photo-capture/TASK.md:94), [TASK.md](/work/personal/compass/tasks/068-photo-capture/TASK.md:121), [TASK.md](/work/personal/compass/tasks/068-photo-capture/TASK.md:146).

This addresses the original orphan/backup problem because storage keys are otherwise expected to be DB-owned metadata: [storage.ts](/work/personal/compass/apps/api/src/lib/storage.ts:15), [attachments.ts](/work/personal/compass/apps/api/src/modules/ledger/services/attachments.ts:86), [backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:217), [backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:277).

No planned normal path skips delete after a successful `put`: success and propagating `ai.chat()` errors are covered by `finally`. Residual unavoidable orphan cases still exist if the process dies after `put` or `storage.delete` itself fails, but that is not the original design flaw; it is the normal class of crashed-upload/best-effort-delete orphan already reported by the backup service at [backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:277). I would implement the `finally` so delete is attempted and, if product wants original chat errors preserved, be careful not to mask them with a delete failure.

**B2 Vision Capability**

Resolved. `AiProvider` is the right layer: the central interface is at [types.ts](/work/personal/compass/packages/ai/src/types.ts:256), all production providers are factory-created through [factory.ts](/work/personal/compass/packages/ai/src/factory.ts:58), and the concrete object-returning constructors are [anthropic.ts](/work/personal/compass/packages/ai/src/anthropic.ts:41), [ollama.ts](/work/personal/compass/packages/ai/src/ollama.ts:34), [openai-compat.ts](/work/personal/compass/packages/ai/src/openai-compat.ts:48), plus [null-provider.ts](/work/personal/compass/packages/ai/src/null-provider.ts:9).

The conservative `modelSupportsVision(model)` shape is enough to block the known bad paths from review-1: OpenRouter defaults to `deepseek/deepseek-chat` at [factory.ts](/work/personal/compass/packages/ai/src/factory.ts:25), DeepSeek defaults to `deepseek-chat` at [factory.ts](/work/personal/compass/packages/ai/src/factory.ts:26), and both enter the OpenAI-compatible provider at [factory.ts](/work/personal/compass/packages/ai/src/factory.ts:67) and [factory.ts](/work/personal/compass/packages/ai/src/factory.ts:76). With unknown/default-false allowlist gating, those do not reach the OpenAI-compatible image wire path at [openai-compat.ts](/work/personal/compass/packages/ai/src/openai-compat.ts:56).

Typecheck will enforce the new required field for all values typed as `AiProvider`. Besides production constructors, implementation must update these test fakes:

- [parse-list.test.ts](/work/personal/compass/apps/api/src/modules/shopping/services/parse-list.test.ts:64)
- [extract.test.ts](/work/personal/compass/apps/extractor/src/extract.test.ts:47)
- [extract.test.ts](/work/personal/compass/apps/extractor/src/extract.test.ts:71)
- [postings-pr-e-parity.test.ts](/work/personal/compass/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:440)

No other production `AiProvider` implementor appears missed. The extractor’s existing `ai.name !== "ollama"` gates at [extract.ts](/work/personal/compass/apps/extractor/src/extract.ts:394), [extract.ts](/work/personal/compass/apps/extractor/src/extract.ts:512), and [extract.ts](/work/personal/compass/apps/extractor/src/extract.ts:651) are for tool-calling/prose behavior, not image capability, so they are not blockers for 9.5.

**B3 UI Scope**

Resolved. The amended board file explicitly transfers camera/file-picker and `capture="environment"` to 12.1 and states 9.5 delivers only `POST /api/shopping/parse-image` plus shared contract: [09.05-photo-capture.md](/work/personal/compass/tasks/09.05-photo-capture.md:22). That is sufficient for 9.5 to complete on server-side scope.

**Non-Blocking Items**

Captured:

- Multipart truncation / oversize 413 with clear `HttpError`: [TASK.md](/work/personal/compass/tasks/068-photo-capture/TASK.md:88), [TASK.md](/work/personal/compass/tasks/068-photo-capture/TASK.md:125)
- Exact `ImageBlock` assertion with raw base64 and no `data:` prefix: [TASK.md](/work/personal/compass/tasks/068-photo-capture/TASK.md:55), [TASK.md](/work/personal/compass/tasks/068-photo-capture/TASK.md:130)
- Mock storage asserts both `put` and `delete`, including chat-throw path: [TASK.md](/work/personal/compass/tasks/068-photo-capture/TASK.md:133)
- `itemsFromTurn` refactor keeps 9.4 parse-list tests green: [TASK.md](/work/personal/compass/tasks/068-photo-capture/TASK.md:48), [TASK.md](/work/personal/compass/tasks/068-photo-capture/TASK.md:116), current behavior to preserve is at [parse-list.ts](/work/personal/compass/apps/api/src/modules/shopping/services/parse-list.ts:118) and [parse-list.ts](/work/personal/compass/apps/api/src/modules/shopping/services/parse-list.ts:214)
- Reuse `shopping_parse`, no migration: [TASK.md](/work/personal/compass/tasks/068-photo-capture/TASK.md:36), [TASK.md](/work/personal/compass/tasks/068-photo-capture/TASK.md:106)

No remaining blocking issue found. The plan is ready to implement.
# Investigation 1 — Task 9.5 Photo list capture

## 1. Vision support from task 8.1 (`packages/ai/src/`)

### `ChatMessage` type and `MessageContent`

**`packages/ai/src/types.ts:81-84`**
```ts
export type ChatMessage =
  | { role: "user"; content: MessageContent }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };
```

**`packages/ai/src/types.ts:147`**
```ts
export type MessageContent = string | ContentBlock[];
```

A caller attaches an image by passing `content: ContentBlock[]` on a user message, where at least one element is an `ImageBlock`:

**`packages/ai/src/types.ts:128-142`**
```ts
export interface TextBlock {
  type: "text";
  text: string;
}
export interface ImageBlock {
  type: "image";
  mediaType: AiImageMediaType;
  data: string;      // raw base64 WITHOUT "data:" URI prefix
}
export type ContentBlock = TextBlock | ImageBlock;
```

Allowed media types (`types.ts:115-121`):
```ts
export const SUPPORTED_IMAGE_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export type AiImageMediaType = (typeof SUPPORTED_IMAGE_MEDIA_TYPES)[number];
```

Per-image byte ceiling (`types.ts:126`):
```ts
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
```

### Vision capability gate — no `supportsVision` flag

There is NO `supportsVision` boolean property on `AiProvider`. The gate is an `ai.name` check enforced via two helpers:

- `assertImagesValid(messages)` (`types.ts:201`) — validates every image block (media type, base64 canonicity, size) before any HTTP call; throws `AiImageRejectedError` on bad input.
- `assertNoImages(messages, providerName)` (`types.ts:242-244`) — throws `AiVisionUnsupportedError` if the message list contains any image block.

Ollama's `chat()` calls `assertNoImages` (`ollama.ts:80`). The call site pattern documented in `types.ts:161` is:
> "Call sites gate on `ai.name !== "ollama"`, exactly as forced tool-calling does"

So 9.5 must guard: `if (ai.name === "ollama") throw/degrade` before passing image blocks to `chat()`.

### Anthropic provider wire shaping (`anthropic.ts:126-133`)
```ts
function toAnthropicContent(content: MessageContent): unknown {
  if (typeof content === "string") return content;
  return content.flatMap((b): unknown[] => {
    if (b.type === "text") return [{ type: "text", text: b.text }];
    if (b.type === "image")
      return [{ type: "image", source: { type: "base64", media_type: b.mediaType, data: b.data } }];
    return [];
  });
}
```

### OpenAI-compat provider wire shaping (`openai-compat.ts:153-160`)
```ts
function toOpenAiContent(content: MessageContent): unknown {
  if (typeof content === "string") return content;
  return content.flatMap((b): unknown[] => {
    if (b.type === "text") return [{ type: "text", text: b.text }];
    if (b.type === "image")
      return [{ type: "image_url", image_url: { url: `data:${b.mediaType};base64,${b.data}` } }];
    return [];
  });
}
```

Both `anthropic.chat()` and `openai-compat.chat()` call `assertImagesValid(request.messages)` before sending.

---

## 2. Storage abstraction (`apps/api/src/lib/storage.ts`)

### `Storage` interface (`storage.ts:22-30`)
```ts
export interface Storage {
  put(data: Buffer, contentType: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
  ensureReady(): Promise<void>;
}
```

Key generation (`storage.ts:33-36`):
```ts
function makeKey(data: Buffer): string {
  const hash = createHash("sha256").update(data).digest("hex").slice(0, 8);
  return `${hash.slice(0, 2)}/${randomUUID()}-${hash}`;
}
```
Key is `<hh>/<uuid>-<hash>` — sharded, content-addressed, opaque.

Backend selection (`storage.ts:111-122`): if `config.S3_ENDPOINT` is set, uses `S3Storage` (MinIO); otherwise `DiskStorage` at `config.STORAGE_DIR` (default `./data/attachments`).

Decorated on app as `app.storage` (wired in `app.ts:174`):
```ts
await app.storage.ensureReady();
```

Existing `storage.put` call sites (in services):
- `apps/api/src/modules/ledger/services/attachments.ts:86` — `const storedPath = await storage.put(file.data, file.mimeType);`
- `apps/api/src/modules/credit/services/card-statements.ts:56` — same pattern
- `apps/api/src/modules/protection/services/insurance.ts:171, 235` — same pattern

---

## 3. Existing server-side upload pattern

`@fastify/multipart` is registered globally at `app.ts:256`:
```ts
await app.register(multipart);
```
No global size limit set at registration — limits are applied per-handler.

Best reference: `apps/api/src/modules/ledger/routes/attachments.ts:25-35`
```ts
app.post("/api/transactions/:id/attachments", async (req, reply) => {
  const { id } = IdParams.parse(req.params);
  const file = await req.file({ limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } });
  if (!file) throw new HttpError(400, "Expected a multipart file field");
  const data = await file.toBuffer();
  const attachment = await saveAttachment(app.db, app.storage, req.session!.userId, id, {
    fileName: file.filename,
    mimeType: file.mimetype,
    data,
  });
  return reply.code(201).send(attachment);
});
```

`MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024` (10 MB) — `ledger/services/attachments.ts:8`.

Content-type validation via `assertUploadable` (`attachments.ts:53-63`):
```ts
export const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
export function assertUploadable(file: { mimeType: string; data: Buffer }): void {
  if (!ALLOWED_MIME.has(file.mimeType)) {
    throw new HttpError(415, `Unsupported file type ...`);
  }
  if (!matchesMagicBytes(file.mimeType, file.data)) {
    throw new HttpError(415, "File content does not match its declared type");
  }
  if (file.data.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new HttpError(413, "File exceeds the 10 MB limit");
  }
}
```
Magic-byte checks for JPEG (`0xFF 0xD8 0xFF`), PNG (8-byte sig), WEBP (`RIFF...WEBP`), PDF (`%PDF-`).

The card-statement upload (`credit/routes/cards.ts:175`) reuses `MAX_ATTACHMENT_BYTES` from `ledger/services/attachments.ts:33`.

---

## 4. Client-side upload pattern (`apps/web/src/lib/queries.ts:278-301`)

```ts
export function useAttachmentMutations(transactionId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["attachments", transactionId] });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/transactions/${transactionId}/attachments`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        throw new Error(((await res.json()) as { message?: string }).message ?? "Upload failed");
      }
      return AttachmentSchema.parse(await res.json());
    },
    onSuccess: invalidate,
  });
  ...
}
```

`TransactionDrawer.tsx` (`apps/web/src/routes/transactions/TransactionDrawer.tsx:331-340`) uses a plain `<input type="file">` with `onChange` calling `attMut.upload.mutate(f)`. There is NO camera, dropzone, webcam, `FileReader`, or `capture` attribute anywhere in the web source.

---

## 5. 9.4 parse path to reuse

**9.4 is NOT yet implemented.** No files exist for `apps/api/src/modules/shopping/services/parse-list.ts`, `apps/api/src/modules/shopping/routes/capture.ts`, nor do `ParsedShoppingItemSchema`, `ParseListTextRequestSchema`, `ParseListTextResponseSchema` exist in `packages/shared/src/schemas/shopping.ts` (grep returned zero matches).

What 9.5 will import (per `tasks/067-paste-text-capture/TASK.md` Plan section):

From `packages/shared` (`shopping.ts`):
- `ParsedShoppingItemSchema` — `{ rawText: string(1–200), quantityBase: int≥0|null, unit: NormalizedUnit|null }` (paired refine)
- `ParseListTextRequestSchema` / `ParseListTextResponseSchema`

From `apps/api/src/modules/shopping/services/parse-list.ts`:
- `PARSE_LIST_TOOL: ToolSpec` — JSON input schema with `items[]` of `{name, quantity?, unit?}`
- `parseItemsFromTurn(turn, structured): ParsedShoppingItem[] | null` — pure; the three-way tool-call logic
- `parseListText(db, userId, secret, allowedBaseUrls, input, observe)` — full provider path

9.5 reuses `PARSE_LIST_TOOL` and `parseItemsFromTurn` unchanged; the only difference from 9.4 is that the user message content is `ContentBlock[]` (text prompt + image block) instead of a plain `string`. The route (`POST /parse-image` or similar) accepts `multipart/form-data`, reads the image buffer, base64-encodes it, constructs the `ImageBlock`, calls `ai.chat()` with the same tool, and delegates to `parseItemsFromTurn` for normalization.

---

## 6. Config limits (`apps/api/src/config.ts`)

No env vars in `config.ts` for max upload size, image size, or content-type allowlist. The only storage-related vars are:
- `STORAGE_DIR` (default `./data/attachments`) — disk fallback path
- `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE`

All file-size and content-type limits are hardcoded in service files:
- `MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024` — `ledger/services/attachments.ts:8`
- `MAX_IMAGE_BYTES = 5 * 1024 * 1024` — `packages/ai/src/types.ts:126` (AI vision gate, not an upload limit)
- `ALLOWED_MIME` set — `ledger/services/attachments.ts:9`

There is no global upload size limit env var. 9.5 will need to define its own constant (recommended: `MAX_IMAGE_BYTES` from `packages/ai` = 5 MB, which fits inside both the provider limit and the 10 MB attachment ceiling).

---

## 7. Attachments table / storage pattern

An `attachments` table EXISTS in `apps/api/src/modules/ledger/schema.ts:109-122`:
```ts
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storedPath: text("stored_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("attachments_tx_idx").on(t.transactionId)],
);
```

This table is **transaction-scoped** (FK to `transactions.id`). It is NOT shopping-list-scoped.

For task 9.5, the AC ("Images stored via the Storage abstraction") does NOT require a new DB table — the image can be:
- Uploaded → `storage.put()` → key held transiently (in memory or request-scoped), base64-encoded → sent to AI → key discarded after the parse response.
- Alternatively, stored and key referenced in a new `shopping_list_parse_sessions` or similar table, but the board AC says nothing about persistence — only that storage is used and verified.

The existing pattern (credit/insurance/ledger) is: upload → `storage.put()` → store the returned key in a DB column (`storedPath`). For 9.5, since items are reviewable-only (not persisted until user accepts), the image is likely transient: uploaded, stored briefly in `Storage`, AI called, result returned, key deleted post-parse. No new attachments table appears to be required unless the design specifies one.

---

## Files inspected

- `packages/ai/src/types.ts`
- `packages/ai/src/anthropic.ts`
- `packages/ai/src/openai-compat.ts` (lines 100-180)
- `packages/ai/src/ollama.ts` (lines 1-30, grep)
- `packages/ai/src/index.ts`
- `packages/ai/src/vision.test.ts` (lines 1-30)
- `apps/api/src/lib/storage.ts`
- `apps/api/src/config.ts`
- `apps/api/src/app.ts` (grep + lines 250-268)
- `apps/api/src/modules/ledger/routes/attachments.ts`
- `apps/api/src/modules/ledger/services/attachments.ts`
- `apps/api/src/modules/ledger/schema.ts` (grep)
- `apps/api/src/modules/shopping/` (directory listing; no parse-list.ts exists)
- `apps/web/src/lib/queries.ts` (lines 278-301)
- `apps/web/src/routes/transactions/TransactionDrawer.tsx` (lines 280-360, grep)
- `tasks/067-paste-text-capture/TASK.md`

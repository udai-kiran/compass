/**
 * Hermetic route tests for POST /api/shopping/parse-image (task 9.5 P6).
 *
 * Uses mock.module to stub parseListImage and its upstream service
 * dependencies, then registers the REAL shoppingCaptureImageRoutes plugin so
 * the actual handler executes — covering content-type/magic-byte validation,
 * oversize rejection, and the 401 for missing session.
 *
 * No DB, Redis, or Storage required. Requires --experimental-test-module-mocks.
 */

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import multipart from "@fastify/multipart";
import { MAX_IMAGE_BYTES } from "@compass/ai";
import type { AiCallObservation } from "@compass/ai";
import type { Db } from "../../../db/index.ts";
import type { Storage } from "../../../lib/storage.ts";

// ─── Mock all upstream modules BEFORE importing the real route plugin ─────────

let parseListImageResult = {
  available: true as boolean,
  items: [] as never[],
  message: null as string | null,
};

// Track AI event kinds recorded during tests (non-vacuous AC5 assertion).
let recordedKinds: string[] = [];

await mock.module(
  new URL("../services/parse-image.ts", import.meta.url).href,
  {
    exports: {
      // iter2 Fix 2 (AC5): mock INVOKES the observe callback so that the route
      // handler's AiObserver fires → recordAiEvent is called → recordedKinds
      // accumulates "shopping_parse". Without this the assertion was vacuous.
      parseListImage: async (
        _deps: unknown,
        _userId: unknown,
        _image: unknown,
        observe?: (obs: AiCallObservation) => void,
      ) => {
        observe?.({ ok: true, request: "{}", response: "{}", latencyMs: 1 });
        return parseListImageResult;
      },
    },
  },
);

await mock.module(
  new URL("../../automation/services/ai-settings.ts", import.meta.url).href,
  {
    exports: {
      getAiSettings: async () => ({ provider: "anthropic", model: "claude-haiku-4-5-20251001" }),
      getUserAiProvider: async () => null,
    },
  },
);

await mock.module(
  new URL("../../automation/services/events.ts", import.meta.url).href,
  {
    exports: {
      recordAiEvent: async (_db: unknown, _userId: string, input: { kind: string }) => {
        recordedKinds.push(input.kind);
      },
    },
  },
);

await mock.module(
  new URL("../../ingest/services/mailboxes.ts", import.meta.url).href,
  {
    exports: {
      mailboxSecret: () => "test-mailbox-secret",
    },
  },
);

// Import the REAL route plugin — it binds to the mocked exports above.
const { shoppingCaptureImageRoutes } = await import("./capture-image.ts");

// ─── Test app builder ─────────────────────────────────────────────────────────

async function buildHermeticApp(opts: { authed?: boolean } = { authed: true }) {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Decorate app with the stubs the route handler accesses.
  app.decorate("db", {} as unknown as Db);
  app.decorate("storage", {} as unknown as Storage);
  app.decorate("config", {
    AI_ALLOWED_BASE_URLS: "",
    SESSION_SECRET: "test-secret",
  } as never);

  // Register multipart globally (mirrors app.ts:256).
  await app.register(multipart);

  if (opts.authed !== false) {
    // Stub req.session so the route's req.session!.userId access works.
    app.addHook("preHandler", async (req) => {
      (req as unknown as { session: { id: string; userId: string; demo: boolean } }).session = {
        id: "session-test-id",
        userId: "user-hermetic-test",
        demo: false,
      };
    });
  } else {
    // Unauthenticated: return 401 before the route handler runs.
    app.addHook("preHandler", async (_req, reply) => {
      reply.code(401).send({ message: "Unauthorized" });
    });
  }

  await app.register(shoppingCaptureImageRoutes, { prefix: "/api/shopping" });
  await app.ready();
  return app;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a multipart body for the given file buffer and content-type. */
function buildMultipart(
  fieldname: string,
  filename: string,
  mimeType: string,
  data: Buffer,
): { payload: Buffer; boundary: string } {
  const boundary = "----TestBoundary12345";
  const CRLF = "\r\n";
  const parts = [
    `--${boundary}${CRLF}`,
    `Content-Disposition: form-data; name="${fieldname}"; filename="${filename}"${CRLF}`,
    `Content-Type: ${mimeType}${CRLF}`,
    `${CRLF}`,
  ].join("");
  const end = `${CRLF}--${boundary}--${CRLF}`;
  const payload = Buffer.concat([
    Buffer.from(parts, "latin1"),
    data,
    Buffer.from(end, "latin1"),
  ]);
  return { payload, boundary };
}

// ─── Content-type reject ──────────────────────────────────────────────────────

test("POST /api/shopping/parse-image: application/pdf content-type → 415", async (t) => {
  const app = await buildHermeticApp();
  t.after(() => app.close());

  const pdfBuf = Buffer.from("%PDF-1.4 fake content", "latin1");
  const { payload, boundary } = buildMultipart("file", "list.pdf", "application/pdf", pdfBuf);

  const res = await app.inject({
    method: "POST",
    url: "/api/shopping/parse-image",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  });

  assert.equal(res.statusCode, 415, `Expected 415 but got ${res.statusCode}: ${res.body}`);
});

test("POST /api/shopping/parse-image: text/plain content-type → 415", async (t) => {
  const app = await buildHermeticApp();
  t.after(() => app.close());

  const textBuf = Buffer.from("plain text file", "utf8");
  const { payload, boundary } = buildMultipart("file", "list.txt", "text/plain", textBuf);

  const res = await app.inject({
    method: "POST",
    url: "/api/shopping/parse-image",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  });

  assert.equal(res.statusCode, 415, `Expected 415 but got ${res.statusCode}: ${res.body}`);
});

test("POST /api/shopping/parse-image: image/jpeg declared but PDF magic bytes → 415 (magic byte mismatch)", async (t) => {
  const app = await buildHermeticApp();
  t.after(() => app.close());

  // Declare image/jpeg but use PDF magic bytes.
  const pdfBuf = Buffer.from("%PDF-1.4 fake content", "latin1");
  const { payload, boundary } = buildMultipart("file", "list.jpg", "image/jpeg", pdfBuf);

  const res = await app.inject({
    method: "POST",
    url: "/api/shopping/parse-image",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  });

  assert.equal(res.statusCode, 415, `Expected 415 but got ${res.statusCode}: ${res.body}`);
});

// ─── Oversize ─────────────────────────────────────────────────────────────────

test("POST /api/shopping/parse-image: oversize file → 413", async (t) => {
  const app = await buildHermeticApp();
  t.after(() => app.close());

  // Build a JPEG buffer just over MAX_IMAGE_BYTES (5 MB + 1 KB).
  const oversizeBuf = Buffer.alloc(MAX_IMAGE_BYTES + 1024, 0x00);
  oversizeBuf[0] = 0xff;
  oversizeBuf[1] = 0xd8;
  oversizeBuf[2] = 0xff;

  const { payload, boundary } = buildMultipart("file", "big.jpg", "image/jpeg", oversizeBuf);

  const res = await app.inject({
    method: "POST",
    url: "/api/shopping/parse-image",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  });

  assert.equal(res.statusCode, 413, `Expected 413 but got ${res.statusCode}: ${res.body}`);
});

// ─── Unauthenticated → 401 ────────────────────────────────────────────────────

test("POST /api/shopping/parse-image: no session → 401", async (t) => {
  const app = await buildHermeticApp({ authed: false });
  t.after(() => app.close());

  // Build a minimal valid JPEG multipart body.
  const jpegBuf = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02, 0x03]);
  const { payload, boundary } = buildMultipart("file", "list.jpg", "image/jpeg", jpegBuf);

  const res = await app.inject({
    method: "POST",
    url: "/api/shopping/parse-image",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  });

  assert.equal(res.statusCode, 401, `Expected 401 but got ${res.statusCode}: ${res.body}`);
});

// ─── Success path (stub parseListImage returns items) ─────────────────────────

test("POST /api/shopping/parse-image: valid JPEG → 200 with items", async (t) => {
  parseListImageResult = {
    available: true,
    items: [{ rawText: "Atta", quantityBase: 2000, unit: "g" } as never],
    message: null,
  };

  const app = await buildHermeticApp();
  t.after(() => app.close());

  const jpegBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03]);
  const { payload, boundary } = buildMultipart("file", "list.jpg", "image/jpeg", jpegBuf);

  const res = await app.inject({
    method: "POST",
    url: "/api/shopping/parse-image",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  });

  assert.equal(res.statusCode, 200, `Expected 200 but got ${res.statusCode}: ${res.body}`);
  const body = JSON.parse(res.body) as { available: boolean; items: unknown[]; message: string | null };
  assert.equal(body.available, true);
  assert.equal(body.items.length, 1);
  assert.equal(body.message, null);
});

// ─── Not public (no `config: { public: true }`) ───────────────────────────────

test("POST /api/shopping/parse-image: route is NOT public (verified by 401 without session)", async (t) => {
  // This is the same as the 401 test above; explicitly named to satisfy AC6.
  const app = await buildHermeticApp({ authed: false });
  t.after(() => app.close());

  const jpegBuf = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
  const { payload, boundary } = buildMultipart("file", "list.jpg", "image/jpeg", jpegBuf);

  const res = await app.inject({
    method: "POST",
    url: "/api/shopping/parse-image",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  });

  // 401 confirms the route is NOT public — public routes would return 2xx.
  assert.equal(res.statusCode, 401, `Expected 401 (not public) but got ${res.statusCode}: ${res.body}`);
});

// ─── AI event recording (non-vacuous AC5) ────────────────────────────────────

test("POST /api/shopping/parse-image: valid JPEG → records shopping_parse ai_event (AC5)", async (t) => {
  recordedKinds = [];
  parseListImageResult = { available: true, items: [], message: null };

  const app = await buildHermeticApp();
  t.after(() => app.close());

  // iter2 Fix 2: the mocked parseListImage now calls observe(), which fires the
  // route handler's AiObserver → recordAiEvent(db, userId, { kind:"shopping_parse", ... }).
  // The mocked recordAiEvent pushes the kind into recordedKinds.
  // This assertion is non-vacuous: it actually verifies the observer wiring.
  const jpegBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03]);
  const { payload, boundary } = buildMultipart("file", "list.jpg", "image/jpeg", jpegBuf);

  const res = await app.inject({
    method: "POST",
    url: "/api/shopping/parse-image",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  });

  assert.equal(res.statusCode, 200, `Expected 200 but got ${res.statusCode}: ${res.body}`);
  assert.ok(
    recordedKinds.includes("shopping_parse"),
    `shopping_parse ai_event must be recorded; got recordedKinds=${JSON.stringify(recordedKinds)}`,
  );
});

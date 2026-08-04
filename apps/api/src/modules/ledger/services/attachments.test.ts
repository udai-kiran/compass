import { test } from "node:test";
import assert from "node:assert/strict";
import { assertUploadable, MAX_ATTACHMENT_BYTES } from "./attachments.ts";
import { HttpError } from "../../../lib/errors.ts";

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function webpBytes(): Buffer {
  const b = Buffer.alloc(16);
  b.write("RIFF", 0, "latin1");
  b.write("WEBP", 8, "latin1");
  return b;
}

function statusOf(fn: () => void): number | null {
  try {
    fn();
    return null;
  } catch (err) {
    assert.ok(err instanceof HttpError);
    return err.statusCode;
  }
}

test("assertUploadable accepts each allowed type with matching content", () => {
  assert.doesNotThrow(() =>
    assertUploadable({ mimeType: "application/pdf", data: Buffer.from("%PDF-1.7\nbody") }),
  );
  assert.doesNotThrow(() =>
    assertUploadable({ mimeType: "image/jpeg", data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]) }),
  );
  assert.doesNotThrow(() =>
    assertUploadable({ mimeType: "image/png", data: Buffer.concat([PNG_HEADER, Buffer.from("x")]) }),
  );
  assert.doesNotThrow(() => assertUploadable({ mimeType: "image/webp", data: webpBytes() }));
});

test("assertUploadable rejects a MIME type outside the allowlist", () => {
  assert.equal(statusOf(() => assertUploadable({ mimeType: "text/html", data: Buffer.from("<html>") })), 415);
  assert.equal(statusOf(() => assertUploadable({ mimeType: "image/svg+xml", data: Buffer.from("<svg>") })), 415);
});

test("assertUploadable rejects content that does not match the declared type", () => {
  // HTML smuggled under an allowed MIME type
  assert.equal(
    statusOf(() => assertUploadable({ mimeType: "application/pdf", data: Buffer.from("<script>1</script>") })),
    415,
  );
  // PNG header declared as JPEG
  assert.equal(statusOf(() => assertUploadable({ mimeType: "image/jpeg", data: PNG_HEADER })), 415);
  // empty / truncated files
  assert.equal(statusOf(() => assertUploadable({ mimeType: "image/png", data: Buffer.alloc(0) })), 415);
  assert.equal(statusOf(() => assertUploadable({ mimeType: "image/webp", data: Buffer.from("RIFF") })), 415);
});

test("assertUploadable rejects files over the size limit", () => {
  const big = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(MAX_ATTACHMENT_BYTES)]);
  assert.equal(statusOf(() => assertUploadable({ mimeType: "application/pdf", data: big })), 413);
});

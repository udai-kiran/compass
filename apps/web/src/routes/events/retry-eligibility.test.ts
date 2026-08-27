import { test } from "node:test";
import assert from "node:assert/strict";
import type { AiEventKind, AiEventStatus, EmailIngestStatus } from "@compass/shared";
import { isRetryableEvent } from "./retry-eligibility.ts";

function event(overrides: {
  status?: AiEventStatus;
  ingestionId?: string | null;
  kind?: AiEventKind;
  ingestionStatus?: EmailIngestStatus | null;
}) {
  return {
    status: "error" as AiEventStatus,
    ingestionId: "ing-1",
    kind: "email_extract" as AiEventKind,
    ingestionStatus: "failed" as const,
    ...overrides,
  };
}

test("isRetryableEvent: true for a failed email_extract event with an ingestionId", () => {
  assert.equal(isRetryableEvent(event({ kind: "email_extract" })), true);
});

test("isRetryableEvent: true for a failed statement_parse event with an ingestionId", () => {
  assert.equal(isRetryableEvent(event({ kind: "statement_parse" })), true);
});

test("isRetryableEvent: false for statement_summary — best-effort failures don't fail the ingestion", () => {
  assert.equal(isRetryableEvent(event({ kind: "statement_summary" })), false);
});

test("isRetryableEvent: false for a kind with no replayable ingestion (e.g. shopping_parse), even with status error", () => {
  assert.equal(isRetryableEvent(event({ kind: "shopping_parse" })), false);
});

test("isRetryableEvent: false when status is ok", () => {
  assert.equal(isRetryableEvent(event({ status: "ok" })), false);
});

test("isRetryableEvent: false when ingestionId is null", () => {
  assert.equal(isRetryableEvent(event({ ingestionId: null })), false);
});

test("isRetryableEvent: false when ingestionStatus is not failed (e.g. extracted)", () => {
  assert.equal(isRetryableEvent(event({ ingestionStatus: "extracted" })), false);
});

test("isRetryableEvent: false when ingestionStatus is null (ingestion row gone)", () => {
  assert.equal(isRetryableEvent(event({ ingestionStatus: null })), false);
});

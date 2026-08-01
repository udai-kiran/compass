import assert from "node:assert/strict";
import test from "node:test";
import { doneWithoutLinkPatch, isOverdue, linkPanelPrimaryPatch } from "./task-helpers.ts";

const TODAY = "2026-02-10";

test("a task due yesterday is overdue", () => {
  assert.equal(isOverdue({ dueDate: "2026-02-09", completedAt: null }, TODAY), true);
});

test("a task due today is NOT overdue", () => {
  assert.equal(isOverdue({ dueDate: "2026-02-10", completedAt: null }, TODAY), false);
});

test("a task due tomorrow is not overdue", () => {
  assert.equal(isOverdue({ dueDate: "2026-02-11", completedAt: null }, TODAY), false);
});

test("a null due date is never overdue", () => {
  assert.equal(isOverdue({ dueDate: null, completedAt: null }, TODAY), false);
});

test("a completed task with a past due date is not overdue", () => {
  assert.equal(
    isOverdue({ dueDate: "2026-02-09", completedAt: "2026-02-08T10:30:00.000Z" }, TODAY),
    false,
  );
});

test("comparison is lexicographic across month and year boundaries", () => {
  assert.equal(isOverdue({ dueDate: "2026-01-31", completedAt: null }, TODAY), true);
  assert.equal(isOverdue({ dueDate: "2025-12-31", completedAt: null }, "2026-01-01"), true);
  assert.equal(isOverdue({ dueDate: "2026-03-01", completedAt: null }, TODAY), false);
});

const TXN_ID = "9b2e4c1a-7f3d-4e5b-8a6c-2d1f0e9b8a7c";

test('"Mark done" with a picked transaction sends completed AND transactionId', () => {
  assert.deepEqual(linkPanelPrimaryPatch("complete", TXN_ID), {
    completed: true,
    transactionId: TXN_ID,
  });
});

test('"Mark done" with nothing picked sends only completed (link untouched)', () => {
  const patch = linkPanelPrimaryPatch("complete", null);
  assert.deepEqual(patch, { completed: true });
  assert.equal("transactionId" in patch!, false);
});

test('"Save link" on a completed task sends only transactionId, never completed', () => {
  const patch = linkPanelPrimaryPatch("link-only", TXN_ID);
  assert.deepEqual(patch, { transactionId: TXN_ID });
  assert.equal("completed" in patch!, false);
});

test('"Save link" with nothing picked is invalid (caller disables the button)', () => {
  assert.equal(linkPanelPrimaryPatch("link-only", null), null);
});

test('"Done without a link" completes and explicitly clears the link', () => {
  assert.deepEqual(doneWithoutLinkPatch(), { completed: true, transactionId: null });
});

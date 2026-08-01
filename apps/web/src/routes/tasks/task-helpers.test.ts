import assert from "node:assert/strict";
import test from "node:test";
import { isOverdue } from "./task-helpers.ts";

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

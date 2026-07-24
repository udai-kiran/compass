import assert from "node:assert/strict";
import { test } from "node:test";
import { toFamilyMember } from "./profile.ts";
import {
  CreateFamilyMemberSchema,
  UpdateFamilyMemberSchema,
  UpdateUserProfileSchema,
  UserProfileSchema,
} from "@compass/shared";

test("toFamilyMember maps all fields correctly", () => {
  const row = {
    id: "123e4567-e89b-12d3-a456-426614174000",
    userId: "user-123",
    name: "Alice",
    relationship: "child" as const,
    dateOfBirth: "2010-05-15",
    educationStage: "primary" as const,
    institution: "St. Xavier's",
    courseOrStream: "General",
    expectedCompletionYear: 2028,
    notes: "Loves math",
    sortOrder: 0,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
  };

  const result = toFamilyMember(row);

  assert.deepEqual(result, {
    id: "123e4567-e89b-12d3-a456-426614174000",
    name: "Alice",
    relationship: "child",
    dateOfBirth: "2010-05-15",
    educationStage: "primary",
    institution: "St. Xavier's",
    courseOrStream: "General",
    expectedCompletionYear: 2028,
    notes: "Loves math",
    sortOrder: 0,
  });
});

test("toFamilyMember does not leak userId/createdAt/updatedAt", () => {
  const row = {
    id: "123e4567-e89b-12d3-a456-426614174001",
    userId: "user-secret",
    name: "Bob",
    relationship: "spouse" as const,
    dateOfBirth: null,
    educationStage: null,
    institution: null,
    courseOrStream: null,
    expectedCompletionYear: null,
    notes: null,
    sortOrder: 1,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
  };

  const result = toFamilyMember(row);

  assert.equal("userId" in result, false);
  assert.equal("createdAt" in result, false);
  assert.equal("updatedAt" in result, false);
});

test("toFamilyMember passes through null fields", () => {
  const row = {
    id: "123e4567-e89b-12d3-a456-426614174002",
    userId: "user-456",
    name: "Charlie",
    relationship: "parent" as const,
    dateOfBirth: null,
    educationStage: null,
    institution: null,
    courseOrStream: null,
    expectedCompletionYear: null,
    notes: null,
    sortOrder: 2,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
  };

  const result = toFamilyMember(row);

  assert.equal(result.dateOfBirth, null);
  assert.equal(result.educationStage, null);
  assert.equal(result.institution, null);
  assert.equal(result.courseOrStream, null);
  assert.equal(result.expectedCompletionYear, null);
  assert.equal(result.notes, null);
});

test("UserProfileSchema accepts null dateOfBirth", () => {
  const valid = UserProfileSchema.parse({ dateOfBirth: null });
  assert.deepEqual(valid, { dateOfBirth: null });
});

test("UserProfileSchema accepts ISO date string", () => {
  const valid = UserProfileSchema.parse({ dateOfBirth: "1990-05-15" });
  assert.deepEqual(valid, { dateOfBirth: "1990-05-15" });
});

test("UserProfileSchema rejects non-ISO date", () => {
  assert.throws(() => UserProfileSchema.parse({ dateOfBirth: "15-05-1990" }));
  assert.throws(() => UserProfileSchema.parse({ dateOfBirth: "not-a-date" }));
});

test("UpdateUserProfileSchema is same as UserProfileSchema", () => {
  const valid = UpdateUserProfileSchema.parse({ dateOfBirth: "1985-12-20" });
  assert.deepEqual(valid, { dateOfBirth: "1985-12-20" });
});

test("CreateFamilyMemberSchema applies null defaults", () => {
  const minimal = CreateFamilyMemberSchema.parse({
    name: "Dave",
    relationship: "sibling",
  });
  assert.equal(minimal.dateOfBirth, null);
  assert.equal(minimal.educationStage, null);
  assert.equal(minimal.institution, null);
  assert.equal(minimal.courseOrStream, null);
  assert.equal(minimal.expectedCompletionYear, null);
  assert.equal(minimal.notes, null);
});

test("UpdateFamilyMemberSchema rejects expectedCompletionYear out of range", () => {
  assert.throws(() =>
    UpdateFamilyMemberSchema.parse({ expectedCompletionYear: 1949 }),
  );
  assert.throws(() =>
    UpdateFamilyMemberSchema.parse({ expectedCompletionYear: 2101 }),
  );
});

test("UpdateFamilyMemberSchema accepts expectedCompletionYear in range", () => {
  const valid1950 = UpdateFamilyMemberSchema.parse({ expectedCompletionYear: 1950 });
  assert.equal(valid1950.expectedCompletionYear, 1950);

  const valid2100 = UpdateFamilyMemberSchema.parse({ expectedCompletionYear: 2100 });
  assert.equal(valid2100.expectedCompletionYear, 2100);

  const valid2050 = UpdateFamilyMemberSchema.parse({ expectedCompletionYear: 2050 });
  assert.equal(valid2050.expectedCompletionYear, 2050);
});

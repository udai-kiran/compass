import assert from "node:assert/strict";
import { test } from "node:test";
import { toFamilyMember, getUserProfile, updateUserProfile } from "./profile.ts";
import type { Db } from "../../../db/index.ts";
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

test("UpdateUserProfileSchema round-trips a dateOfBirth", () => {
  const input = { dateOfBirth: "1985-07-15" };
  const parsed = UpdateUserProfileSchema.parse(input);
  assert.deepEqual(parsed, { dateOfBirth: "1985-07-15" });
});

test("UpdateUserProfileSchema rejects an empty string for dateOfBirth", () => {
  const input = { dateOfBirth: "" };
  // Empty string is not a valid ISO date — the frontend must send null to clear
  assert.throws(() => UpdateUserProfileSchema.parse(input));
});

test("UpdateUserProfileSchema accepts null to clear dateOfBirth", () => {
  const input = { dateOfBirth: null };
  const parsed = UpdateUserProfileSchema.parse(input);
  assert.deepEqual(parsed, { dateOfBirth: null });
});

test("User profile DOB save/reload flow: round-trip through service layer", async () => {
  // Regression test for "DOB not saved" — ensures save + reload actually works at service layer.
  // This repo has no test DB; we use a minimal in-memory fake that models the upsert + query.

  // Fake Db that implements only the exact query shapes used by getUserProfile and updateUserProfile
  const store = new Map<string, { userId: string; dateOfBirth: string | null; updatedAt: Date }>();

  const fakeDb = {
    query: {
      userProfiles: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle where clause is internal
        findFirst: ({ where }: { where: any }) => {
          // Drizzle's eq() returns an object with queryChunks array.
          // For eq(userProfiles.userId, userId), queryChunks[3] is a Param object with .value.
          const userId = where?.queryChunks?.[3]?.value;
          const row = store.get(userId);
          return Promise.resolve(row ?? undefined);
        },
      },
    },
    insert: () => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle values type is internal
      values: (data: any) => ({
        onConflictDoUpdate: () => ({
          returning: () => {
            const existing = store.get(data.userId);
            const row = { ...data, updatedAt: existing ? new Date() : new Date() };
            store.set(data.userId, row);
            return Promise.resolve([row]);
          },
        }),
      }),
    }),
  } as unknown as Db;

  const userId = "test-user-123";
  const otherUserId = "other-user-456";

  // Save a DOB
  const saved = await updateUserProfile(fakeDb, userId, { dateOfBirth: "1985-07-15" });
  assert.deepEqual(saved, { dateOfBirth: "1985-07-15" });

  // Reload — must read back the same value
  const loaded = await getUserProfile(fakeDb, userId);
  assert.deepEqual(loaded, { dateOfBirth: "1985-07-15" });

  // Clear the DOB (set to null)
  const cleared = await updateUserProfile(fakeDb, userId, { dateOfBirth: null });
  assert.deepEqual(cleared, { dateOfBirth: null });

  // Reload after clearing — must return null, not the old value
  const loadedAfterClear = await getUserProfile(fakeDb, userId);
  assert.deepEqual(loadedAfterClear, { dateOfBirth: null });

  // Scoping: different user should not see the first user's data
  const otherProfile = await getUserProfile(fakeDb, otherUserId);
  assert.deepEqual(otherProfile, { dateOfBirth: null });
});

import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../core-schema.ts";

export const familyRelationship = pgEnum("family_relationship", [
  "self",
  "spouse",
  "child",
  "parent",
  "sibling",
  "other",
]);

export const educationStage = pgEnum("education_stage", [
  "preschool",
  "primary",
  "secondary",
  "senior_secondary",
  "undergraduate",
  "postgraduate",
  "doctorate",
  "other",
]);

export const familyMembers = pgTable(
  "family_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    relationship: familyRelationship("relationship").notNull(),
    dateOfBirth: date("date_of_birth"),
    educationStage: educationStage("education_stage"),
    institution: text("institution"),
    courseOrStream: text("course_or_stream"),
    expectedCompletionYear: integer("expected_completion_year"),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    linkedUserId: uuid("linked_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("family_members_user_idx").on(t.userId),
    uniqueIndex("family_members_linked_user_idx").on(t.linkedUserId).where(sql`linked_user_id is not null`),
  ],
);

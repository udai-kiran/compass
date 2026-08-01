import { z } from "zod";

export const UserTaskTransactionSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  date: z.iso.date(),
  merchant: z.string(),
  amountPaise: z.number().int(),
});
export type UserTaskTransaction = z.infer<typeof UserTaskTransactionSchema>;

export const UserTaskSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  notes: z.string(),
  dueDate: z.iso.date().nullable(),
  completedAt: z.iso.datetime().nullable(),
  transactionId: z.uuid().nullable(),
  transaction: UserTaskTransactionSchema.nullable(),
  /** `'user'` for ordinary tasks, `'card-due'` for card-due-materialised ones. */
  source: z.enum(["user", "card-due"]),
  /** Opaque provenance key for a generated task; null for ordinary user tasks. */
  sourceKey: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type UserTask = z.infer<typeof UserTaskSchema>;

export const CreateUserTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(4000).default(""),
  dueDate: z.iso.date().nullable().optional(),
  transactionId: z.uuid().nullable().optional(),
});
export type CreateUserTask = z.infer<typeof CreateUserTaskSchema>;

export const UpdateUserTaskSchema = z
  .object({
    title: CreateUserTaskSchema.shape.title,
    notes: CreateUserTaskSchema.shape.notes.unwrap(),
    // `dueDate`/`transactionId` are `ZodOptional<ZodNullable<...>>` on create.
    // A *single* `.unwrap()` strips only the outer ZodOptional, leaving
    // `ZodNullable<...>` (required-but-nullable) for `.partial()` below to
    // re-wrap in ZodOptional — recovering the three-state
    // absent/null/value shape. A second `.unwrap()` would additionally strip
    // ZodNullable, collapsing the type to a bare non-nullable field and
    // silently rejecting `null` at both the type and runtime level (caught by
    // this schema's own colocated test and by apps/api's user-tasks.test.ts).
    dueDate: CreateUserTaskSchema.shape.dueDate.unwrap(),
    transactionId: CreateUserTaskSchema.shape.transactionId.unwrap(),
  })
  .partial()
  .extend({ completed: z.boolean().optional() });
export type UpdateUserTask = z.infer<typeof UpdateUserTaskSchema>;

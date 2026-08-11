import { and, eq, isNull, sql } from "drizzle-orm";
import type { CreateUserTask, UpdateUserTask, UserTask } from "@compass/shared";
import type { DbOrTx } from "../../../db/index.ts";
import { transactions, userTasks } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";

type UserTaskRow = typeof userTasks.$inferSelect;

type TaskRawRow = {
  id: string;
  user_id: string;
  title: string;
  notes: string;
  due_date: string | null;
  completed_at: string | null;
  transaction_id: string | null;
  source: string;
  source_key: string | null;
  created_at: string;
  updated_at: string;
  txn_id: string | null;
  txn_date: string | null;
  txn_merchant: string | null;
  txn_account_id: string | null;
  txn_amount_paise: string | null;
};

function toUserTask(row: TaskRawRow): UserTask {
  const hasTxn = row.txn_id !== null;
  let amountPaise: number | null = null;
  if (hasTxn && row.txn_amount_paise !== null) {
    amountPaise = Number(row.txn_amount_paise);
    if (!Number.isSafeInteger(amountPaise)) {
      throw new HttpError(500, "Task transaction amount exceeded a safe integer — refusing to lose paise");
    }
  }
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    dueDate: row.due_date,
    completedAt: row.completed_at,
    transactionId: row.transaction_id,
    transaction: hasTxn
      ? {
          id: row.txn_id!,
          accountId: row.txn_account_id!,
          date: row.txn_date!,
          merchant: row.txn_merchant!,
          amountPaise: amountPaise!,
        }
      : null,
    source: row.source as UserTask["source"],
    sourceKey: row.source_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Ownership predicate applied both at write time (create/update) and to the
 * response-hydration join (see `taskQuery`) — a task's linked transaction must
 * be active (not soft-deleted) and owned by the same user, or the link is
 * rejected/hidden rather than exposed as usable. No-op if `transactionId` is
 * null/undefined (an unlinked task).
 */
export async function assertOwnedActiveTransaction(
  db: DbOrTx,
  userId: string,
  transactionId: string | null | undefined,
): Promise<void> {
  if (transactionId == null) return;
  const row = await db.query.transactions.findFirst({
    where: and(
      eq(transactions.id, transactionId),
      eq(transactions.userId, userId),
      isNull(transactions.deletedAt),
    ),
    columns: { id: true },
  });
  if (!row) throw new HttpError(404, "Transaction not found");
}

const TASK_LATERAL_QUERY = sql`
  select
    ut.id, ut.user_id, ut.title, ut.notes, ut.due_date,
    to_char(ut.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as completed_at,
    ut.transaction_id, ut.source, ut.source_key,
    to_char(ut.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
    to_char(ut.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,
    t.id as txn_id, t.date as txn_date, t.merchant as txn_merchant,
    rp.account_id as txn_account_id,
    rp.amount_paise as txn_amount_paise
  from user_tasks ut
  left join transactions t
    on t.id = ut.transaction_id
    and t.user_id = ut.user_id
    and t.deleted_at is null
  left join lateral (
    select p.account_id, p.amount_paise
    from postings p
    join accounts a on a.id = p.account_id
    where p.transaction_id = t.id and a.system_kind is null
    order by (p.amount_paise < 0) desc, p.id
    limit 1
  ) rp on t.id is not null
`;

export async function listUserTasks(db: DbOrTx, userId: string): Promise<UserTask[]> {
  const result = await db.execute(sql`
    ${TASK_LATERAL_QUERY}
    where ut.user_id = ${userId}
    order by (ut.completed_at is not null) asc,
             ut.due_date asc nulls last,
             ut.created_at desc, ut.id asc
  `);
  return (result.rows as TaskRawRow[]).map(toUserTask);
}

export async function getUserTask(db: DbOrTx, userId: string, id: string): Promise<UserTask> {
  const result = await db.execute(sql`
    ${TASK_LATERAL_QUERY}
    where ut.user_id = ${userId} and ut.id = ${id}
  `);
  if (result.rows.length === 0) throw new HttpError(404, "Task not found");
  return toUserTask(result.rows[0] as TaskRawRow);
}

export async function createUserTask(
  db: DbOrTx,
  userId: string,
  input: CreateUserTask,
): Promise<UserTask> {
  await assertOwnedActiveTransaction(db, userId, input.transactionId);
  // Explicit column whitelist, not `{ ...input, userId }` — TypeScript is not a
  // runtime boundary, and this is the one place that could otherwise let an
  // internal caller, future route, or unsafe cast smuggle `source`/`sourceKey`
  // (e.g. `source: 'card-due'`) past the Zod-stripped HTTP body. `source` and
  // `sourceKey` are deliberately absent here, so every task created through
  // this path gets the column defaults (`source: 'user'`, `sourceKey: null`).
  const rows = await db
    .insert(userTasks)
    .values({
      userId,
      title: input.title,
      notes: input.notes,
      dueDate: input.dueDate,
      transactionId: input.transactionId,
    })
    .returning();
  // A second lookup (not the insert's own returning row) so the response's
  // transaction projection is hydrated identically to list/get — creation is
  // not a hot path.
  return getUserTask(db, userId, rows[0]!.id);
}

export async function updateUserTask(
  db: DbOrTx,
  userId: string,
  id: string,
  input: UpdateUserTask,
): Promise<UserTask> {
  const { completed, transactionId, title, notes, dueDate } = input;
  if (transactionId !== undefined) await assertOwnedActiveTransaction(db, userId, transactionId);

  const values: Partial<UserTaskRow> = {};
  if (title !== undefined) values.title = title;
  if (notes !== undefined) values.notes = notes;
  if (dueDate !== undefined) values.dueDate = dueDate;
  if (transactionId !== undefined) values.transactionId = transactionId;
  // Completion is a command, not a raw timestamp — the server, never the
  // client, sets completedAt to its own current time.
  if (completed !== undefined) values.completedAt = completed ? new Date() : null;

  if (Object.keys(values).length > 0) {
    // updatedAt is only bumped when something actually changed.
    const rows = await db
      .update(userTasks)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(userTasks.id, id), eq(userTasks.userId, userId)))
      .returning({ id: userTasks.id });
    if (rows.length === 0) throw new HttpError(404, "Task not found");
  } else {
    // Empty-object PATCH: a no-op, but still 404s if the task isn't owned.
    const existing = await db.query.userTasks.findFirst({
      where: and(eq(userTasks.id, id), eq(userTasks.userId, userId)),
      columns: { id: true },
    });
    if (!existing) throw new HttpError(404, "Task not found");
  }

  return getUserTask(db, userId, id);
}

export async function deleteUserTask(db: DbOrTx, userId: string, id: string): Promise<void> {
  const rows = await db
    .delete(userTasks)
    .where(and(eq(userTasks.id, id), eq(userTasks.userId, userId)))
    .returning({ id: userTasks.id });
  if (rows.length === 0) throw new HttpError(404, "Task not found");
}

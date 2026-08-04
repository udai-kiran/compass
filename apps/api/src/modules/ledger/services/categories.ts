import { and, asc, eq } from "drizzle-orm";
import type {
  Category,
  CategoryKind,
  CategoryTreeNode,
  CreateCategory,
  UpdateCategory,
} from "@compass/shared";
import type { Db, DbOrTx } from "../../../db/index.ts";
import { categories, transactions, transactionSplits } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";

type CategoryRow = typeof categories.$inferSelect;

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    // Never surface a value the kind can't hold, even if a row went stale.
    necessity: row.kind === "income" ? null : row.necessity,
    parentId: row.parentId,
    icon: row.icon,
    color: row.color,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

export async function listCategories(db: Db, userId: string): Promise<Category[]> {
  const rows = await db.query.categories.findMany({
    where: eq(categories.userId, userId),
    orderBy: [asc(categories.sortOrder), asc(categories.name)],
  });
  return rows.map(toCategory);
}

export async function categoryTree(db: Db, userId: string): Promise<CategoryTreeNode[]> {
  const flat = await listCategories(db, userId);
  const byId = new Map<string, CategoryTreeNode>(
    flat.map((c) => [c.id, { ...c, children: [] }]),
  );
  const roots: CategoryTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId === null ? undefined : byId.get(node.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function createCategory(
  db: Db,
  userId: string,
  input: CreateCategory,
): Promise<Category> {
  const rows = await db
    .insert(categories)
    .values({
      ...input,
      // An income category has no need/want character; refuse to store one.
      necessity: input.kind === "income" ? null : input.necessity,
      userId,
    })
    .returning();
  return toCategory(rows[0]!);
}

/**
 * Return the user's category with this name+kind, creating it if absent. Used by
 * flows that must land in a well-known bucket (e.g. an EPF contribution →
 * "EPF Contribution") without forcing the user to have set it up first.
 * Matches on exact name.
 */
export async function findOrCreateCategory(
  db: DbOrTx,
  userId: string,
  name: string,
  kind: CategoryKind,
  icon: string,
): Promise<Category> {
  const existing = await db.query.categories.findFirst({
    where: and(eq(categories.userId, userId), eq(categories.name, name), eq(categories.kind, kind)),
  });
  if (existing) return toCategory(existing);
  const rows = await db.insert(categories).values({ userId, name, kind, icon }).returning();
  return toCategory(rows[0]!);
}

export async function updateCategory(
  db: Db,
  userId: string,
  id: string,
  input: UpdateCategory,
): Promise<Category> {
  if (input.parentId !== undefined && input.parentId !== null) {
    // Re-parenting must not orphan the subtree: the new parent may not be
    // the category itself or any of its descendants.
    let cursor: string | null = input.parentId;
    while (cursor !== null) {
      if (cursor === id) throw new HttpError(400, "Cannot move a category under itself");
      const parent: { parentId: string | null } | undefined =
        await db.query.categories.findFirst({
          where: and(eq(categories.id, cursor), eq(categories.userId, userId)),
          columns: { parentId: true },
        });
      if (!parent) throw new HttpError(404, "Parent category not found");
      cursor = parent.parentId;
    }
  }
  if (input.necessity !== undefined && input.necessity !== null) {
    const existing = await db.query.categories.findFirst({
      where: and(eq(categories.id, id), eq(categories.userId, userId)),
      columns: { kind: true },
    });
    if (!existing) throw new HttpError(404, "Category not found");
    if (existing.kind === "income") {
      throw new HttpError(400, "Only expense categories can be marked essential or non-essential");
    }
  }
  const { archived, ...fields } = input;
  const rows = await db
    .update(categories)
    .set({
      ...fields,
      ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }),
      updatedAt: new Date(),
    })
    .where(and(eq(categories.id, id), eq(categories.userId, userId)))
    .returning();
  if (rows.length === 0) throw new HttpError(404, "Category not found");
  return toCategory(rows[0]!);
}

/** Move all usage to another category, re-parent children, delete the source. */
export async function mergeCategory(
  db: Db,
  userId: string,
  id: string,
  intoCategoryId: string,
): Promise<void> {
  if (id === intoCategoryId) throw new HttpError(400, "Cannot merge a category into itself");
  const [source, target] = await Promise.all([
    db.query.categories.findFirst({ where: and(eq(categories.id, id), eq(categories.userId, userId)) }),
    db.query.categories.findFirst({
      where: and(eq(categories.id, intoCategoryId), eq(categories.userId, userId)),
    }),
  ]);
  if (!source || !target) throw new HttpError(404, "Category not found");
  if (source.kind !== target.kind) {
    throw new HttpError(400, "Can only merge categories of the same kind");
  }
  await db.transaction(async (tx) => {
    await tx
      .update(transactions)
      .set({ categoryId: intoCategoryId })
      .where(eq(transactions.categoryId, id));
    await tx
      .update(transactionSplits)
      .set({ categoryId: intoCategoryId })
      .where(eq(transactionSplits.categoryId, id));
    await tx
      .update(categories)
      .set({ parentId: source.parentId })
      .where(eq(categories.parentId, id));
    await tx.delete(categories).where(eq(categories.id, id));
  });
}

const DEFAULT_TREE: Array<{ name: string; kind: CategoryKind; icon: string; children?: string[] }> =
  [
    { name: "Food & Dining", kind: "expense", icon: "🍽️", children: ["Groceries", "Restaurants", "Food Delivery"] },
    { name: "Housing", kind: "expense", icon: "🏠", children: ["Rent", "Maintenance", "Home Services"] },
    { name: "Utilities", kind: "expense", icon: "💡", children: ["Electricity", "Water", "Gas", "Internet", "Mobile"] },
    { name: "Transport", kind: "expense", icon: "🚗", children: ["Fuel", "Public Transport", "Cab", "Vehicle Maintenance"] },
    { name: "Shopping", kind: "expense", icon: "🛍️", children: ["Clothing", "Electronics", "Household"] },
    { name: "Health", kind: "expense", icon: "🏥", children: ["Medicines", "Doctor", "Insurance"] },
    { name: "Entertainment", kind: "expense", icon: "🎬", children: ["Subscriptions", "Movies", "Events"] },
    { name: "Education", kind: "expense", icon: "📚" },
    { name: "Personal Care", kind: "expense", icon: "💇" },
    { name: "Travel", kind: "expense", icon: "✈️" },
    { name: "Fees & Charges", kind: "expense", icon: "🏦" },
    { name: "EMI & Loans", kind: "expense", icon: "📉" },
    { name: "Investments", kind: "expense", icon: "📈" },
    { name: "Other Expense", kind: "expense", icon: "📦" },
    { name: "Salary", kind: "income", icon: "💰" },
    { name: "Business", kind: "income", icon: "💼" },
    { name: "Interest", kind: "income", icon: "🏦" },
    { name: "Dividends", kind: "income", icon: "📈" },
    { name: "Refunds", kind: "income", icon: "↩️" },
    { name: "Other Income", kind: "income", icon: "🪙" },
  ];

/** Idempotent: creates the default tree only if the user has no categories. */
export async function seedDefaultCategories(db: DbOrTx, userId: string): Promise<void> {
  const existing = await db.query.categories.findFirst({ where: eq(categories.userId, userId) });
  if (existing) return;
  let order = 0;
  for (const root of DEFAULT_TREE) {
    const rows = await db
      .insert(categories)
      .values({ userId, name: root.name, kind: root.kind, icon: root.icon, sortOrder: order++ })
      .returning({ id: categories.id });
    const parentId = rows[0]!.id;
    let childOrder = 0;
    for (const child of root.children ?? []) {
      await db.insert(categories).values({
        userId,
        name: child,
        kind: root.kind,
        parentId,
        sortOrder: childOrder++,
      });
    }
  }
}

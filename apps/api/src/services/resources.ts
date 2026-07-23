import { and, eq } from "drizzle-orm";
import type { CreateResource, Resource, UpdateResource } from "@compass/shared";
import type { Db, DbOrTx } from "../db/index.ts";
import { resources } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";

type ResourceRow = typeof resources.$inferSelect;

function toResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    identifier: row.identifier,
    provider: row.provider,
    planName: row.planName,
    details: row.details,
    archived: row.archivedAt !== null,
  };
}

export async function assertOwnedResource(
  db: DbOrTx,
  userId: string,
  id: string | null | undefined,
): Promise<void> {
  if (id == null) return;
  const row = await db.query.resources.findFirst({
    where: and(eq(resources.id, id), eq(resources.userId, userId)),
    columns: { id: true },
  });
  if (!row) throw new HttpError(404, "Asset or connection not found");
}

export async function listResources(db: Db, userId: string): Promise<Resource[]> {
  const rows = await db.query.resources.findMany({
    where: eq(resources.userId, userId),
    orderBy: (r, { asc }) => [asc(r.archivedAt), asc(r.kind), asc(r.name)],
  });
  return rows.map(toResource);
}

export async function createResource(
  db: Db,
  userId: string,
  input: CreateResource,
): Promise<Resource> {
  const rows = await db.insert(resources).values({ ...input, userId }).returning();
  return toResource(rows[0]!);
}

export async function updateResource(
  db: Db,
  userId: string,
  id: string,
  input: UpdateResource,
): Promise<Resource> {
  const { archived, ...fields } = input;
  const values: Partial<ResourceRow> = { ...fields, updatedAt: new Date() };
  if (archived !== undefined) values.archivedAt = archived ? new Date() : null;
  const rows = await db
    .update(resources)
    .set(values)
    .where(and(eq(resources.id, id), eq(resources.userId, userId)))
    .returning();
  if (!rows[0]) throw new HttpError(404, "Asset or connection not found");
  return toResource(rows[0]);
}

export async function deleteResource(db: Db, userId: string, id: string): Promise<void> {
  const rows = await db
    .delete(resources)
    .where(and(eq(resources.id, id), eq(resources.userId, userId)))
    .returning({ id: resources.id });
  if (!rows[0]) throw new HttpError(404, "Asset or connection not found");
}

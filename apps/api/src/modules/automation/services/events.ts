import { and, desc, eq, inArray, lt, or, type SQL } from "drizzle-orm";
import type {
  AiEventDetail,
  AiEventKind,
  AiEventPage,
  AiEventStatus,
  AiEventSummary,
} from "@compass/shared";
import type { Db, DbOrTx } from "../../../db/index.ts";
import { aiEvents } from "../schema.ts";
import { emailIngestions } from "../../../db/schema.ts";
import { HttpError } from "../../../lib/errors.ts";

type Row = typeof aiEvents.$inferSelect;

export interface RecordAiEventInput {
  kind: AiEventKind;
  status: AiEventStatus;
  provider?: string;
  model?: string;
  title?: string;
  ingestionId?: string | null;
  accountId?: string | null;
  requestContext: string;
  responseRaw: string;
  latencyMs?: number | null;
  error?: string | null;
}

// Keep a single event from ballooning the table (LLM bodies can be large).
const MAX_FIELD_CHARS = 64_000;
const clamp = (s: string) => (s.length > MAX_FIELD_CHARS ? s.slice(0, MAX_FIELD_CHARS) + "\n…[truncated]" : s);

/** Best-effort log of one model call. Never throws — logging must not break a flow. */
export async function recordAiEvent(
  db: DbOrTx,
  userId: string,
  input: RecordAiEventInput,
): Promise<void> {
  try {
    await db.insert(aiEvents).values({
      userId,
      kind: input.kind,
      status: input.status,
      provider: input.provider ?? "",
      model: input.model ?? "",
      title: (input.title ?? "").slice(0, 300),
      ingestionId: input.ingestionId ?? null,
      accountId: input.accountId ?? null,
      requestContext: clamp(input.requestContext),
      responseRaw: clamp(input.responseRaw),
      latencyMs: input.latencyMs ?? null,
      error: input.error ?? null,
    });
  } catch {
    // Swallow — an event-log write must never fail the underlying operation.
  }
}

function toSummary(r: Row, ingestionStatus: string | null): AiEventSummary {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    provider: r.provider,
    model: r.model,
    title: r.title,
    ingestionId: r.ingestionId,
    ingestionStatus: ingestionStatus as AiEventSummary["ingestionStatus"],
    accountId: r.accountId,
    latencyMs: r.latencyMs,
    createdAt: r.createdAt.toISOString(),
  };
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  const [createdAt, id] = Buffer.from(cursor, "base64url").toString().split("|");
  // Validate both halves before they reach Postgres — a malformed timestamp or
  // id must be a 400, never a 500 from the driver rejecting the value.
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt)) || !UUID_RE.test(id)) {
    throw new HttpError(400, "Invalid cursor");
  }
  return { createdAt, id };
}

export async function listAiEvents(
  db: Db,
  userId: string,
  query: { kind?: AiEventKind; cursor?: string; limit: number },
): Promise<AiEventPage> {
  const conds: SQL[] = [eq(aiEvents.userId, userId) as SQL];
  if (query.kind) conds.push(eq(aiEvents.kind, query.kind) as SQL);
  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    conds.push(
      or(
        lt(aiEvents.createdAt, new Date(c.createdAt)),
        and(eq(aiEvents.createdAt, new Date(c.createdAt)), lt(aiEvents.id, c.id)),
      ) as SQL,
    );
  }
  const rows = await db
    .select()
    .from(aiEvents)
    .where(and(...conds))
    .orderBy(desc(aiEvents.createdAt), desc(aiEvents.id))
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];

  // Batch-fetch the current status for every ingestion referenced on this page (1 extra
  // query per page load, no N+1). Events with no ingestionId get ingestionStatus: null.
  const ingestionIds = page.flatMap((r) => (r.ingestionId ? [r.ingestionId] : []));
  const ingestionStatusMap = new Map<string, string>();
  if (ingestionIds.length > 0) {
    const statuses = await db
      .select({ id: emailIngestions.id, status: emailIngestions.status })
      .from(emailIngestions)
      .where(inArray(emailIngestions.id, ingestionIds));
    for (const s of statuses) ingestionStatusMap.set(s.id, s.status);
  }

  return {
    items: page.map((r) =>
      toSummary(r, r.ingestionId ? (ingestionStatusMap.get(r.ingestionId) ?? null) : null),
    ),
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export async function getAiEvent(db: Db, userId: string, id: string): Promise<AiEventDetail> {
  const row = await db.query.aiEvents.findFirst({
    where: and(eq(aiEvents.id, id), eq(aiEvents.userId, userId)),
  });
  if (!row) throw new HttpError(404, "Event not found");
  let ingestionStatus: string | null = null;
  if (row.ingestionId) {
    const [ing] = await db
      .select({ status: emailIngestions.status })
      .from(emailIngestions)
      .where(eq(emailIngestions.id, row.ingestionId));
    ingestionStatus = ing?.status ?? null;
  }
  return {
    ...toSummary(row, ingestionStatus),
    requestContext: row.requestContext,
    responseRaw: row.responseRaw,
    error: row.error,
  };
}

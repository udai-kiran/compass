import { and, eq } from "drizzle-orm";
import type { Queue } from "bullmq";
import type { Db } from "../../../db/index.ts";
import { emailIngestions } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";

/**
 * Re-enqueue extraction for one ingestion, owned by `userId`. The extractor
 * re-reads the retained raw RFC822 message (`emailIngestions.raw`'s own doc
 * comment: "retained ... so extraction is replayable"), so this is a full,
 * correct retry — not a replay of the (image-redacted, truncated) ai_events
 * snapshot. Mirrors apps/ingestor/src/index.ts's own `enqueue()`.
 */
export async function retryIngestion(
  db: Db,
  queue: Queue,
  userId: string,
  ingestionId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: emailIngestions.id, status: emailIngestions.status })
    .from(emailIngestions)
    .where(and(eq(emailIngestions.id, ingestionId), eq(emailIngestions.userId, userId)));
  if (!row) throw new HttpError(404, "Ingestion not found");
  if (row.status !== "failed") throw new HttpError(409, "Only a failed ingestion can be retried");

  // A failed job retained under this jobId (removeOnFail: 500) would otherwise
  // make queue.add() a silent no-op via BullMQ's jobId dedupe — same guard as
  // the ingestor's own enqueue().
  const existing = await queue.getJob(ingestionId);
  if (existing !== undefined) {
    const state = await existing.getState();
    if (state === "failed") await existing.remove();
  }
  await queue.add(
    "extract",
    { ingestionId },
    {
      jobId: ingestionId,
      removeOnComplete: true,
      removeOnFail: 500,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    },
  );
}

import type { AiEventKind, AiEventSummary } from "@compass/shared";

/**
 * Only these kinds carry a replayable ingestion (the extractor re-reads the
 * retained raw email). `statement_summary` is deliberately excluded even
 * though it does carry an `ingestionId`: the extractor treats it as
 * best-effort (`extractStatementSummary(...).catch(() => null)` in
 * apps/extractor/src/index.ts) precisely so its failure never fails the
 * ingestion as a whole — so a failed statement_summary event's ingestion has
 * very often already finished as "extracted", not "failed", and the retry
 * endpoint enforces that same invariant server-side (409s on anything but a
 * failed ingestion). Offering Retry there would routinely show a button that
 * 409s. `email_extract`/`statement_parse` failures are NOT swallowed this
 * way — they propagate and fail the ingestion — so for those two kinds an
 * "error" event and a "failed" ingestion do reliably go together.
 */
const RETRYABLE_KINDS: ReadonlySet<AiEventKind> = new Set(["email_extract", "statement_parse"]);

export function isRetryableEvent(
  event: Pick<AiEventSummary, "status" | "ingestionId" | "kind" | "ingestionStatus">,
): boolean {
  return (
    event.status === "error" &&
    event.ingestionId !== null &&
    RETRYABLE_KINDS.has(event.kind) &&
    event.ingestionStatus === "failed"
  );
}

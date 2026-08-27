/**
 * Pure decision logic behind {@link JsonTree}. Kept out of the component (and
 * free of React) so it's unit-testable — see date-field-commit.ts for the same
 * convention: this repo runs `node --test` with no DOM harness.
 */

/** Safe JSON.parse — used to decide whether a stored event field (request
 *  context / raw response) can be rendered as a tree instead of plain text. */
export function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text === "") return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** Only object/array values are worth a tree — a bare string/number/boolean
 *  parses fine but reads better as plain text. */
export function isTreeable(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === "object" && value !== null;
}

/** Nodes at or below this depth (root = 0) start expanded; deeper nodes start
 *  collapsed so a large extracted-entries payload doesn't open as one huge
 *  wall on first render. */
export const DEFAULT_EXPAND_DEPTH = 3;

export function isExpandedByDefault(depth: number): boolean {
  return depth < DEFAULT_EXPAND_DEPTH;
}

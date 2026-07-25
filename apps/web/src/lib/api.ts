import type { z } from "zod";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Extra options a caller can layer on top of the plain request. */
export interface RequestOptions {
  /**
   * Fail the request after this many ms instead of hanging forever. Opt-in: a
   * request that never settles leaves the caller's `isPending` stuck true, so
   * anything gating a form on it would need a reload to recover.
   */
  timeoutMs?: number;
}

const TIMEOUT_MESSAGE = "The request timed out. Please try again.";

/**
 * `fetch`, optionally bounded by a timeout. Uses `AbortSignal.timeout` when the
 * browser has it and a manual `AbortController` otherwise, and reports the abort as
 * a 408 `ApiError` so callers see a normal failure rather than a `DOMException`.
 */
async function fetchWithTimeout(
  path: string,
  init: RequestInit | undefined,
  timeoutMs: number | undefined,
): Promise<Response> {
  if (timeoutMs === undefined) return fetch(path, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(path, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) throw new ApiError(408, TIMEOUT_MESSAGE);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
  opts?: RequestOptions,
): Promise<T> {
  const res = await fetchWithTimeout(path, init, opts?.timeoutMs);
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body: unknown = await res.json();
      if (typeof body === "object" && body !== null && "message" in body) {
        message = String((body as { message: unknown }).message);
      }
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(res.status, message);
  }
  return schema.parse(await res.json());
}

export function apiGet<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return request(path, schema);
}

export function apiPost<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  return request(path, schema, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiPut<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  opts?: RequestOptions,
): Promise<T> {
  return request(
    path,
    schema,
    {
      method: "PUT",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    opts,
  );
}

export function apiPatch<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  return request(path, schema, {
    method: "PATCH",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiDelete<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return request(path, schema, { method: "DELETE" });
}

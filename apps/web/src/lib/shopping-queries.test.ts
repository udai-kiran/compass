import { test } from "node:test";
import assert from "node:assert/strict";
import { shoppingUnitsQuery, useShoppingUnits } from "./shopping-queries.ts";
import { ApiError } from "./api.ts";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("shoppingUnitsQuery has the correct queryKey and staleTime", () => {
  assert.deepEqual(shoppingUnitsQuery.queryKey, ["shopping", "units"]);
  assert.equal(shoppingUnitsQuery.staleTime, Infinity);
});

test("shoppingUnitsQuery.queryFn resolves with all three units and calls the correct path", async (t) => {
  const original = globalThis.fetch;
  let capturedUrl: string | undefined;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = ((url: string) => {
    capturedUrl = url;
    return Promise.resolve(
      jsonResponse({
        units: [
          { unit: "g", kind: "mass", label: "gram" },
          { unit: "ml", kind: "volume", label: "millilitre" },
          { unit: "piece", kind: "count", label: "piece" },
        ],
      }),
    );
  }) as unknown as typeof globalThis.fetch;

  const result = await shoppingUnitsQuery.queryFn();
  assert.equal(result.units.length, 3);
  assert.deepEqual(result.units[0], { unit: "g", kind: "mass", label: "gram" });
  assert.deepEqual(result.units[1], { unit: "ml", kind: "volume", label: "millilitre" });
  assert.deepEqual(result.units[2], { unit: "piece", kind: "count", label: "piece" });
  assert.equal(capturedUrl, "/api/shopping/units", "queryFn must call /api/shopping/units");
});

test("shoppingUnitsQuery.queryFn rejects with a validation error (not ApiError) when the server returns a non-canonical unit", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = (() =>
    Promise.resolve(
      jsonResponse({
        units: [{ unit: "kg", kind: "mass", label: "kilogram" }],
      }),
    )) as unknown as typeof globalThis.fetch;

  await assert.rejects(
    () => shoppingUnitsQuery.queryFn(),
    (err: unknown) => {
      assert.ok(err instanceof Error, "must reject with an Error");
      // A transport failure surfaces as ApiError; a schema validation failure does not.
      // This distinguishes the two failure modes.
      assert.ok(!(err instanceof ApiError), "must be a validation error, not an ApiError");
      // Tighten to confirm it is specifically a Zod validation error, not any
      // arbitrary non-ApiError (e.g. a TypeError would otherwise satisfy the
      // above). zod is not a direct dep of apps/web so we use the name check
      // rather than `instanceof ZodError` to avoid an undeclared import.
      assert.equal((err as { name?: string }).name, "ZodError", "must be a ZodError, not some other error type");
      const errAsAny = err as unknown as { issues?: unknown[] };
      assert.ok(
        Array.isArray(errAsAny.issues) && errAsAny.issues.length > 0,
        "ZodError must have a non-empty issues array",
      );
      return true;
    },
  );
});

test("useShoppingUnits is a function (hook export guard)", () => {
  assert.equal(typeof useShoppingUnits, "function");
});

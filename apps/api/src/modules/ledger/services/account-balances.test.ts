import { test } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { accountBalancesAtDate } from "./accounts.ts";
import { HttpError } from "../../../lib/errors.ts";

test("accountBalancesAtDate returns typed balances and passes correct params", async () => {
  const captured: unknown[] = [];
  const stub = {
    execute: (q: unknown) => {
      captured.push(q);
      return Promise.resolve({
        rows: [
          { type: "bank", posting_total: "100000" },
          { type: "loan", posting_total: "0" },
        ],
      });
    },
  };

  const result = await accountBalancesAtDate(stub as never, "user-1", "2026-07-25");

  assert.deepEqual(result, [
    { type: "bank", balancePaise: 100000 },
    { type: "loan", balancePaise: 0 },
  ]);

  const { params } = new PgDialect().sqlToQuery(captured[0] as SQL);
  const stringParams = params.filter(
    (p: unknown): p is string => typeof p === "string",
  );
  assert.equal(params.length, 3, "the query must bind exactly three params");
  assert.deepEqual(stringParams, ["user-1", "2026-07-25", "user-1"]);
});

test("accountBalancesAtDate throws a 500 when the posting aggregate exceeds a safe integer", async () => {
  const stub = {
    execute: () =>
      Promise.resolve({
        rows: [{ type: "investment", posting_total: "9007199254740993" }],
      }),
  };

  await assert.rejects(
    () => accountBalancesAtDate(stub as never, "user-1", "2026-07-25"),
    (err: unknown) =>
      err instanceof HttpError &&
      err.statusCode === 500 &&
      /safe integer/.test(err.message),
    "an out-of-range posting aggregate must be refused, not silently rounded",
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { accountBalancesAtDate } from "./accounts.ts";

test("accountBalancesAtDate returns typed balances and passes correct params", async () => {
  const captured: unknown[] = [];
  const stub = {
    execute: (q: unknown) => {
      captured.push(q);
      return Promise.resolve({
        rows: [
          { type: "bank", balance: "150000" },
          { type: "loan", balance: "-2500000" },
          { type: "investment", balance: "9007199254740993" },
        ],
      });
    },
  };

  const result = await accountBalancesAtDate(stub as never, "user-1", "2026-07-25");

  assert.deepEqual(result, [
    { type: "bank", balancePaise: 150000 },
    { type: "loan", balancePaise: -2500000 },
    { type: "investment", balancePaise: Number("9007199254740993") },
  ]);

  const { params } = new PgDialect().sqlToQuery(captured[0] as SQL);
  const stringParams = params.filter(
    (p: unknown): p is string => typeof p === "string",
  );
  assert.equal(params.length, 3, "the query must bind exactly three params");
  assert.deepEqual(stringParams, ["user-1", "2026-07-25", "user-1"]);
});
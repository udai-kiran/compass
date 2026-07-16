import { test } from "node:test";
import assert from "node:assert/strict";
import type { GoalAsset } from "@compass/shared";
import { groupByGoal, type GoalMeta } from "./goal-networth.ts";

function asset(over: Partial<GoalAsset>): GoalAsset {
  return {
    kind: "account",
    id: crypto.randomUUID(),
    name: "Asset",
    subtitle: "",
    valuePaise: 100000,
    goalId: null,
    ...over,
  };
}

const EDU: GoalMeta = { id: "11111111-1111-1111-1111-111111111111", name: "Education", type: "education", targetPaise: 5000000 };
const RET: GoalMeta = { id: "22222222-2222-2222-2222-222222222222", name: "Retirement", type: "retirement", targetPaise: null };

test("assets group under their goal; untagged fall to Unassigned", () => {
  const groups = groupByGoal(
    [
      asset({ goalId: EDU.id, valuePaise: 467324 }),
      asset({ goalId: EDU.id, valuePaise: 100239 }),
      asset({ goalId: RET.id, valuePaise: 890000 }),
      asset({ goalId: null, valuePaise: 9611 }),
    ],
    [EDU, RET],
  );
  assert.equal(groups.length, 3); // Education, Retirement, Unassigned
  const edu = groups.find((g) => g.goalId === EDU.id)!;
  assert.equal(edu.items.length, 2);
  assert.equal(edu.netPaise, 567563);
  const unassigned = groups.at(-1)!;
  assert.equal(unassigned.goalId, null);
  assert.equal(unassigned.goalName, "Unassigned");
  assert.equal(unassigned.netPaise, 9611);
});

test("every goal appears even with nothing tagged, so its target stays visible", () => {
  const groups = groupByGoal([], [EDU, RET]);
  assert.equal(groups.length, 2); // no Unassigned when nothing is untagged
  assert.equal(groups[0]!.items.length, 0);
  assert.equal(groups[0]!.netPaise, 0);
  assert.equal(groups[0]!.targetPaise, 5000000);
});

test("liabilities subtract, so a group nets to assets minus debts", () => {
  // A house goal holding the home value and the loan against it.
  const HOUSE: GoalMeta = { id: "33333333-3333-3333-3333-333333333333", name: "House", type: "home", targetPaise: null };
  const groups = groupByGoal(
    [
      asset({ goalId: HOUSE.id, valuePaise: 5000000 }),
      asset({ goalId: HOUSE.id, kind: "account", valuePaise: -2000000 }),
    ],
    [HOUSE],
  );
  const g = groups[0]!;
  assert.equal(g.assetsPaise, 5000000);
  assert.equal(g.liabilitiesPaise, 2000000);
  assert.equal(g.netPaise, 3000000);
});

test("an asset tagged to a deleted/unknown goal falls back to Unassigned, not lost", () => {
  const groups = groupByGoal([asset({ goalId: "99999999-9999-9999-9999-999999999999", valuePaise: 5000 })], [EDU]);
  const unassigned = groups.find((g) => g.goalId === null)!;
  assert.equal(unassigned.netPaise, 5000);
});

test("Unassigned is omitted when everything is tagged", () => {
  const groups = groupByGoal([asset({ goalId: EDU.id })], [EDU]);
  assert.ok(groups.every((g) => g.goalId !== null));
});

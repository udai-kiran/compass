## Verdict

The plan is sound and ready to implement. I found no correctness issue that must be fixed first.

The proposed production change fully addresses the local/UTC mismatch for the actual inputs used by `demo.ts`, including negative `monthsAgo`. The companion test change is justified. I have two minor test-quality recommendations, but neither blocks implementation.

## Findings

### 1. Root-cause diagnosis is correct

`Date.prototype.setDate()` and `setMonth()` operate on local calendar components. `toISOString()` serializes the resulting instant in UTC.

Under `TZ=Asia/Kolkata`, for example:

- Local `2026-08-02 00:00` is UTC `2026-08-01 18:30`.
- The current function sets the local calendar date to August 1 while retaining local midnight.
- That instant is UTC July 31 at 18:30.
- `toISOString().slice(0, 10)` therefore returns `2026-07-31`.

The same behavior persists through local 05:29 and stops at 05:30, when the corresponding UTC instant reaches midnight. I reproduced the reported `31` versus `01` result from the current algorithm.

The wording is accurate for IST. More generally, the vulnerable window in a positive-offset timezone is approximately the size of that timezone’s UTC offset, rather than universally 5.5 hours.

`monthKey()` has the same defect: its local day-1 instant can serialize with the previous UTC month’s prefix.

### 2. `Date.UTC(...)` completely removes this mismatch

The proposed construction:

```ts
const now = new Date();
const year = now.getUTCFullYear();
const month = now.getUTCMonth();
return new Date(Date.UTC(year, month - monthsAgo, day))
  .toISOString()
  .slice(0, 10);
```

uses UTC fields for both:

- Selecting the current calendar month.
- Constructing and serializing the target date.

There is no intervening local-time operation, so process timezone and local wall-clock hour cannot shift the result afterward. This eliminates the local/UTC gap rather than moving it to another hour.

Negative `monthsAgo` works correctly because subtracting a negative number advances the month. The actual future-date uses—including `-2`, `-4`, `-6`, `-9`, `-20`, and `-108`—normalize correctly across year boundaries.

The change deliberately defines “current month” according to the UTC date. Thus, during the first hours of the local first day in IST, it will still consider the UTC month to be the previous month. That is consistent with the project’s established UTC ledger-day convention and is not the original defect: the returned date will belong to the selected UTC month and retain the requested day exactly.

### 3. The companion test correction is necessary

The plan’s stated test risk is real.

After the production implementation becomes UTC-based, this existing expected-value calculation remains local-based:

```ts
new Date(now.getFullYear(), now.getMonth() - 3, 15)
```

On the local first day of a month before 05:30 IST, local and UTC month fields differ. Production would correctly anchor to the UTC month, while the test would expect a result anchored to the new local month. The test could therefore fail by one month even though production behavior was correct.

Using `getUTCFullYear()`, `getUTCMonth()`, `Date.UTC(...)`, and UTC getters on the result resolves that disagreement.

A simpler and clearer assertion would compare canonical strings directly:

```ts
const now = new Date();
const expected = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 15),
)
  .toISOString()
  .slice(0, 10);

assert.equal(monthDay(3, 15), expected);
```

That verifies year, month, and requested day together and avoids parsing a date merely to compare two fields.

Both the plan’s proposed assertion and this alternative retain an extremely small live-clock race if UTC month rollover occurs between capturing `now` and `monthDay()` taking its own timestamp. A fully deterministic regression test would need an injected clock or mocked `Date`. That would be stronger, particularly because T1 mentions proving the original boundary, but it is not necessary to make this narrowly scoped fix correct.

The old comment about “anchoring to day 1 before shifting” should also be updated because the new implementation no longer uses that mutation technique.

### 4. Dropping the two-step anchoring does not introduce overflow

`Date.UTC(year, month, day)` normalizes out-of-range month values directly:

- Month `12` advances to January of the next year.
- Month `-1` becomes December of the previous year.
- Much larger positive and negative values normalize across multiple years.

I checked representative values from `-10000` through `10000` months. They normalized as expected.

Because the final requested day is supplied in the same construction, there is no intermediate “March 31 shifted into February” state. The old `setDate(1)` safeguard is unnecessary.

As with every JavaScript `Date`, astronomically large inputs can exceed the TimeClip range and produce an invalid date. That is not a practical regression here: all current inputs are small integers, with the largest magnitude being 108 months. The existing implementation was also bounded by the `Date` range.

The call sites use valid days between 1 and 25. Therefore normal day overflow, such as requesting February 31, is not relevant to existing behavior. The helper does not promise validation for arbitrary invalid `day` inputs, and the plan does not need to add it.

### 5. Call-site and regression review

All uses in `demo.ts` fit the proposed semantics:

- Historical and opening-balance transactions.
- Reward entries.
- Budgets via `monthKey(0)`.
- Insurance start and renewal dates.
- Goal target dates.
- PPF maturity.
- Holding events and valuations.
- Recurring bills and EMI dates.
- Net-worth snapshots.

No external production file calls these helpers; they are private to `demo.ts` and exported only through `_demoDates` for the unit test. The unrelated `monthKey(date)` in `holdings.ts` is a separate helper.

Every production call passes integer month offsets and a valid literal day, or passes loop integers with fixed valid days. None depends on preservation of local time, time-of-day, mutation order, or any behavior beyond selecting day N of a past or future month.

One theoretical boundary remains in any live-clock implementation: a sufficiently long seed that crosses UTC midnight on the first day of a month could calculate early and late records relative to different months because each helper call creates a fresh `Date`. That behavior already exists and is far outside the reported defect. Fixing it would require capturing one seed-wide anchor and would unnecessarily expand this task.

### 6. Project consistency and scope

The plan follows existing project conventions:

- `recurring.ts` defines `todayIso()` using `new Date().toISOString().slice(0, 10)`.
- `bills.ts` follows the same UTC-date convention.
- Nightly ledger-related jobs are explicitly pinned to `LEDGER_DAY_TZ = "Etc/UTC"`.
- `tasks/README.md` documents the 05:30 IST boundary and accepts UTC for ledger-day math while reserving IST-aware dates for India-specific legal or business deadlines.
- Other code, including recurring-date arithmetic and shared validation, already uses `Date.UTC()` with UTC getters.

These demo dates are synthetic seed data rather than India-specific statutory deadlines, so adopting the existing UTC convention is appropriate.

The `Db`/`Tx` plus `userId` service convention is irrelevant to these pure date helpers. No dependency or API restructuring is warranted.

The scope is appropriately small: two helper implementations and one related unit test. No call-site or exported-shape change is needed.

## Repository overlap

The working copies of `demo.ts` and `demo.test.ts` are not modified. Their relevant lines trace back to the original demo-mode commit, aside from an unrelated later opening-balance change elsewhere in `demo.ts`.

The repository currently reports PR #155 as the only open PR, and its file list contains neither `demo.ts` nor `demo.test.ts`. Comparing the available local and remote branch refs likewise found no branch diff against `main` for either file. I found no active conflict indication.

## Final assessment

Ready to implement as written.

Recommended non-blocking refinements:

- Replace the two-field UTC comparison with an exact `YYYY-MM-DD` string comparison.
- Update the obsolete test comment about the old day-1 mutation technique.
- If convenient, use a mocked clock for a direct regression test at an IST pre-05:30 boundary; the implementation’s correctness does not depend on adding that infrastructure.
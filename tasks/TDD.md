# TDD approach

How tasks on this board get built. This is not a generic TDD essay — it codifies what this repo already does well and makes it the default rather than an accident.

## What already exists

- **`node --test`**, no Jest or Vitest. Tests are **colocated** next to source as `*.test.ts`.
- **88 test files / 19,909 LOC of tests** against 50,384 LOC of source — a real safety net, roughly 0.4:1.
- CI runs against **real Postgres 18 and Redis**, with migrations applied before the suite. Integration tests are cheap here; there is no reason to mock a database.
- **The functional-core pattern is already the house style.** `services/goal-plan.ts` says it outright: *"Pure and DB-free so the glide-path and split math are unit-testable."* Every web route directory extracts its decision logic into a tested sibling — `repayment-eligibility.ts`, `card-warnings.ts`, `goal-date.ts`, `sip-recording.ts`, `opening-balance.ts`.

TDD on this board means leaning harder on that, not introducing anything new.

## The rule

**Every acceptance-criterion checkbox on a task is a test that is written before the code that satisfies it.**

Task files already list acceptance criteria as `- [ ]` items. Treat that list as the test plan:

1. Pick the next unchecked criterion.
2. Write a failing test that expresses it. **Run it and watch it fail** — a test that passes before the code exists is testing nothing, and this is the step people skip.
3. Write the smallest code that passes.
4. Refactor with the test green.
5. Tick the box only when its test exists and passes.

A task is done when every criterion has a corresponding test, not when the feature appears to work in the browser.

## Functional core, imperative shell

Money math, date math, allocation, tax rules and optimizers go in **pure, DB-free modules** that take plain values and return plain values. Services compose those with a `Db | Tx` handle and `userId`.

This is what makes TDD fast here. `buildGoalPlan()` needs no database, no fixtures and no mocking to test exhaustively, so it can be driven from tests at speed. `targetAllocation()` is nine lines of branching that deserves a dozen cases and costs nothing to run.

**Do not unit-test through the database what you can unit-test as a function.** If a rule is hard to test, that is usually a signal it is entangled with I/O, not a signal it needs a mock.

## What to test at each level

| Level | Use for | Example |
|---|---|---|
| **Pure unit** | All arithmetic, rules, classification, optimizers | `targetAllocation`, `standardEmiPaise`, split remainder distribution, offer-cap boundaries |
| **Service integration** | Real DB, real transactions, scoping | `withSharing()` isolation, import commit + rollback, statement reconciliation |
| **Schema / contract** | Zod shapes shared with the web app | `packages/shared` schema tests (already exist and are `deepEqual`-strict) |
| **Invariant / property** | Anything where money must reconcile | postings sum to zero, split shares sum to the transaction, backup covers every table |
| **Characterization** | Before refactoring working code | the route-table snapshot in 0.3 |

## Money gets invariant tests, not example tests

Every acceptance criterion that says "sums to", "balances", "reconciles" or "never negative" is an **invariant**, and deserves a test that asserts it across generated inputs rather than one hand-picked case.

The ones already identified on this board:

- **Splits sum to the transaction amount** in integer paise, for equal/shares/exact — including indivisible remainders (₹100 across 3), where the leftover paise must be distributed deterministically rather than lost or invented.
- **Household balances sum to zero** across members.
- **Postings sum to zero** per transaction, if double-entry lands.
- **Allocation across goals never exceeds available surplus.**
- **Backup covers every table** — already enforced by `backup.test.ts`.

Hand-picked examples miss exactly the rounding cases that matter, and rounding cases are where money quietly disappears.

## Refactoring: characterize first

Phases 0–1 move ~102 services and 39 route modules without changing behaviour. **Write the characterization test before the move, not after.** Task 0.3's route-table snapshot is precisely this and is the highest-value guard in the release: it fails if any of the 155 URLs changes shape.

Apply the same discipline per module — capture current behaviour, move the code, prove the capture still holds. Where a service is being decomposed (`cards.ts` at 1182 lines, `sips.ts` at 1319, `inbox.ts` at 804), the existing tests are the characterization; do not rewrite them in the same commit as the split, or you lose the evidence that the split was safe.

## Tests that must fail for the right reason

Some criteria on this board are about **refusing** to do something. These need a test proving the refusal, because a feature that silently does nothing also passes a naive happy-path test:

- structured AI output **fails closed** on 2+ matching tool calls, and never falls through to prose
- `assertToolChoiceValid` throws **before any HTTP call** (assert `fetch` was never invoked)
- sending an image to ollama fails fast rather than degrading silently
- a card with unmodelled reward rules is **excluded** from comparison, not guessed at
- 80C headroom nudges are **suppressed** for new-regime users
- a missing tax rule for a date **fails loudly** rather than falling back to a neighbouring year
- non-serviceable platforms are **excluded** from basket arbitrage

## AI-touching code

The model is never in the test loop. Test the **seams**:

- prompt assembly and redaction — assert PII never reaches the request body
- the exact wire shape sent per provider (the `packages/ai` provider tests already do this)
- parsing and Zod validation against recorded fixtures of real responses, including malformed ones
- the fallback path when the model is unavailable, unparseable or disabled

`packages/ai/src/http.test.ts` already demonstrates the pattern — including the OpenRouter keep-alive padding case, which only exists because someone captured a real malformed response.

## Practical loop

```bash
node --test apps/api/src/services/goal-plan.test.ts   # one file, fast inner loop
npm run test -w apps/api                              # one workspace
npm run typecheck && npm run lint && npm run test     # before marking a task done
```

Keep the inner loop on a single pure module. Reach for the workspace run at the end of a criterion, and the full gate at the end of a task.

## What not to do

- **Do not mock the database.** CI has a real one; a mocked Drizzle chain tests your mock.
- **Do not test thin routes in isolation.** They validate with Zod and call a service; test the service and the Zod contract.
- **Do not write a test after the code and call it TDD.** The value is in watching it fail — that is the only proof the test can detect the bug it claims to guard.
- **Do not delete a failing characterization test during a refactor.** It is telling you the refactor changed behaviour, which is the entire point of having written it.

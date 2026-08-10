## Verdict

**CHANGES REQUIRED.**

The production implementation is correct and matches the approved SQL exactly. However, test completeness does not meet the task:

- **BLOCKER:** AC17’s renamed-account requirement is untested.
- **BLOCKER:** D9.6, deterministic handling of multiple real postings, is untested despite DELEGATION requiring every D9 divergence to have a test.
- **BLOCKER:** AC2’s test claims byte identity but only compares parsed fields; it would not detect quoting or line-ending changes.

DB-backed tests could not be executed without `DATABASE_URL`. Static typecheck and lint pass.

## Findings

### BLOCKER — AC2 is not actually tested byte-for-byte

The header array itself is byte-identical to the original at [backup.ts:183](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:183), matching the previous array.

But the AC2 test parses the CSV and compares fields at [backup.test.ts:1346](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1346). This would accept several byte-level regressions, including quoted headers or different row terminators. It does not prove the claimed exact raw header:

```ts
assert.equal(
  csv,
  "Date,Merchant,Amount (paise),Category,Account,Notes\r\n",
);
```

would prove it for an empty-user fixture.

### BLOCKER — AC17 is only partially covered

Archived account and category behavior is genuinely exercised at [backup.test.ts:1634](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1634), including non-null `archivedAt` fixtures at lines 1637–1648 and name assertions at lines 1660–1661.

However, AC17 also requires “a renamed account shows the new name.” No account is renamed and there is no assertion for this. The SQL would behave correctly because it reads the current `accounts.name`, but the required test is absent.

### BLOCKER — D9.6 has no test

D9 includes deterministic behavior for malformed transactions with multiple real postings: `order by p.id limit 1` selects one. The implementation has that logic at [backup.ts:157](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:157)–[166](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:166), but no test inserts multiple real postings.

DELEGATION explicitly says every D9 entry needs a test. D9.1–D9.5 are covered; D9.6 is not.

## Plan assessment

- **P1 — Implemented.** Exact two-lateral SQL at [backup.ts:151](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:151)–[182](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:182).
- **P2 — Implemented.** Null is tested before `Number()` and missing account becomes blank at [backup.ts:185](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:185)–[190](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:190).
- **P3 — Implemented.** Header array unchanged at [backup.ts:183](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:183).
- **P4 — Partially implemented.** DB-backed tests were added, but AC2, AC17 and D9.6 coverage is incomplete as described above.
- **P5 — Implemented.** Postings sourcing, split aggregation and intentional blank cases are documented at [backup.ts:126](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:126)–[148](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:148).

## Acceptance criteria

| AC | Status | Evidence |
|---|---|---|
| AC1 | Implemented | SQL uses no `t.amount_paise`, `t.account_id`, or `t.category_id`: [backup.ts:151](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:151)–[182](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:182). No dedicated test, but AC is directly inspectable. |
| AC2 | Implementation correct; test inadequate | Header at [backup.ts:183](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:183). Test parses rather than compares bytes: [backup.test.ts:1346](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1346)–[1355](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1355). |
| AC3 | Implemented and tested | Ordinary expense fixture/assertions: [backup.test.ts:1357](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1357)–[1377](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1377). |
| AC4 | Implemented and genuinely tested | Legacy bank/Food/-5000 versus posting Wallet/Transport/-8000: [backup.test.ts:1379](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1379)–[1397](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1397). |
| AC5 | Implemented and tested | Multiple counter postings and exactly one data row: [backup.test.ts:1399](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1399)–[1414](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1414). |
| AC6 | Implemented and tested | Two transfer transactions, signed amounts and own accounts: [backup.test.ts:1416](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1416)–[1446](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1446). |
| AC7 | Implemented and tested | Postings-less row retained with blank amount/account: [backup.test.ts:1448](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1448)–[1462](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1462). |
| AC8 | Implemented and tested | Live, deleted and second-user fixtures: [backup.test.ts:1464](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1464)–[1491](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1491). |
| AC9 | Implemented and tested | SQL ordering at [backup.ts:181](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:181); distinct-date test at [backup.test.ts:1493](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1493)–[1511](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1511). |
| AC10 | Not fully verified locally | `npm run typecheck` and `npm run lint` pass. DB-backed test and API suite were not run because `DATABASE_URL`/Postgres is unavailable. The hard requirement is at [backup.test.ts:334](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:334)–[347](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:347). |
| AC11 | Implemented and genuinely tested | Legacy `categoryId` remains non-null at [backup.test.ts:1517](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1517)–[1520](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1520); Clearing counter has no category and blank is asserted at lines 1522–1528. |
| AC12 | Implemented and genuinely tested | Opening transaction retains non-null legacy `categoryId` at [backup.test.ts:1534](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1534)–[1537](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1537); blank category plus real amount/account asserted at lines 1542–1547. |
| AC13 | Implemented and tested | Non-null legacy amount/account/category with no postings, followed by three blank assertions: [backup.test.ts:1448](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1448)–[1462](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1462). |
| AC14 | Implemented and tested | `collate "C"` at [backup.ts:168](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:168); reverse insertion and duplicate Food category at [backup.test.ts:1550](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1550)–[1573](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1573). |
| AC15 | Implemented and reasonably tested | Comma, quote and newline round-trip through the parser: [backup.test.ts:1575](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1575)–[1600](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1600). Blank fields are also exercised by AC7/13. |
| AC16 | Implemented and genuinely tested | Cross-tenant account/category references are inserted at [backup.test.ts:1602](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1602)–[1623](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1623), with blank assertions at lines 1624–1631. |
| AC17 | Partially implemented/tested | Archived names covered at [backup.test.ts:1634](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1634)–[1662](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1662); renamed account absent. |
| AC18 | Implemented as permitted | Existing bigint-to-`Number` behavior is explicitly accepted at [backup.ts:145](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:145)–[148](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:148). |

## SQL comparison

The SQL at [backup.ts:151](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:151)–[182](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:182) matches the exact SQL from `review-1` and P1 without deviation:

- Both independent `LEFT JOIN LATERAL` queries are present.
- Real account ownership: `a.user_id = t.user_id` at line 161.
- Counter account ownership: `ca.user_id = t.user_id` at line 173.
- Category ownership: `c.user_id = t.user_id` at line 176.
- Real-account predicate: `a.system_kind is null` at line 162.
- Counter predicate: `ca.system_kind is not null` at line 174.
- Locale-independent ordering: `order by x.name collate "C"` at line 168.
- No `archived_at` filter exists.
- `where t.user_id = ... and t.deleted_at is null` remains at line 180.
- `order by t.date desc` is preserved at line 181.
- Multiple real postings are deterministically reduced by `order by p.id limit 1` at lines 164–165.

## Mapping and CSV behavior

`Number()` is only called after an explicit null check at [backup.ts:187](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:187). A missing lateral produces SQL null, resulting in `""`; account uses the same blank treatment at line 189. Thus missing real postings produce blank Amount and Account, not zero.

Category is coalesced to blank in SQL at [backup.ts:154](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:154) and safely stringified at line 188.

`toCsv` stringifies empty strings as empty fields and quotes fields containing comma, quote, CR or LF, doubling quotes. Its behavior is at [csv.ts:141](/home/udai/common/compass/apps/api/src/lib/csv.ts:141)–[147](/home/udai/common/compass/apps/api/src/lib/csv.ts:147). The mapping never passes null into it.

The header array at [backup.ts:183](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:183) is byte-identical to the original source array.

## D9 divergence coverage

- **D9.1 split:** Covered. Two counter categories and one-row assertion at [backup.test.ts:1399](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1399)–[1414](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1414); distinct collapse additionally covered at lines 1550–1573.
- **D9.2 transfer stale category:** Covered non-vacuously. `categoryId: fx.foodId` remains set at line 1519; Clearing posting has no category at line 1524; blank asserted at line 1528.
- **D9.3 opening stale category:** Covered non-vacuously. `categoryId: fx.foodId` remains set at line 1536; Opening posting has no category at line 1540; blank asserted at line 1546.
- **D9.4 postings-less:** Covered. Legacy fields are populated at lines 1452–1455 and all three posting-derived fields are asserted blank at lines 1459–1461.
- **D9.5 drift/decoy:** Covered decisively at lines 1379–1397.
- **D9.6 multiple real postings:** **Not covered.**

## Cardinality

The split test proves one header plus exactly one data row at [backup.test.ts:1411](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1411)–[1413](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1413).

There is no row-multiplication risk in the query:

- The real lateral returns at most one row due to `limit 1`.
- The category lateral contains a scalar aggregate without grouping, so it returns exactly one row, even with zero counter postings.
- Neither lateral exposes individual counter-posting rows to the outer query.

Therefore each qualifying transaction produces exactly one outer row.

## Tenant safety

A malformed posting cannot expose another user’s account or category name because ownership is checked independently on every joined entity at [backup.ts:160](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:160)–[176](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:176). `postings` itself has no `user_id`, so these guards are necessary.

The test genuinely constructs both attack shapes and verifies blanks at [backup.test.ts:1602](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1602)–[1632](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1632). It is not vacuous.

## Scope and regression review

Within the task diff:

- `backup.ts` changes only `transactionsCsv` and its comment.
- `backup.test.ts` has 402 added lines and zero deleted lines. Existing tests were neither weakened nor deleted.
- `dumpTable`, `dumpUserTable`, `dumpDatabase`, `buildUserBackupStream`, `ALL_TABLES`, `USER_TABLES`, `LINKED_TABLES`, and `FILE_COLUMNS` were not modified.
- `restoreDump` and `restoreUserBackup` were not modified.
- The route file was not modified.

The worktree also contains unrelated task-022 changes under `apps/extractor`, but those are outside this task’s two-file diff and were not attributed to this implementation.

## AC18 judgment

Accepting existing bigint-to-`Number` behavior is reasonable for this narrowly scoped source swap. The previous implementation already converted a single unaggregated legacy amount with `Number()`. This implementation still reads one unaggregated posting amount, so it does not introduce a new overflow mode.

Task 022’s aggregate required stronger treatment because summation can exceed the safe range even when every individual stored amount is safe. That distinction is sound.

The comment’s “personal-finance amounts are within range” claim is an operational assumption rather than a database-enforced invariant—the bigint column can hold unsafe values. A guard would be stricter, but AC18 explicitly permits documented acceptance, and adding one here would change established export behavior. This is not a blocker.

## Complexity and conventions

The two lateral queries are justified by cardinality and tenant-safety requirements. There is no dead production code.

Minor issues:

- The comment saying the pg driver “returns it as a string” at [backup.ts:145](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:145) is true for raw `pg` bigint values, though the schema declares `mode: "number"` for typed Drizzle queries. Since this path uses raw `db.execute(sql...)`, the comment is defensible.
- `parseCsvRows` is a sizeable permissive test-only parser at [backup.test.ts:1268](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1268)–[1310](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1310). It does not reject malformed/unclosed quoted fields. It is acceptable for round-trip assertions but is precisely why it cannot establish byte identity for AC2.
- The AC14 comment says categories are inserted in reverse alphabetical order, while only `Zulu` is newly inserted there; Food and Transport come from the shared fixture. The posting rows are inserted Zulu, Transport, Food, which still genuinely proves output sorting.

## Verification

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `node --test apps/api/src/modules/system/services/backup.test.ts`: not run; requires unavailable `DATABASE_URL` and Postgres.
- `npm run test -w apps/api`: not run for the same DB requirement.

No DB-backed test is demonstrably vacuous, but AC2 does not prove its stated byte-level property. Based on code inspection, the new DB tests should otherwise execute successfully; AC17 and D9.6 are missing rather than failing.
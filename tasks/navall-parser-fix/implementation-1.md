# NAVAll parser fix — implementation report 1

Brief shape: **Implement**. Working directory for every command: `/work/personal/compass`.
No git operations were performed (nothing staged, committed, or otherwise touched).

## Files inspected

- `/work/personal/compass/apps/api/src/modules/investments/services/amfi.ts` (full file, 64 lines)
- `/work/personal/compass/apps/api/src/modules/investments/services/mf-import.test.ts` (test index via grep + lines 286-305 read in full)

Both files matched the brief's quoted "old text" byte-for-byte before editing, so the
replacements were applied as literal string edits.

## Files changed

1. `/work/personal/compass/apps/api/src/modules/investments/services/amfi.ts`
2. `/work/personal/compass/apps/api/src/modules/investments/services/mf-import.test.ts`

No other file was created or modified inside the repo, except this report and its
directory (`tasks/navall-parser-fix/`).

## Implementation details

`parseNavAll` now trims every field once up front and reads NAV/date anchored to the
END of the row (`parts.at(-2)` / `parts.at(-1)`) while Code and Scheme Name stay
front-anchored (`parts[0]` / `parts[3]`). The `parts.length < 6` guard, the
`Number.isInteger(code)` guard, the `Number.isFinite(nav) || nav <= 0` N.A. guard and
the `parseAmfiDate` guard are unchanged, so banners, blanks and suspended schemes still
fall away. `SchemeNav`, `NAVALL_URL`, `MONTHS`, `parseAmfiDate` and `fetchNavByCode` were
not touched.

Two tests were appended verbatim to the end of `mf-import.test.ts`; the pre-existing
six-column test ("NAVAll parser keeps scheme rows and drops banners, blanks, and N.A.")
was left exactly as it was.

## Full diff

Command: `git -C /work/personal/compass diff -- apps/api/src/modules/investments/services/amfi.ts apps/api/src/modules/investments/services/mf-import.test.ts`

```diff
diff --git a/apps/api/src/modules/investments/services/amfi.ts b/apps/api/src/modules/investments/services/amfi.ts
index 66dc45c..ff2bb1e 100644
--- a/apps/api/src/modules/investments/services/amfi.ts
+++ b/apps/api/src/modules/investments/services/amfi.ts
@@ -27,23 +27,26 @@ export function parseAmfiDate(s: string): string | null {

 /**
  * Parses AMFI's NAVAll master. Format is `;`-delimited with a header, blank
- * lines, and scheme-category banner lines interleaved between scheme rows:
- *   Scheme Code;ISIN Div Payout/Growth;ISIN Div Reinvestment;Scheme Name;NAV;Date
- * Only lines whose first field is a number and whose NAV parses are kept, so
- * banners and blanks fall away. Later duplicate codes (shouldn't happen) win.
+ * lines, and scheme-category banner lines interleaved between scheme rows.
+ * The feed started as   Code;ISINs;Scheme Name;NAV;Date   and grew an extra
+ * Plan and Option column ahead of the NAV, so column counts vary — NAV and
+ * Date are therefore read anchored to the END of the row, while Code (first)
+ * and Scheme Name (fourth) are read from the FRONT, the two ends that have
+ * stayed put. Only lines whose first field is a number and whose NAV parses
+ * are kept, so banners and blanks fall away. Later duplicate codes win.
  */
 export function parseNavAll(text: string): Map<number, SchemeNav> {
   const out = new Map<number, SchemeNav>();
   for (const line of text.split("\n")) {
-    const parts = line.split(";");
+    const parts = line.split(";").map((part) => part.trim());
     if (parts.length < 6) continue;
-    const code = Number(parts[0]!.trim());
+    const code = Number(parts[0]);
     if (!Number.isInteger(code)) continue;
-    const nav = Number(parts[4]!.trim());
+    const nav = Number(parts.at(-2));
     if (!Number.isFinite(nav) || nav <= 0) continue; // "N.A." / suspended schemes
-    const date = parseAmfiDate(parts[5]!);
+    const date = parseAmfiDate(parts.at(-1) ?? "");
     if (!date) continue;
-    out.set(code, { nav, date, name: parts[3]!.trim() });
+    out.set(code, { nav, date, name: parts[3] ?? "" });
   }
   return out;
 }
diff --git a/apps/api/src/modules/investments/services/mf-import.test.ts b/apps/api/src/modules/investments/services/mf-import.test.ts
index 313ee19..5608603 100644
--- a/apps/api/src/modules/investments/services/mf-import.test.ts
+++ b/apps/api/src/modules/investments/services/mf-import.test.ts
@@ -303,3 +303,30 @@ test("NAVAll parser keeps scheme rows and drops banners, blanks, and N.A.", () =
   assert.equal(m.get(122639)?.date, "2026-07-15");
   assert.equal(m.has(999999), false);
 });
+
+test("NAVAll rows in the current eight-column format parse", () => {
+  // Aug 2026: AMFI added Plan and Option columns ahead of the NAV. With the
+  // old fixed index 4 for NAV this row parsed as garbage and every holding's
+  // refresh failed with "no parseable NAVs".
+  const feed = [
+    "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date",
+    "",
+    "Open Ended Schemes(Debt Scheme - Banking and PSU Fund)",
+    "",
+    "Aditya Birla Sun Life Mutual Fund",
+    "",
+    "119551;INF209KA12Z1;INF209KA13Z9;Aditya Birla Sun Life Banking & PSU Debt Fund;Direct Plan;IDCW-Re-investment;106.9419;25-Aug-2026",
+    "999999;INF000000000;;Suspended Fund;Regular Plan;Growth;N.A.;25-Aug-2026",
+  ].join("\n");
+  const m = parseNavAll(feed);
+  assert.equal(m.size, 1);
+  assert.equal(m.get(119551)?.nav, 106.9419);
+  assert.equal(m.get(119551)?.date, "2026-08-25");
+  assert.equal(m.get(119551)?.name, "Aditya Birla Sun Life Banking & PSU Debt Fund");
+  assert.equal(m.has(999999), false); // N.A. NAV still dropped
+});
+
+test("an over-short or empty row never throws in the parser", () => {
+  assert.equal(parseNavAll("1;2;3").size, 0);
+  assert.equal(parseNavAll("").size, 0);
+});
```

`git status --porcelain` (unstaged; the two untracked entries predate this task):

```
 M apps/api/src/modules/investments/services/amfi.ts
 M apps/api/src/modules/investments/services/mf-import.test.ts
?? AGENTS.md
?? tasks/events-retry-fix/
```

## Verification

### 1. `npm run typecheck -w apps/api`

```
> @compass/api@0.1.0 typecheck
> tsc --noEmit

EXIT=0
```

Exit code 0, no diagnostics.

### 2. `node --test apps/api/src/modules/investments/services/mf-import.test.ts`

```
✔ parses the sample transaction row (1.020214ms)
✔ the header row is ignored, not parsed as data (0.179993ms)
✔ Kuvera Save and Withdraw orders map to purchases and redemptions (0.499111ms)
✔ Kuvera SaveSmart bookkeeping rows are ignored without import errors (0.171887ms)
✔ quoted fields with embedded commas keep their columns aligned (0.311865ms)
✔ a buy or sell without valid units is skipped, not stored unitless (0.12589ms)
✔ a dividend legitimately carries no units (0.098277ms)
✔ bad rows are reported, not silently dropped (0.129256ms)
✔ scheme map resolves case- and space-insensitively (0.106252ms)
✔ an unmapped-by-design fund resolves to a null code, not to nothing (0.149334ms)
✔ no CSV name is mapped twice, and every code is 6 digits (0.157921ms)
✔ the same fund in two folios is two positions, not one merged holding (0.16783ms)
✔ rows of one fund in one folio group into a single position (0.081716ms)
✔ re-importing the same rows inserts nothing (idempotent dedupe) (0.264594ms)
✔ two genuinely identical same-day transactions are both kept (0.149435ms)
✔ a buy and sell of equal units/amount on one day stay distinct events (0.080464ms)
✔ a fuller re-import reconciles same-day order an earlier partial got wrong (0.121582ms)
✔ a narrower re-import must not disturb an already-correct same-day order (0.105241ms)
✔ a non-overlapping date starts its own intra-day sequence (0.089451ms)
✔ an import never rewrites a user's manual same-day order (0.084732ms)
✔ units held: buys add, sells subtract, dividends carry no units (0.053542ms)
✔ AMFI date parses to ISO (0.10451ms)
✔ NAVAll parser keeps scheme rows and drops banners, blanks, and N.A. (0.130058ms)
✔ NAVAll rows in the current eight-column format parse (0.083269ms)
✔ an over-short or empty row never throws in the parser (0.059473ms)
ℹ tests 25
ℹ suites 0
ℹ pass 25
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 522.691477
EXIT=0
```

Counts: 25 tests, 25 pass, 0 fail, 0 skipped, exit code 0. Both new tests appear in the
list and both pass.

### 3. Live AMFI feed proof

Fetch:

```
$ curl -sS --max-time 60 -o /tmp/navall.txt -w 'http=%{http_code} bytes=%{size_download}\n' https://portal.amfiindia.com/spages/NAVAll.txt
http=200 bytes=1510735
CURL_EXIT=0
```

Live header line (`head -1 /tmp/navall.txt`) — confirms the eight-column feed:

```
Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date
```

Parse of the real feed:

```
$ node --input-type=module -e 'const {parseNavAll} = await import("/work/personal/compass/apps/api/src/modules/investments/services/amfi.ts"); const t = await (await import("node:fs/promises")).readFile("/tmp/navall.txt","utf8"); const m = parseNavAll(t); console.log("entries:", m.size); console.log("sample:", JSON.stringify([...m.entries()].slice(0,2)));'
entries: 14049
sample: [[119551,{"nav":106.9419,"date":"2026-08-25","name":"Aditya Birla Sun Life Banking & PSU Debt Fund"}],[119552,{"nav":117.2463,"date":"2026-08-25","name":"Aditya Birla Sun Life Banking & PSU Debt Fund"}]]
```

Exit code 0. 14049 entries (brief expected roughly 14000+, definitively not 0), and the
scheme 119551 row from the brief parses to nav 106.9419 / date 2026-08-25, matching the
new unit test exactly. No stderr was emitted (stderr was merged into stdout via `2>&1`).

### 4. Extra check not named in the brief (lint on the two touched files)

```
$ npx eslint apps/api/src/modules/investments/services/amfi.ts apps/api/src/modules/investments/services/mf-import.test.ts
EXIT=0
```

No output, exit code 0. Run only to confirm the edits introduce no lint violations; the
repo-wide `npm run lint` was NOT run.

## Assumptions

- `parts.at(-2)` / `parts.at(-1)` assume NAV and Date remain the last two columns of a
  scheme row. That is what the brief specified and what today's live feed shows.
- Trailing `\r` on CRLF feed lines is absorbed by the new blanket `.trim()` on every
  field, which is at least as tolerant as the old code (which trimmed the same four
  fields it read). Nothing in the observed feed depends on this.

## Unresolved risks / gaps

- The full-suite `npm run test -w apps/api` and repo-wide `npm run typecheck` / `npm run lint`
  were not run — the brief named only the API typecheck and the single test file. If any
  other test asserts on `parseNavAll` output, it was not exercised here. A grep of the
  repo was not performed for other `parseNavAll` callers beyond `fetchNavByCode` in the
  same file and the test file.
- Behaviour change worth naming: for a genuine six-column row the name field is now read
  from `parts[3]` with a `?? ""` fallback rather than a non-null assertion, and a row with
  exactly 6 fields where the last two are NAV/Date parses identically to before. A row
  with 7+ fields whose NAV is NOT second-from-last would now be misread — no such shape
  was observed in the live feed.
- The live-feed evidence is a point-in-time observation (fetched 2026-08-27); AMFI can
  change the layout again, which is exactly the failure mode this fix hardens against but
  cannot eliminate.

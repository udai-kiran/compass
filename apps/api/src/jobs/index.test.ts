import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEDGER_DAY_SCHEDULERS, LOCAL_TIME_SCHEDULERS } from "./index.ts";

const RAW_SOURCE = readFileSync(join(import.meta.dirname, "index.ts"), "utf8");

/**
 * The same source with comments stripped, leaving string literals intact.
 *
 * The scan below is textual, so a commented-out `upsertJobScheduler(...)` would
 * otherwise satisfy it — and this file is thick with explanatory comments naming
 * these very schedulers. Only executable text may count as a registration.
 *
 * String literals are matched first and passed through unchanged, because a
 * comment-only regex cannot tell a comment from its own syntax inside a string:
 * `"https://example.com"` would lose everything from the `//` onward, and a `/*`
 * inside a string would swallow real code up to the next close. Alternation order
 * is what makes that work — the string branch consumes the text before the comment
 * branches can see it.
 */
function stripComments(source: string): string {
  return source.replace(
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (_match, stringLiteral: string | undefined) => stringLiteral ?? "",
  );
}

const SOURCE_TEXT = stripComments(RAW_SOURCE);

/**
 * Extract the options object from a named scheduler's `upsertJobScheduler` call.
 *
 * Returns the literal text of the second argument (the options object) to the
 * call whose first argument is the quoted schedulerId. Tolerates multi-line
 * option objects and comments between calls.
 */
function extractSchedulerOptions(schedulerId: string): string {
  // Find the upsertJobScheduler call for this id: match the id string, then
  // capture everything from the opening brace of the second argument to its
  // matching closing brace.
  const pattern = new RegExp(
    `upsertJobScheduler\\s*\\(\\s*["'\`]${schedulerId.replace(/\./g, "\\.")}["'\`]\\s*,\\s*(\\{[^}]*\\})`,
    "s",
  );
  const match = SOURCE_TEXT.match(pattern);
  assert.ok(match?.[1], `no upsertJobScheduler call found for "${schedulerId}"`);
  return match[1];
}

/**
 * Parse a cron pattern "M H * * *" into minutes since midnight, or null if the
 * pattern is not a simple daily one (weekly patterns have a day-of-week digit).
 */
function parseDailyCronMinutes(pattern: string): number | null {
  const m = pattern.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
  if (!m?.[1] || !m?.[2]) return null;
  const minute = parseInt(m[1], 10);
  const hour = parseInt(m[2], 10);
  return hour * 60 + minute;
}

test("every ledger-day scheduler is pinned to the shared UTC timezone", () => {
  // These handlers derive "today" via toISOString() (a UTC date), so an unpinned
  // cron stamps a date label that disagrees with the instant it ran. Under IST
  // (UTC+5:30), local 00:10 is 18:40 UTC the *previous* day — the handler would
  // file the transaction under a day that still has 5h20m left to run.
  //
  // First, assert the constant itself holds the expected literal value.
  const constantMatch = SOURCE_TEXT.match(/const\s+LEDGER_DAY_TZ\s*=\s*"([^"]+)"/);
  assert.ok(constantMatch?.[1], "LEDGER_DAY_TZ constant not found in source");
  assert.equal(constantMatch[1], "Etc/UTC", "LEDGER_DAY_TZ must be Etc/UTC");

  for (const schedulerId of LEDGER_DAY_SCHEDULERS) {
    const opts = extractSchedulerOptions(schedulerId);
    assert.ok(
      /tz:\s*LEDGER_DAY_TZ/.test(opts),
      `scheduler "${schedulerId}" must set tz: LEDGER_DAY_TZ (found options: ${opts})`,
    );
  }
});

test("schedulers with no ledger-date dependency are left on local time", () => {
  // backup.weekly only timestamps a filename — a self-hoster asking for 03:00
  // should get their own 03:00, not some offset instant.
  for (const schedulerId of LOCAL_TIME_SCHEDULERS) {
    const opts = extractSchedulerOptions(schedulerId);
    assert.ok(
      !/\btz:/.test(opts),
      `scheduler "${schedulerId}" must NOT set tz (it has no ledger-date to agree with; found options: ${opts})`,
    );
  }
});

test("the nightly chain's clock order matches its documented dependency order", () => {
  // The dependency order is: materialize recurring txns, then remind on bills/cards,
  // then snapshot net worth, then autopilot review (which reads the snapshot). That
  // ordering only holds if they all share one timezone: autopilot.review was running
  // 5h50m *before* networth.snapshot on an IST host, because one fired at local
  // 00:40 (19:10 UTC previous day) and the other at UTC 00:30.
  //
  // networth.snapshot.close runs at 00:05 and closes the PREVIOUS day, so it is
  // intentionally first but not part of the chain — verify it is earlier than
  // networth.snapshot but do not fold it into the dependency order.

  const schedules = new Map<string, number>();
  for (const id of LEDGER_DAY_SCHEDULERS) {
    const opts = extractSchedulerOptions(id);
    const patternMatch = opts.match(/pattern:\s*["']([^"']+)["']/);
    assert.ok(patternMatch?.[1], `no pattern found for "${id}"`);
    const minutes = parseDailyCronMinutes(patternMatch[1]);
    if (minutes !== null) schedules.set(id, minutes);
  }

  // The daily chain members, in dependency order (excluding the close-out).
  const chain = [
    { id: "recurring.materialize", expected: 10 },
    { id: "bills.remind", expected: 20 },
    { id: "cards.remind", expected: 25 },
    { id: "networth.snapshot", expected: 30 },
    { id: "autopilot.review", expected: 40 },
  ];

  // Assert the chain is in ascending clock order.
  for (let i = 1; i < chain.length; i++) {
    const prev = chain[i - 1]!;
    const curr = chain[i]!;
    const prevMin = schedules.get(prev.id);
    const currMin = schedules.get(curr.id);
    assert.ok(prevMin !== undefined, `${prev.id} has no daily pattern`);
    assert.ok(currMin !== undefined, `${curr.id} has no daily pattern`);
    assert.ok(
      prevMin < currMin,
      `"${prev.id}" (${prevMin}min) must run before "${curr.id}" (${currMin}min)`,
    );
  }

  // Assert each one is at the expected minute.
  for (const { id, expected } of chain) {
    const actual = schedules.get(id);
    assert.equal(actual, expected, `"${id}" must run at 00:${expected.toString().padStart(2, "0")}`);
  }

  // networth.snapshot.close (00:05) must be earlier than networth.snapshot (00:30).
  const closeMin = schedules.get("networth.snapshot.close");
  const snapshotMin = schedules.get("networth.snapshot");
  assert.ok(closeMin !== undefined, "networth.snapshot.close has no daily pattern");
  assert.ok(snapshotMin !== undefined, "networth.snapshot has no daily pattern");
  assert.equal(closeMin, 5, "networth.snapshot.close must run at 00:05");
  assert.ok(
    closeMin < snapshotMin,
    `networth.snapshot.close (${closeMin}min) must run before networth.snapshot (${snapshotMin}min)`,
  );
});

test("every scheduler in the source is classified as ledger-day or local-time", () => {
  // This makes the classification exhaustive: a new nightly job added without
  // deciding its timezone fails here rather than silently defaulting to local time.
  //
  // Extract all scheduler ids, excluding "system.heartbeat" — it uses `every:`
  // (an interval), not `pattern:` (a cron), so it has no day boundary to agree with.
  const allIds: string[] = [];
  const callPattern = /upsertJobScheduler\s*\(\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(SOURCE_TEXT)) !== null) {
    const id = match[1];
    assert.ok(id, `failed to extract scheduler id from match`);
    if (id !== "system.heartbeat") allIds.push(id);
  }

  const ledgerSet = new Set<string>(LEDGER_DAY_SCHEDULERS);
  const localSet = new Set<string>(LOCAL_TIME_SCHEDULERS);
  const classifiedSet = new Set<string>([...ledgerSet, ...localSet]);

  for (const id of allIds) {
    assert.ok(
      classifiedSet.has(id),
      `scheduler "${id}" is neither in LEDGER_DAY_SCHEDULERS nor LOCAL_TIME_SCHEDULERS`,
    );
  }

  // Verify the two sets are disjoint.
  for (const id of ledgerSet) {
    assert.ok(!localSet.has(id), `"${id}" appears in both LEDGER_DAY and LOCAL_TIME lists`);
  }
});

test("comment stripping removes commented-out registrations but keeps real ones", () => {
  // The scan is textual, so a commented-out call must not count. Both comment
  // styles, and a real call on the same line as a trailing comment.
  const stripped = stripComments(
    [
      `// await q.upsertJobScheduler("fake.line", { pattern: "0 4 * * *" });`,
      `/* await q.upsertJobScheduler("fake.block", { pattern: "0 4 * * *" }); */`,
      `await q.upsertJobScheduler("real.one", { pattern: "0 5 * * *" }); // trailing`,
    ].join("\n"),
  );

  assert.ok(!stripped.includes("fake.line"), "a line-commented registration must not survive");
  assert.ok(!stripped.includes("fake.block"), "a block-commented registration must not survive");
  assert.ok(stripped.includes("real.one"), "a real registration must survive");
  assert.ok(!stripped.includes("trailing"), "a trailing comment must be removed");
});

// ---------- AC13: cards.remind's two job paths are independent in both directions ----------

/**
 * Extract the brace-matched body of a `case "<label>": { ... }` block from the
 * (comment-stripped) source. Brace-depth-matched rather than a lazy regex, so
 * a nested `{}` inside the case (an `if` block, an object literal) can't cut
 * the match short.
 */
function extractCaseBody(caseLabel: string): string {
  const marker = `case "${caseLabel}": {`;
  const start = SOURCE_TEXT.indexOf(marker);
  assert.ok(start !== -1, `case "${caseLabel}" not found`);
  const bodyStart = start + marker.length - 1; // the opening brace itself
  let depth = 0;
  let i = bodyStart;
  do {
    if (SOURCE_TEXT[i] === "{") depth++;
    else if (SOURCE_TEXT[i] === "}") depth--;
    i++;
  } while (depth > 0 && i < SOURCE_TEXT.length);
  return SOURCE_TEXT.slice(bodyStart, i);
}

test("AC13: cards.remind wraps evaluateCardDueReminders and materializeCardDueTasks in separate try/catch blocks, so neither can suppress the other", () => {
  const body = extractCaseBody("cards.remind");
  const tryBlocks = body.match(/try\s*\{[\s\S]*?\}\s*catch[\s\S]*?\{[\s\S]*?\}/g) ?? [];
  assert.equal(tryBlocks.length, 2, `expected exactly 2 try/catch blocks in cards.remind, found ${tryBlocks.length}: ${JSON.stringify(tryBlocks)}`);

  const reminderBlock = tryBlocks.find((b) => b.includes("evaluateCardDueReminders"));
  const materializeBlock = tryBlocks.find((b) => b.includes("materializeCardDueTasks"));
  assert.ok(reminderBlock, "no try/catch block found calling evaluateCardDueReminders");
  assert.ok(materializeBlock, "no try/catch block found calling materializeCardDueTasks");
  assert.notEqual(reminderBlock, materializeBlock, "the two calls must be in separate try/catch blocks, not sharing one");
  assert.ok(!reminderBlock!.includes("materializeCardDueTasks"), "materializeCardDueTasks must not be inside the reminders' try block");
  assert.ok(!materializeBlock!.includes("evaluateCardDueReminders"), "evaluateCardDueReminders must not be inside the materializer's try block");
});

test("comment stripping does not corrupt string literals", () => {
  // A comment-only regex cannot tell a comment from its own syntax inside a
  // string. The naive version truncated `"https://x"` at the `//`, taking the rest
  // of the line — including any real registration after it — and a `/*` inside a
  // string swallowed real code up to the next close.
  const url = stripComments(`const u = "https://example.com/x"; const keep = 1;`);
  assert.ok(url.includes(`"https://example.com/x"`), "a URL string must survive intact");
  assert.ok(url.includes("const keep = 1;"), "code after a URL string must survive");

  const fakeOpener = stripComments(`const s = "/* not a comment";\nconst keep = 2;`);
  assert.ok(
    fakeOpener.includes("const keep = 2;"),
    "a block-comment opener inside a string must not swallow the code after it",
  );

  const apostrophe = stripComments(`const t = '// not a comment'; const keep = 3;`);
  assert.ok(apostrophe.includes("const keep = 3;"), "single-quoted strings are literals too");
});

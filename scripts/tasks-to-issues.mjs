#!/usr/bin/env node
/**
 * Create one GitHub issue per task file in tasks/, for manual testing and screenshot capture.
 *
 *   node scripts/tasks-to-issues.mjs --dry-run          # print what would be created
 *   node scripts/tasks-to-issues.mjs --dry-run --id 2.1 # preview one issue body
 *   node scripts/tasks-to-issues.mjs                    # create labels, milestones, issues
 *   node scripts/tasks-to-issues.mjs --only 2.0.0       # limit to one release
 *
 * Idempotent-ish: skips a task whose issue title already exists, so a re-run
 * after adding tasks only creates the new ones. Records id -> issue number in
 * tasks/.issue-map.json and runs a second pass to turn `depends` into "Blocked by #N".
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const TASKS = path.join(ROOT, "tasks");
const MAP_FILE = path.join(TASKS, ".issue-map.json");
const REPO = "udai-kiran/PennyPilot";
const BLOB = `https://github.com/${REPO}/blob/main`;

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const oneId = args.includes("--id") ? args[args.indexOf("--id") + 1] : null;

const gh = (a) => execFileSync("gh", a, { encoding: "utf8" }).trim();

function parseTask(file) {
  const raw = readFileSync(path.join(TASKS, file), "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`no frontmatter: ${file}`);
  const fm = Object.fromEntries(
    m[1].split("\n").filter(Boolean).map((l) => {
      const i = l.indexOf(": ");
      return [l.slice(0, i), l.slice(i + 2).replace(/^"|"$/g, "")];
    }),
  );
  const body = m[2];
  const depends = (fm.depends ?? "[]").replace(/[[\]]/g, "").split(",").map((s) => s.trim()).filter(Boolean);
  // description = everything before the first "## " heading, minus the UI.md banner
  const desc = body.split(/\n## /)[0].trim().replace(/^> \*\*Read[^\n]*\n+/, "").trim();
  const ac = (body.match(/## Acceptance criteria\n([\s\S]*?)(\n## |$)/) ?? [])[1]?.trim() ?? "";
  return { file, id: fm.id, title: fm.title, phase: fm.phase, release: fm.release, ui: fm.ui === "true", depends, desc, ac };
}

/** Manual-test steps, derived from the task's own acceptance criteria. */
function manualTest(t) {
  const lines = t.ac.split("\n").filter((l) => l.trim().startsWith("- [ ]"))
    .map((l) => l.replace(/^- \[ \] /, "").trim())
    // drop build gates and code-structure items — neither is manually testable
    .filter((l) => !/^typecheck|^npm run|passes$|all pass$/i.test(l))
    .filter((l) => !/tested sibling|unit-test|property test|covered by a test|enforced by test|in a tested|not JSX|no local reshaping/i.test(l));
  const head = t.ui
    ? ["`npm run dev` — check at **desktop width**", "Re-check at **narrow width** (mobile drawer, no horizontal page scroll)", "Confirm keyboard navigation and focus states"]
    : ["`npm run dev` — API on :3001, web on :5173"];
  return [...head, ...lines].map((l) => `- [ ] ${l}`).join("\n");
}

function issueBody(t, depLinks) {
  const verify = t.ui
    ? "npm run typecheck && npm run lint && npm run test -w apps/web && npm run build -w apps/web"
    : "npm run typecheck && npm run lint && npm run test";
  return `**Task file:** [\`tasks/${t.file}\`](${BLOB}/tasks/${t.file})
**Release:** \`${t.release}\` · **Phase:** ${t.phase}${t.ui ? ` · 🎨 **UI task** — read [\`tasks/UI.md\`](${BLOB}/tasks/UI.md) first` : ""}
${depLinks ? `**Blocked by:** ${depLinks}\n` : ""}
${t.desc}

## Acceptance criteria

${t.ac || "_See task file._"}

## Manual test

_Tick each once verified by hand. The task file is the source of truth — update it if reality differs._

${manualTest(t)}

## Screenshots

_Drag and drop images here._${t.ui ? " For UI tasks attach **desktop and mobile** captures, plus loading / empty / error states." : ""}

## Verification

\`\`\`bash
${verify}
\`\`\`

---
<sub>Generated from \`tasks/${t.file}\` by \`scripts/tasks-to-issues.mjs\`. Edit the task file, not this issue body.</sub>
`;
}

const files = readdirSync(TASKS).filter((f) => /^\d+\.\d+-.*\.md$/.test(f));
let tasks = files.map(parseTask).sort((a, b) => {
  const [ap, as] = a.id.split(".").map(Number), [bp, bs] = b.id.split(".").map(Number);
  return ap - bp || as - bs;
});
if (only) tasks = tasks.filter((t) => t.release === only);
if (oneId) tasks = tasks.filter((t) => t.id === oneId);

const releases = [...new Set(tasks.map((t) => t.release))].sort();
const phases = [...new Set(tasks.map((t) => t.phase))];

if (DRY) {
  if (oneId) {
    const t = tasks[0];
    if (!t) { console.error(`no task with id ${oneId}`); process.exit(1); }
    console.log(`TITLE: [${t.id}] ${t.title}`);
    console.log(`LABELS: ${["task", `release:${t.release}`, `phase:${t.phase.split(" — ")[0]}`, ...(t.ui ? ["ui"] : [])].join(", ")}`);
    console.log(`MILESTONE: ${t.release}\n${"─".repeat(72)}`);
    console.log(issueBody(t, t.depends.map((d) => `\`${d}\``).join(", ")));
  } else {
    console.log(`Would create ${tasks.length} issues across ${releases.length} milestones.`);
    console.log(`Milestones: ${releases.join(", ")}`);
    console.log(`Labels: task, ui, ${releases.map((r) => `release:${r}`).join(", ")}, ${phases.map((p) => `phase:${p.split(" — ")[0]}`).join(", ")}`);
    console.log(`UI tasks: ${tasks.filter((t) => t.ui).length}`);
    for (const t of tasks) console.log(`  [${t.id}] ${t.title}${t.ui ? "  🎨" : ""}`);
  }
  process.exit(0);
}

// --- create labels + milestones (idempotent) ---
const ensureLabel = (name, color, desc) => {
  try { gh(["label", "create", name, "--color", color, "--description", desc, "--repo", REPO]); }
  catch { /* already exists */ }
};
ensureLabel("task", "1d76db", "Generated from tasks/");
ensureLabel("ui", "d4c5f9", "Frontend task — run via frontend-engineer");
for (const r of releases) ensureLabel(`release:${r}`, "0e8a16", `Targets ${r}`);
for (const p of phases) ensureLabel(`phase:${p.split(" — ")[0]}`, "fbca04", p);

const existingMs = JSON.parse(gh(["api", `repos/${REPO}/milestones?state=all&per_page=100`]));
for (const r of releases) {
  if (!existingMs.some((m) => m.title === r)) {
    gh(["api", `repos/${REPO}/milestones`, "-f", `title=${r}`, "-f", `description=Compass ${r}`]);
  }
}

// --- create issues ---
const existing = JSON.parse(gh(["issue", "list", "--state", "all", "--limit", "1000", "--json", "number,title", "--repo", REPO]));
const byTitle = new Map(existing.map((i) => [i.title, i.number]));
const map = existsSync(MAP_FILE) ? JSON.parse(readFileSync(MAP_FILE, "utf8")) : {};

for (const t of tasks) {
  const title = `[${t.id}] ${t.title}`;
  if (byTitle.has(title)) { map[t.id] = byTitle.get(title); console.log(`skip  #${map[t.id]} ${title}`); continue; }
  const labels = ["task", `release:${t.release}`, `phase:${t.phase.split(" — ")[0]}`, ...(t.ui ? ["ui"] : [])];
  const url = gh(["issue", "create", "--repo", REPO, "--title", title, "--body", issueBody(t, null),
    "--milestone", t.release, ...labels.flatMap((l) => ["--label", l])]);
  map[t.id] = Number(url.split("/").pop());
  console.log(`created #${map[t.id]} ${title}`);
}
writeFileSync(MAP_FILE, JSON.stringify(map, null, 2) + "\n");

// --- second pass: rewrite bodies with real "Blocked by #N" links ---
for (const t of tasks) {
  if (!t.depends.length) continue;
  const links = t.depends.map((d) => (map[d] ? `#${map[d]}` : `\`${d}\``)).join(", ");
  gh(["issue", "edit", String(map[t.id]), "--repo", REPO, "--body", issueBody(t, links)]);
}
console.log(`\ndone — ${Object.keys(map).length} issues; map written to tasks/.issue-map.json`);

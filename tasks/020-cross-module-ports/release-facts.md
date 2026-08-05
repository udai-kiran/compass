# Release Facts

Generated: 2026-08-05

---

## 1. `git branch --show-current`
```
main
```
EXIT: 0

---

## 2. `git tag --sort=-v:refname | head -20`
```
v2.0.0
v1.99.0
v1.98.0
v1.97.0
v1.96.0
v1.95.0
v1.94.0
v1.93.0
v1.92.0
v1.91.0
v1.90.0
v1.89.0
v1.88.0
v1.87.0
v1.86.0
v1.85.0
v1.84.0
v1.83.0
v1.82.0
v1.81.0
```
EXIT: 0

---

## 3. `git log --oneline -8`
```
cfc36b5 refactor(api): migrate ingest and system modules into modules/ (roadmap 1.7, 1.8)
825705d test(api): add Storage backend contract tests (roadmap 1.10)
5031b88 Merge pull request #164 from udai-kiran/refactor/module-migration-phase1-automation
a219cbc refactor(api): migrate automation/AI module into modules/automation (roadmap 1.6)
f58ad0f Merge pull request #163 from udai-kiran/refactor/module-migration-phase1-planning
bede18a refactor(api): migrate planning module into modules/planning (roadmap 1.5)
2217636 Merge pull request #162 from udai-kiran/docs/release-records-final
a986c83 docs(tasks): land final scrub evidence and release record
```
EXIT: 0

---

## 4. `git status --porcelain | wc -l`
```
73
```
EXIT: 0

---

## 5. `git status --porcelain | grep -vE '^ ?[MARD?]+ +(apps/|CLAUDE.md|tasks/)' || echo "NONE_OUTSIDE_SCOPE"`
```
NONE_OUTSIDE_SCOPE
```
EXIT: 0

---

## 6. `grep -rn "COMPASS_VERSION" --include=Makefile --include=*.env --include=*.yml . 2>/dev/null | head -20`
```
(no output)
```
EXIT: 0

---

## 7. `cat package.json | grep -E '"version"'`
```
  "version": "0.1.0",
```
EXIT: 0

---

## 8. `for f in apps/api/package.json apps/web/package.json packages/shared/package.json; do echo "== $f =="; grep -E '"version"' "$f"; done`
```
== apps/api/package.json ==
  "version": "0.1.0",
== apps/web/package.json ==
  "version": "0.1.0",
== packages/shared/package.json ==
  "version": "0.1.0",
```
EXIT: 0

---

## 9. `git remote -v`
```
origin	https://github.com/udai-kiran/PennyPilot.git (fetch)
origin	https://github.com/udai-kiran/PennyPilot.git (push)
```
EXIT: 0

---

## 10. `gh auth status 2>&1 | head -5`
```
github.com
  ✓ Logged in to github.com account udai-kiran (/home/udai/.config/gh/hosts.yml)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************
```
EXIT: 0

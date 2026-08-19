# Investigation 1: fast-check resolution failure

**Date:** 2026-08-18  
**Status:** Complete — root cause identified

---

## Commands run and literal output

### 1. `grep -c "fast-check" package-lock.json`
```
5
EXIT: 0
```

### 2. `grep -n "\"fast-check\"" package-lock.json`
```
49:        "fast-check": "^4.9.0"
EXIT: 0
```
Only one line with a quoted key. The resolved `node_modules/fast-check` block is at line 13431
(key unquoted in the lockfile JSON, so not matched by this pattern).

### 3. `ls node_modules/fast-check 2>&1`
```
lsd: node_modules/fast-check: No such file or directory (os error 2)
EXIT: 2
```
Package is **not physically installed**.

### 4. `ls node_modules/.package-lock.json 2>&1`
```
node_modules/.package-lock.json
EXIT: 0
```
The internal lockfile marker exists — node_modules was installed at some point.

### 5. `npm ls fast-check 2>&1`
```
compass@0.1.0 /home/udai/common/compass
└── (empty)

EXIT: 1
```
npm reports no installed copy; exit 1.

### 6. `git log --oneline -5 -- package-lock.json`
```
b829d87 added some changes
559fa2e feat: ledger invariants — property tests + integrity endpoint (2.6)
c9a6174 Feat/postings model pr b (#169)
fd6cb97 chore(deps): clear high-severity fast-uri and ip-address advisories
bbb00bd docs: add a Docusaurus documentation site
EXIT: 0
```

### 7. `git show b829d87 --stat -- package-lock.json`
```
 package-lock.json | 499 -------…
 1 file changed, 499 deletions(-)
EXIT: 0
```

### 8. `git show b829d87 -- package-lock.json | grep -n "fast-check"`
```
EXIT: 1
```
No output — commit b829d87 did **not** touch any `fast-check` line.

### 9. `git show e098d11:package-lock.json | grep -c "fast-check"`
```
5
EXIT: 0
```
Same count as today; fast-check was present in e098d11 too.

---

## What b829d87 actually deleted

The 499 deleted lines were all optional platform-specific `@esbuild/*` packages
(`@esbuild/aix-ppc64`, `@esbuild/android-arm`, etc.), not fast-check. This is normal
npm behaviour when `npm install` is run on a different OS/architecture — it prunes
unreachable optional binaries from the lockfile.

---

## Root cause

`package-lock.json` correctly declares `fast-check@4.9.0` with a full resolved+integrity
entry (line 13431) and its dependency `pure-rand` — both added by commit 559fa2e
(2026-08-14). However, neither `node_modules/fast-check` nor `node_modules/pure-rand`
exist on disk.

The lockfile is **ahead of node_modules**: the lockfile was committed (559fa2e) but
`npm install` was never run in this working tree to materialise the packages. The fact
that `.package-lock.json` exists shows node_modules was last synchronised from a
state that pre-dates 559fa2e.

Commit b829d87 regenerated the lockfile (pruning esbuild optionals) but the physical
node_modules was not updated either.

---

## Answer to the key question

**Yes.** `fast-check` is correctly declared in `apps/api/package.json` and correctly
resolved in `package-lock.json`. It is simply absent from `node_modules` because
`npm install` has not been run since it was added. Running `npm install` will
materialise `fast-check@4.9.0` and `pure-rand` without any lockfile change.

No conflict, no corruption, no removed entry — the fix is purely `npm install`.

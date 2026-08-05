## Summary

**Change made:** One doc-comment line in `apps/api/src/modules/planning/services/goals.ts` (line 9).

**Before:**
```
 * - `listGoals` (this file): returns all non-archived goals for a user.
```

**After:**
```
 * - `listGoals` (this file): returns all of a user's goals (including archived), ordered by sort order then creation time.
```

**Verification results:**
- ✅ `npm run typecheck` — exits 0 (all 7 workspaces)
- ✅ `npm run lint` — exits 0
- ✅ `npm run test -w apps/api` — **848 tests, 0 fail**

**Deviation on git diff:** The file `apps/api/src/modules/planning/services/goals.ts` is **untracked** (`git status` shows `??`), meaning it was already present as a new working-tree file before my edit. `git diff` shows no tracked-file change for it. The file is not a tracked file that was modified, so the diff constraint cannot fully apply — but the only change within the file is the single doc-comment line described above. No other file in the repository was touched.

# Release Status Report for feat/082-083-receipt-cart-review

## Git State

### 1. Current Branch & Commit
```
Branch: feat/082-083-receipt-cart-review
Commit: a4b0cf6b6e50ef34ba865fda67f72f87b9d836d7
Author:   udaikiran <udaikiran@outlook.com>
CommitDate: Sat Aug 22 23:46:39 2026 +0530
Message: feat(shopping): receipt loop and cart review UI (tasks 082-083)

Close the shopping loop: receipt OCR → reconcile → confirm to ledger,
with confirmed-receipt races, qty/unit pairing, and mixed-unit pantry
selection. Add the cart review screen (accept/abandon, guards, source
groups) and the review-fix pass.

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Exit code: 0**

### 2. Git Status (Dirty Files)
- **Modified:** `tasks/082-receipt-loop/DELEGATION.md`
- **Untracked (samples):** AGENTS.md, tasks/065-test-ci-agents/, tasks/066-catalog-canonicalization/*, tasks/068-photo-capture/*, tasks/069-cleanup/, tasks/070-*, tasks/071-*, tasks/072-*, tasks/073-*, tasks/074-*, tasks/075-*, tasks/076-*, tasks/077-*, tasks/078-*, tasks/079-*, tasks/080-*, tasks/081-*, tasks/084-*, tasks/085-*, tasks/086-*

**Exit code: 0**

### 3. Remote Configuration
```
origin	https://github.com/udai-kiran/PennyPilot.git (fetch)
origin	https://github.com/udai-kiran/PennyPilot.git (push)
```

**Exit code: 0**

### 4. Upstream Tracking
**Result:** No upstream configured for branch 'feat/082-083-receipt-cart-review'

**Exit code: 128** (expected — feature branch not yet pushed)

### 5. Remote Comparison (Post-Fetch)
**Commits in feat/082-083-receipt-cart-review..origin/main:**
```
a4b0cf6 feat(shopping): receipt loop and cart review UI (tasks 082-083)
```
**Count: 1 commit ahead**

**Commits in origin/main..HEAD:**
```
(empty)
```
**Count: 0 commits to pull**

**Conclusion:** Commit a4b0cf6 is NOT yet in origin/main.

### 6. Version Tags
**Latest 5:**
```
v3.6.0
v3.5.0
v3.4.0
v3.3.0
v3.2.0
```

### 7. GitHub Releases
```
v3.5.0	Latest	published 2026-08-22T05:30:19Z
v3.4.0	AI Shopper & Deals (Phase 10)	published 2026-08-22T05:06:02Z
v3.2.0	release	published 2026-08-21T08:41:37Z
v3.1.0	Health check cleanup + EPF fixes	published 2026-08-14T19:12:16Z
v2.8.16	(no title)	published 2026-08-13T02:11:53Z
```

**Note:** v3.6.0 tag exists but has no release yet.

### 8. GitHub Auth
```
Logged in to github.com account: udai-kiran (keyring)
Active account: true
Git operations protocol: https
Token scopes: gist, read:org, repo, workflow
```

**Exit code: 0**

### 9. Existing Pull Requests
**Query:** `gh pr list --head feat/082-083-receipt-cart-review`

**Result:** Empty (no PRs exist for this branch)

**Exit code: 0**

## CI/CD Configuration

### Publish Workflow (`.github/workflows/publish.yml`)
**Triggers:**
- `push.branches: [main]`
- `push.tags: ["v*"]`
- `pull_request` (build-only, no push)

**Tag Pattern:** `v*` (e.g., v3.6.0)

**What Happens After Tagging:**
1. CI runs checks (typecheck, lint, audit, test, build)
2. If checks pass, publish job builds and pushes Docker images to GHCR
3. Four apps: api, web, ingestor, extractor
4. Images tagged with:
   - Branch ref (if push to main)
   - PR ref (if pull_request)
   - Semantic version from tag (e.g., v3.6.0 → 3.6.0)
   - Major.minor (e.g., 3.6)
   - SHA (long format)
   - `latest` (if default branch)

### CI Workflow (`.github/workflows/ci.yml`)
**Triggers:**
- `push.branches: [main]`
- `pull_request`
- `workflow_call`

**No explicit release/tag triggers in this file.**

**Steps:** typecheck, lint, audit, db:migrate, test, build (web + docs)

## Release Process (from CLAUDE.md)

**Exact command sequence:**
1. **Tag locally:** `git tag vX.Y.Z` (where X.Y.Z follows semantic versioning, e.g., v3.7.0)
2. **Push tag:** `git push origin vX.Y.Z` → CI detects push.tags match `v*`
3. **CI builds & publishes:** Workflow `publish.yml` runs, pushes images to GHCR
4. **On deployment host (~infra):** bump `COMPASS_VERSION` in `.env`
5. **Redeploy:** `make update` (pulls new images, recreates containers; pennypilot-migrate auto-runs migrations)

## Summary

| Item | Status |
|------|--------|
| **Current Branch** | feat/082-083-receipt-cart-review |
| **Current Commit** | a4b0cf6 |
| **Commit in origin/main?** | NO (1 commit ahead) |
| **Existing PR for this branch?** | NO |
| **Latest Version Tag** | v3.6.0 |
| **Latest Release** | v3.5.0 (no v3.6.0 release yet) |
| **Dirty/Modified Files** | tasks/082-receipt-loop/DELEGATION.md |
| **Untracked Files** | AGENTS.md, various task directories (must NOT be committed) |
| **Branch Upstream** | None (not yet pushed) |
| **gh Auth** | Authenticated as udai-kiran, scopes: gist, read:org, repo, workflow |

## Files That Must NOT Be Included in Release

- **AGENTS.md** (untracked, likely internal scaffolding)
- **tasks/065-* through tasks/086-*** (untracked task directories and reports)
- **tasks/082-receipt-loop/DELEGATION.md** (modified but not part of the main commit)
- Any other untracked `.md` files in tasks/

## Release Command

```bash
git tag v3.7.0
git push origin v3.7.0
```

Then on the deployment host:
```bash
# Edit ~/infra/.env
COMPASS_VERSION=v3.7.0

# Redeploy
make update
```

---

**Report generated:** 2026-08-22 (investigation timestamp)

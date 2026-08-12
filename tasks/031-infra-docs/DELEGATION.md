# Sonnet Worker Delegation — Iteration 1

## Task
031-infra-docs — Explore infra on 192.168.2.183, write INFRA.md, update CLAUDE.md

## Approved Plan
- P1: SSH into 192.168.2.183 and enumerate ~/infra completely (tree, all files)
- P2: Read every file — docker-compose, Makefile, env refs, nginx/caddy/traefik config, backup scripts, cron jobs, monitoring
- P3: Write /home/udai/common/compass/INFRA.md from scratch
- P4: Update /home/udai/common/compass/CLAUDE.md — add "## Deployed infrastructure" section

## Files and Symbols
- Remote: 192.168.2.183:~/infra/** (read-only exploration)
- Local write: /home/udai/common/compass/INFRA.md (new)
- Local edit: /home/udai/common/compass/CLAUDE.md (append section only)

## Required Changes
1. Explore 192.168.2.183:~/infra with SSH — list all files, read each one
2. Create INFRA.md with sections:
   - Overview (what runs, where)
   - Directory layout of ~/infra
   - Services & ports (table: service | image | internal port | host port)
   - Volumes & persistence (named volumes, bind-mounts)
   - Networking (Docker networks, any reverse proxy)
   - Env-var reference (names only, grouped by service — no values)
   - Update / rollback flow (the `make update` and related commands)
   - Backup & restore
   - Debugging (logs, exec, health checks)
3. Update CLAUDE.md — insert after the existing "Deploy: git tag..." bullet a new top-level section:

```
## Deployed infrastructure
See `INFRA.md` for the full reference. Key facts:
- Host: 192.168.2.183, infra directory: `~/infra`
- Update: bump `COMPASS_VERSION` in `~/infra/.env` → `make update` (pulls new images, recreates containers)
- ... (fill from actual Makefile)
```

## Must Not Change
- Any file in apps/, packages/, or anywhere else in the repo
- Any configuration on the remote machine
- Must NOT include secret values (passwords, tokens, keys) in INFRA.md

## Acceptance Criteria
- AC1: INFRA.md covers every docker-compose service, with port table, volumes list
- AC2: CLAUDE.md has new "## Deployed infrastructure" section
- AC3: No secrets in INFRA.md — env var names only
- AC4: Both files are valid Markdown

## Commands
1. ssh udai@192.168.2.183 "find ~/infra -type f | sort"
2. ssh udai@192.168.2.183 "cat ~/infra/docker-compose.yml" (and any other compose files)
3. ssh udai@192.168.2.183 "cat ~/infra/Makefile"
4. ssh udai@192.168.2.183 "cat ~/infra/.env.example" (or equivalent — never .env itself)
5. ssh udai@192.168.2.183 "cat ~/infra/<any other config files found>"
6. Read /home/udai/common/compass/CLAUDE.md for the exact insertion point
7. Write /home/udai/common/compass/INFRA.md
8. Edit /home/udai/common/compass/CLAUDE.md

## Required Evidence
- Full output of `find ~/infra -type f | sort` (all files discovered)
- Content of docker-compose file(s) and Makefile (as seen via ssh)
- Diff of CLAUDE.md change (must show only the new section)
- Confirmation that INFRA.md exists and is non-empty (line count)
- Exit codes of all SSH commands

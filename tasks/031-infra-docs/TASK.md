# Task: 031-infra-docs

## Status
COMPLETE

## Objective
Explore the production infra on 192.168.2.183 at ~/infra, produce a thorough INFRA.md at the repo root, and update CLAUDE.md with a concise "Deployed infra" section pointing at INFRA.md.

## Root Cause
No infra documentation exists in the repo; devs have no written reference for how the app is hosted, what services run, what the update/deploy flow is, or how to debug it.

## Scope
- SSH exploration of 192.168.2.183:~/infra (all files)
- New file: `/home/udai/common/compass/INFRA.md`
- Updated file: `/home/udai/common/compass/CLAUDE.md` — add a short "## Deployed infrastructure" section near the Deploy bullet at the bottom

## Dependencies
None

## Plan
- P1: SSH into 192.168.2.183 and recursively enumerate ~/infra (directory tree, Makefile, docker-compose files, .env.example or env references, nginx/caddy/traefik config, backup scripts, etc.)
- P2: Read every file found, noting: services, image names/tags, port mappings, volumes, networks, env vars (names only, not values), update/rollback commands, any monitoring/alerting setup
- P3: Write INFRA.md with sections: Overview, Directory layout, Services & ports, Volumes & persistence, Networking, Env-var reference, Update / rollback flow, Backup & restore, Debugging
- P4: Update CLAUDE.md — add "## Deployed infrastructure" section after the existing Deploy bullet referencing INFRA.md, and note the host IP / Makefile commands

## Acceptance Criteria
- AC1: INFRA.md exists, covers all services visible in docker-compose, volumes, port mapping, and the `make update` flow
- AC2: CLAUDE.md has a new "## Deployed infrastructure" section
- AC3: No secrets/values in INFRA.md — env var names only
- AC4: Both files are valid Markdown with no broken references

## Verification
- T1: Both files present and non-empty
- T2: INFRA.md references every service found in docker-compose
- T3: CLAUDE.md diff shows only the new section appended, nothing else changed

## Non-Goals
- Changing any infra configuration
- Documenting dev-only workflow beyond what's already in CLAUDE.md

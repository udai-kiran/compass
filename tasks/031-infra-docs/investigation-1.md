# Investigation 1 — Remote Infra Facts (192.168.2.183)

**Date:** 2026-08-11

---

## Container name note

The brief asked about `pennypilot-postgres` and `pennypilot-minio`, but those containers do **not exist** on the host — only their `-dev` variants are running. Commands 2–6 were therefore run against `pennypilot-postgres-dev` and `pennypilot-minio-dev` respectively, which use the same image/config as the prod compose file describes. The merged compose config (command 7) targets the non-dev names, confirming prod has never been deployed here yet.

---

## Command 1 — `cat ~/infra/pennypilot/docker-compose.yml` (postgres block only)

**Exit code: 0**

Relevant postgres service block:

```yaml
postgres:
  image: pgvector/pgvector:pg18-trixie          # postgres 18.4 + pgvector 0.8.6
  container_name: pennypilot-postgres
  restart: unless-stopped
  command:
    - postgres
    - --shared_buffers=128MB
    - --effective_cache_size=8GB
    - --work_mem=8MB
    - --maintenance_work_mem=128MB
    - --autovacuum_work_mem=64MB
    - --max_connections=50
    - --max_worker_processes=4
    - --max_parallel_workers=2
    - --max_parallel_workers_per_gather=1
    - --max_parallel_maintenance_workers=1
    - --random_page_cost=2
    - --effective_io_concurrency=1
    - --jit=off
    - --log_min_duration_statement=1000
  oom_score_adj: -500
  environment:
    POSTGRES_USER: ${COMPASS_DB_USER:-compass}
    POSTGRES_PASSWORD: ${COMPASS_DB_PASSWORD:?set COMPASS_DB_PASSWORD in .env}
    POSTGRES_DB: ${COMPASS_DB_NAME:-compass}
    POSTGRES_INITDB_ARGS: "--encoding=UTF8"
    TZ: ${TZ:-Etc/UTC}
  # Comment in file: "DO NOT fix this to /var/lib/postgresql/data.
  # Postgres 18 moved the default to PGDATA=/var/lib/postgresql/18/docker"
  volumes:
    - pgdata:/var/lib/postgresql
  stop_grace_period: 30s
  networks:
    pennypilot_net:
      ipv4_address: 172.31.0.8
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U ${COMPASS_DB_USER:-compass} -d ${COMPASS_DB_NAME:-compass}"]
    interval: 10s
    timeout: 5s
    retries: 10
    start_period: 30s
```

Key facts:
- **No PGDATA env var is set** in the compose file — Postgres 18 image default applies.
- Volume mounts named volume `pgdata` at `/var/lib/postgresql` (not the legacy `/var/lib/postgresql/data`).

---

## Command 2 — `docker inspect pennypilot-postgres --format ... | grep -i pgdata`

**Actual command run:** against `pennypilot-postgres-dev` (prod container does not exist)
**Exit code: 0**

```
PGDATA=/var/lib/postgresql/18/docker
```

The image bakes in `PGDATA=/var/lib/postgresql/18/docker`. It is NOT set in the compose file; this is the Postgres 18 image default.

---

## Command 3 — `docker inspect pennypilot-postgres --format '{{range .Mounts}}...'`

**Actual command run:** against `pennypilot-postgres-dev`
**Exit code: 0**

```
volume infra-dev_pgdata /var/lib/docker/volumes/infra-dev_pgdata/_data -> /var/lib/postgresql
```

- Type: `volume` (named, not bind-mount)
- Volume name on dev: `infra-dev_pgdata` (Docker prefixes with project name `infra-dev`)
- Host path: `/var/lib/docker/volumes/infra-dev_pgdata/_data`
- Container mount point: `/var/lib/postgresql`

For prod deployment, the volume name will be `infra_pgdata` (project name `infra`).

---

## Command 4 — `docker exec pennypilot-postgres ls -la /var/lib/postgresql/`

**Actual command run:** against `pennypilot-postgres-dev`
**Exit code: 0**

```
total 12
drwxrwxrwt 3 postgres postgres 4096 Aug 11 10:18 .
drwxr-xr-x 1 root     root     4096 Jul 29 19:12 ..
drwxr-xr-x 3 root     root     4096 Aug 11 10:18 18
```

Only one subdirectory exists: `18/`. The actual data cluster lives at `18/docker/` (i.e., full path `/var/lib/postgresql/18/docker` = PGDATA).

---

## Command 5 — `docker exec pennypilot-postgres sh -c 'echo $PGDATA'`

**Actual command run:** against `pennypilot-postgres-dev`
**Exit code: 0**

```
/var/lib/postgresql/18/docker
```

Confirms: the live PGDATA inside the container is `/var/lib/postgresql/18/docker`.

---

## Command 6 — `docker inspect pennypilot-minio --format '{{range .Mounts}}...'`

**Actual command run:** against `pennypilot-minio-dev`
**Exit code: 0**

```
volume infra-dev_minio_data /var/lib/docker/volumes/infra-dev_minio_data/_data -> /data
```

- Type: `volume` (named)
- Volume name on dev: `infra-dev_minio_data`
- Host path: `/var/lib/docker/volumes/infra-dev_minio_data/_data`
- Container mount point: `/data`

For prod deployment, the volume name will be `infra_minio_data`.

---

## Command 7 — `docker compose ... config | grep -A 30 'postgres:'`

**Exit code: 0**

Full merged postgres service block from `docker compose config`:

```yaml
  postgres:
    command:
      - postgres
      - --shared_buffers=128MB
      - --effective_cache_size=8GB
      - --work_mem=8MB
      - --maintenance_work_mem=128MB
      - --autovacuum_work_mem=64MB
      - --max_connections=50
      - --max_worker_processes=4
      - --max_parallel_workers=2
      - --max_parallel_workers_per_gather=1
      - --max_parallel_maintenance_workers=1
      - --random_page_cost=2
      - --effective_io_concurrency=1
      - --jit=off
      - --log_min_duration_statement=1000
    container_name: pennypilot-postgres
    environment:
      POSTGRES_DB: compass
      POSTGRES_INITDB_ARGS: --encoding=UTF8
      POSTGRES_PASSWORD: <redacted>
      POSTGRES_USER: compass
      TZ: Etc/UTC
    healthcheck:
      test:
        - CMD-SHELL
        - pg_isready -U compass -d compass
      timeout: 5s
      interval: 10s
      retries: 10
      start_period: 30s
    image: pgvector/pgvector:pg18-trixie
    networks:
      pennypilot_net:
        ipv4_address: 172.31.0.8
    oom_score_adj: -500
    restart: unless-stopped
    stop_grace_period: 30s
    volumes:
      - type: volume
        source: pgdata
        target: /var/lib/postgresql
        volume: {}
```

No `PGDATA` env var in the merged environment block. The image default `/var/lib/postgresql/18/docker` applies.

---

## Summary of key facts

| Fact | Value |
|------|-------|
| Postgres image | `pgvector/pgvector:pg18-trixie` (PG 18.4 + pgvector 0.8.6) |
| PGDATA (image default, live) | `/var/lib/postgresql/18/docker` |
| PGDATA set in compose | **No** — relies on image default |
| Named volume (postgres) | `pgdata` → Docker prefixes as `infra_pgdata` (prod) or `infra-dev_pgdata` (dev) |
| Volume host path (dev) | `/var/lib/docker/volumes/infra-dev_pgdata/_data` |
| Volume mount point in container | `/var/lib/postgresql` |
| Subdirs inside mount | Only `18/` exists (data at `18/docker/`) |
| Named volume (minio) | `minio_data` → `infra_minio_data` (prod) / `infra-dev_minio_data` (dev) |
| MinIO mount point | `/data` |
| Prod containers running? | **No** — only `-dev` variants are live |
| Prod compose project name | `infra` (from `~/infra/docker-compose.yml`) |

# Storage Contract Test — Environment Investigation

Date: 2026-08-05  
Investigator: worker (claude-sonnet-4-6)  
Files inspected: `apps/api/src/lib/storage.ts`, `apps/api/src/config.ts`, `.env` (keys only, no values)  
Files changed: none (investigate brief)

---

## 1. Docker available / daemon running?

```
$ docker version
Client:
 Version:           29.1.3
 API version:       1.52
 Go version:        go1.24.4
 Git commit:        29.1.3-0ubuntu3~24.04.2
 Built:             Wed Apr 29 16:41:06 2026
 OS/Arch:           linux/amd64
 Context:           default

Server:
 Engine:
  Version:          29.1.3
  API version:      1.52 (minimum version 1.44)
  Go version:       go1.24.4
  Git commit:       29.1.3-0ubuntu3~24.04.2
  Built:            Wed Apr 29 16:41:06 2026
  OS/Arch:          linux/amd64
  Experimental:     false
 containerd:
  Version:          2.2.1
  GitCommit:        
 runc:
  Version:          1.3.3-0ubuntu1~24.04.3
  GitCommit:        
 docker-init:
  Version:          0.19.0
  GitCommit:        
EXIT: 0
```

Verdict: Docker 29.1.3 available, daemon running.

---

## 2. MinIO image already pulled locally?

```
$ docker image ls | grep -i minio
WARNING: This output is designed for human readability. For machine-readable output, please use --format.
minio/minio:latest                                                                     69b2ec208575        175MB             0B   U    
quay.io/minio/mc:RELEASE.2024-11-21T17-21-54Z                                          45273e3a2aa3       79.8MB             0B        
quay.io/minio/minio:RELEASE.2024-12-18T13-15-44Z                                       6aed1b694901        179MB             0B        
EXIT: 0
```

Verdict: `minio/minio:latest` (175 MB) is already pulled locally. No pull needed to run ephemeral MinIO.

---

## 3. Running containers — is any MinIO already up?

```
$ docker ps
CONTAINER ID   IMAGE                                             COMMAND                  CREATED         STATUS                PORTS                             NAMES
64614aa2e0c9   moby/buildkit:buildx-stable-1                     "/usr/bin/buildkitd-…"   7 minutes ago   Up 7 minutes                                            buildx_buildkit_builder-81ed87bc-f99a-465f-ae54-523654be6e570
4a2fffdafc33   maximhq/bifrost:v1.5.13                           "/app/docker-entrypo…"   2 days ago      Up 2 days (healthy)                                     services-bifrost-1
dcf52198cd94   moby/buildkit:buildx-stable-1                     "/usr/bin/buildkitd-…"   5 days ago      Up 2 days                                               buildx_buildkit_pennypilot-persistent0
89dec32ff31e   rabbitmq:4.3.1-management-alpine                  "docker-entrypoint.s…"   12 days ago     Up 2 days                                               services-rabbitmq-1
c4ef71d30bef   pgvector/pgvector:0.8.2-pg18-trixie               "docker-entrypoint.s…"   2 weeks ago     Up 2 days                                               services-postgres-1
80a658704b06   redis:8.8.0-alpine                                "docker-entrypoint.s…"   6 weeks ago     Up 2 days                                               services-redis-1
e14ad7f0afcd   minio/minio:latest                                "/usr/bin/docker-ent…"   6 weeks ago     Up 2 days                                               services-minio-1
7999b1e5eb84   graphstack/dozerdb:5.26.3.0                       "tini -g -- /startup…"   6 weeks ago     Up 2 days                                               services-dozerdb-1
4d10d734e9a9   cr.weaviate.io/semitechnologies/weaviate:1.37.2   "/bin/weaviate --hos…"   6 weeks ago     Up 2 days                                               services-weaviate-1
ae86300b9dce   ghcr.io/udai-kiran/agent-mem:0.5.0                "/entrypoint.sh all"     7 weeks ago     Up 2 days                                               services-agent-mem-1
acf747b11008   6db049f808b3                                      "/usr/bin/buildkitd-…"   7 weeks ago     Up 2 days                                               buildx_buildkit_builder-53091d99-0942-465d-9ebc-7d139654b0280
a2aac2f5d724   ghcr.io/k3d-io/k3d-proxy:5.7.4                    "/bin/sh -c nginx-pr…"   3 months ago    Up 2 days             80/tcp, 0.0.0.0:44707->6443/tcp   k3d-dkubex-test-serverlb
c8f8fec14446   rancher/k3s:v1.30.4-k3s1                          "/bin/k3d-entrypoint…"   3 months ago    Up 2 days                                               k3d-dkubex-test-server-0
999f4635c375   ligfx/k3d-registry-dockerd:latest                 "k3d-registry-dockerd"   3 months ago    Up 2 days             0.0.0.0:32783->5000/tcp           k3d-dkubex-test-registry
EXIT: 0
```

Verdict: `services-minio-1` (image `minio/minio:latest`) has been up for 6 weeks. It uses `--network host` (no port bindings in PortBindings; NetworkMode=host), so it is accessible at `http://127.0.0.1:9000`.

Additional detail — `services-minio-1` credentials (from `docker inspect`):
- `MINIO_ROOT_USER=minioadmin`
- `MINIO_ROOT_PASSWORD=minioadmin`

---

## 4. `.env` file — which keys are set?

```
$ ls /home/udai/PennyPilot/.env
/home/udai/PennyPilot/.env
EXISTS: 0

$ grep -E '^(S3_|STORAGE_DIR|DATABASE_URL|SESSION_SECRET)' /home/udai/PennyPilot/.env | sed -E 's/=(.*)$/=<SET>/'
DATABASE_URL=<SET>
SESSION_SECRET=<SET>
STORAGE_DIR=<SET>
EXIT: 0
```

Verdict: `.env` exists. `DATABASE_URL`, `SESSION_SECRET`, and `STORAGE_DIR` are set. **No `S3_*` keys are present** in `.env`, meaning the app currently runs in disk-fallback mode (STORAGE_DIR path). No MinIO credentials are configured via env file.

### 4b. Shell env presence

```
$ env | grep -E '^(S3_|STORAGE_DIR|DATABASE_URL)' | sed -E 's/=(.*)$/=<SET>/'
(empty)
EXIT: 0
```

Verdict: None of the S3/STORAGE_DIR/DATABASE_URL vars are exported into the shell environment; they live only in the `.env` file.

---

## 5. Infra MinIO at 172.31.0.7:9000 reachable?

```
$ curl -sS -m 5 -o /dev/null -w '%{http_code}\n' http://172.31.0.7:9000/minio/health/live
curl: (28) Connection timed out after 5002 milliseconds
000
EXIT: 28

$ curl -sS -m 5 -o /dev/null -w '%{http_code}\n' http://172.31.0.7:9000/minio/health/ready
curl: (28) Connection timed out after 5002 milliseconds
000
EXIT: 28
```

Verdict: The infra MinIO at 172.31.0.7 is NOT reachable from this machine (both /live and /ready time out; HTTP 000 / exit 28). This is likely the remote prod/staging host (pluto 172.31.0.7 per memory). Tests must use a local backend.

**Bonus finding:** The local `services-minio-1` container (host network, port 9000) IS reachable:

```
$ curl -sS -m 5 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9000/minio/health/live
200
EXIT: 0

$ curl -sS -m 5 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9000/minio/health/ready
200
EXIT: 0
```

---

## 6. Can we launch an ephemeral local MinIO container?

```
$ docker run -d --rm --name compass-minio-probe -p 19000:9000 -e MINIO_ROOT_USER=probeuser -e MINIO_ROOT_PASSWORD=probepassword123 minio/minio server /data
31831ad7eb4a9bd92de404ef41e92819a372927a960f3b5e60febc36beab1a66
EXIT: 0

(sleep 4)

$ curl -sS -m 5 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:19000/minio/health/live
200
EXIT: 0

$ docker rm -f compass-minio-probe
compass-minio-probe
EXIT: 0
```

Verdict: Ephemeral MinIO container starts instantly (image already local), is healthy in <4 s on port 19000, and cleans up correctly. This approach is fully viable for a self-contained contract test that spins up its own MinIO.

---

## 7. Node version (DB not needed for storage test)

```
$ node -e "console.log(process.version)"
v24.18.0
EXIT: 0
```

Verdict: Node 24.18.0. No DB connection needed for storage contract tests (Storage abstraction is independent of Drizzle/Postgres).

---

## Storage abstraction surface (for test design)

Source: `apps/api/src/lib/storage.ts`

Interface:
```ts
export interface Storage {
  put(data: Buffer, contentType: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
  ensureReady(): Promise<void>;
}
```

Two concrete backends:
- `DiskStorage` — activated when `config.S3_ENDPOINT` is falsy; uses `config.STORAGE_DIR`.
- `S3Storage` — activated when `config.S3_ENDPOINT` is set; uses `@aws-sdk/client-s3`.

Factory: `createStorage(config: Config): Storage`

Config fields (from `apps/api/src/config.ts`):
- `STORAGE_DIR` — default `"./data/attachments"`
- `S3_ENDPOINT` — default `""` (empty = disk mode)
- `S3_BUCKET` — default `"compass-files"`
- `S3_REGION` — default `"us-east-1"`
- `S3_ACCESS_KEY` — default `""`
- `S3_SECRET_KEY` — default `""`
- `S3_FORCE_PATH_STYLE` — default `true` (required for MinIO path-style URLs)

No existing `storage.test.ts` file found in the repo.

---

## Summary of findings

| Item | Verdict |
|------|---------|
| Docker daemon | Available, v29.1.3 |
| MinIO image pulled | Yes — `minio/minio:latest` (175 MB) already local |
| Running MinIO container | `services-minio-1` up 6 weeks, host network, `127.0.0.1:9000`, creds `minioadmin/minioadmin` |
| `.env` S3 keys | NOT set — app is currently in disk-fallback mode |
| Shell env S3 vars | Not exported |
| Infra MinIO 172.31.0.7 | NOT reachable (timeout, exit 28) |
| Local ephemeral MinIO (-p 19000:9000) | Works, healthy in <4 s, cleans up cleanly |
| Node version | v24.18.0 |
| Existing storage.test.ts | None — test file must be created from scratch |

**Recommended test strategy:** spin an ephemeral `minio/minio:latest` container on a random high port at the start of the test file, point `createStorage` at it via a synthesised config object, run the contract assertions (ensureReady, put, get, list, delete), then stop the container in cleanup. No DB, no `.env` loading required.

Alternatively (simpler, no Docker): run both `DiskStorage` and `S3Storage` contract tests — `DiskStorage` using a `tmpdir`, `S3Storage` using the already-running `services-minio-1` at `http://127.0.0.1:9000` with `minioadmin/minioadmin` credentials and an isolated test bucket name — but this couples the test to a running compose service.

The ephemeral container approach is more hermetic and is the safer CI option.

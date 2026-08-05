/**
 * Live-backend contract test for the `Storage` abstraction (`./storage.ts`).
 *
 * WHAT THIS PROVES
 * Exercises BOTH real backends this app ships — a temporary disk-backed
 * `DiskStorage` AND a real S3-compatible `S3Storage` (MinIO) — for BOTH
 * representative resource payloads this app stores (a policy document as a
 * PDF, a health card as a PNG image): upload -> byte-identical download ->
 * scoped delete (deleting one key leaves the other listed/readable) -> true
 * removal (post-delete `get()` REJECTS, not just absent from `list()`). No
 * stub or mock is used for either backend. A single `exercised` tally makes
 * silently skipping (or stubbing) either backend a hard failure of the run.
 *
 * WHY IT IS GATED
 * This test spins up a real container (or talks to a real MinIO endpoint)
 * and is therefore opt-in, not part of the default `npm test` run. With
 * `RUN_STORAGE_CONTRACT_TEST` unset, the file registers exactly one visible
 * SKIPPED test and nothing else runs — default `npm test` stays green and
 * docker-free.
 *
 * HOW TO RUN
 *   RUN_STORAGE_CONTRACT_TEST=1 node --test apps/api/src/lib/storage.test.ts
 *
 * This self-provisions an ephemeral MinIO container:
 *   docker run -d --rm -p 0:9000 \
 *     -e MINIO_ROOT_USER=<random-uuid> -e MINIO_ROOT_PASSWORD=<random-uuid32+> \
 *     --name compass-storage-contract-<random-uuid> minio/minio server /data
 * The container is removed (`docker rm -f`) in a `finally` block regardless
 * of test outcome.
 *
 * To point at an already-running MinIO instead of self-provisioning, set:
 *   RUN_STORAGE_CONTRACT_TEST=1 \
 *   S3_TEST_ENDPOINT=http://127.0.0.1:9000 \
 *   S3_TEST_ACCESS_KEY=<key> \
 *   S3_TEST_SECRET_KEY=<secret> \
 *   node --test apps/api/src/lib/storage.test.ts
 * Optionally also set S3_TEST_REGION=<region> (defaults to us-east-1) alongside
 * the S3_TEST_* variables above.
 * When `S3_TEST_ENDPOINT` is set, no container is provisioned or torn down;
 * only the test's own tracked objects (in its own unique bucket) are cleaned up.
 *
 * WARNING: whatever S3-compatible endpoint you point this at (self-provisioned
 * or via S3_TEST_* override) MUST be disposable / test-only. It must NEVER be
 * a production or shared bucket. This test creates its own unique bucket
 * (`compass-contract-<uuid>`) and deletes only the objects it tracked from it —
 * the bucket itself is RETAINED (left empty), and this test never touches,
 * reads, or deletes the app's real `compass-files` bucket. Credentials are
 * never logged.
 *
 * Health readiness is polled against `http://127.0.0.1:<port>/minio/health/live`
 * for up to ~30s; a timeout THROWS (never silently skips). All temp resources
 * (temp disk dir, tracked S3 keys, self-provisioned container) are cleaned up
 * in a `finally` block.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createStorage } from "./storage.ts";
import { loadConfig } from "../config.ts";
import type { Config } from "../config.ts";
import type { Storage } from "./storage.ts";

const RUN = process.env.RUN_STORAGE_CONTRACT_TEST === "1";

/**
 * Build a schema-complete, obviously-synthetic base env merged with the
 * caller's storage overrides, then run it through the real `loadConfig`.
 * Deliberately does NOT spread `process.env` — `loadConfig` calls
 * `process.exit(1)` on any invalid field, so ambient env values must never
 * leak in and terminate the test runner; the base env below is schema-valid
 * on its own for every field with no default.
 */
function buildConfig(overrides: Record<string, string>): Config {
  const env: NodeJS.ProcessEnv = {
    DATABASE_URL: "postgresql://x:x@127.0.0.1:5432/x",
    REDIS_URL: "redis://127.0.0.1:6379",
    SESSION_SECRET: "0123456789abcdef0123456789abcdef",
    ...overrides,
  };
  return loadConfig(env);
}

/** Representative PDF payload (a policy document). */
const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
/** Representative PNG payload (a health card image) — real PNG magic + a few bytes. */
const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00,
  0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
]);

/**
 * Run the full contract against one real backend: upload both payloads,
 * confirm coexistence via `list()`, confirm byte-identical download, confirm
 * scoped deletion (deleting one key leaves the other listed and readable),
 * then confirm true removal (post-delete `get()` rejects for both).
 * `track` is called with each produced key immediately after `put()` so a
 * failed assertion still leaves the caller able to clean up.
 */
async function runContract(storage: Storage, track: (key: string) => void | Promise<void>): Promise<void> {
  await storage.ensureReady();

  const kPdf = await storage.put(pdf, "application/pdf");
  await track(kPdf);
  const kPng = await storage.put(png, "image/png");
  await track(kPng);
  assert.ok(typeof kPdf === "string" && kPdf.length > 0, "pdf key must be a non-empty string");
  assert.ok(typeof kPng === "string" && kPng.length > 0, "png key must be a non-empty string");
  assert.notStrictEqual(kPdf, kPng, "distinct payloads must produce distinct keys");

  let listed = await storage.list();
  assert.ok(listed.includes(kPdf), "list() must include the pdf key after upload");
  assert.ok(listed.includes(kPng), "list() must include the png key after upload");

  const gotPdf = await storage.get(kPdf);
  assert.ok(gotPdf.equals(pdf), "downloaded pdf bytes must be byte-identical to the upload");
  const gotPng = await storage.get(kPng);
  assert.ok(gotPng.equals(png), "downloaded png bytes must be byte-identical to the upload");

  await storage.delete(kPdf);
  listed = await storage.list();
  assert.ok(!listed.includes(kPdf), "list() must no longer include the deleted pdf key");
  assert.ok(listed.includes(kPng), "list() must still include the untouched png key (scoped delete)");
  const stillPng = await storage.get(kPng);
  assert.ok(stillPng.equals(png), "the untouched png object must still read back byte-identical");

  await storage.delete(kPng);
  listed = await storage.list();
  assert.ok(!listed.includes(kPdf), "list() must not include the pdf key after both deletes");
  assert.ok(!listed.includes(kPng), "list() must not include the png key after both deletes");
  await assert.rejects(storage.get(kPdf), "get() on a deleted pdf key must reject, not just be list-absent");
  await assert.rejects(storage.get(kPng), "get() on a deleted png key must reject, not just be list-absent");
}

if (!RUN) {
  test("storage contract: disk + s3 (live backends)", {
    skip: "set RUN_STORAGE_CONTRACT_TEST=1 and docker to run; see file header for self-provision / existing-MinIO override commands",
  });
} else {
  test("storage contract: disk + s3", async () => {
    const exercised = new Set<string>();
    let dir: string | undefined;
    const s3Keys: string[] = [];
    let s3Storage: Storage | undefined;
    let containerId: string | undefined;
    // Surfaced AFTER the try/finally (not thrown inside `finally`, which would
    // mask a real earlier failure) — only ever thrown when there was no
    // primary error, so it never replaces an earlier failure.
    let teardownError: unknown;
    // Captured in the catch below and rethrown after `finally` runs, so a
    // primary contract failure always takes precedence over a teardown error.
    let primaryError: unknown;

    try {
      // --- Disk backend ---------------------------------------------------
      dir = await mkdtemp(join(tmpdir(), "compass-storage-"));
      const diskStorage = createStorage(buildConfig({ S3_ENDPOINT: "", STORAGE_DIR: dir }));
      assert.strictEqual(diskStorage.constructor.name, "DiskStorage");

      // Probe the first produced key's on-disk presence WHILE it still exists
      // (immediately after put, before its later delete in runContract) — a
      // post-contract check would always find it already removed.
      let diskProbeKey: string | undefined;
      await runContract(diskStorage, async (key) => {
        if (diskProbeKey) return;
        diskProbeKey = key;
        const resolvedRoot = resolve(dir!);
        const resolvedProbePath = resolve(join(dir!, key));
        assert.ok(
          resolvedProbePath === resolvedRoot || resolvedProbePath.startsWith(`${resolvedRoot}${sep}`),
          `produced disk key must resolve under the temp root, got: ${resolvedProbePath}`,
        );
        const fileStat = await stat(resolvedProbePath);
        assert.ok(fileStat.isFile(), "a produced disk key must resolve to a real regular file under the temp root");
      });
      assert.ok(diskProbeKey, "runContract must have produced at least one disk key");
      exercised.add("disk");

      // --- S3 backend (MinIO) ---------------------------------------------
      const testEndpoint = process.env.S3_TEST_ENDPOINT;
      let endpoint: string;
      let accessKey: string;
      let secretKey: string;
      let region: string | undefined;

      if (testEndpoint) {
        endpoint = testEndpoint;
        accessKey = process.env.S3_TEST_ACCESS_KEY ?? "";
        secretKey = process.env.S3_TEST_SECRET_KEY ?? "";
        region = process.env.S3_TEST_REGION;
      } else {
        const rootUser = randomUUID();
        const rootPassword = `${randomUUID()}${randomUUID()}`.slice(0, 40);
        const containerName = `compass-storage-contract-${randomUUID()}`;
        const runOutput = execFileSync(
          "docker",
          [
            "run",
            "-d",
            "--rm",
            "-p",
            "0:9000",
            "-e",
            `MINIO_ROOT_USER=${rootUser}`,
            "-e",
            `MINIO_ROOT_PASSWORD=${rootPassword}`,
            "--name",
            containerName,
            "minio/minio",
            "server",
            "/data",
          ],
          { encoding: "utf8" },
        );
        containerId = runOutput.trim();
        assert.ok(containerId.length > 0, "docker run must print a container id");

        const portOutput = execFileSync(
          "docker",
          [
            "inspect",
            "--format",
            '{{(index (index .NetworkSettings.Ports "9000/tcp") 0).HostPort}}',
            containerId,
          ],
          { encoding: "utf8" },
        ).trim();
        assert.ok(/^\d+$/.test(portOutput), `docker inspect must resolve a digits-only host port, got: ${portOutput}`);
        const port = Number.parseInt(portOutput, 10);
        assert.ok(port >= 1 && port <= 65535, `docker inspect host port out of range 1..65535, got: ${portOutput}`);

        endpoint = `http://127.0.0.1:${port}`;
        accessKey = rootUser;
        secretKey = rootPassword;
        // Diagnostic only (never logs credentials): evidence for manual runs.
        console.error(`[storage contract] self-provisioned MinIO container ${containerId} on host port ${port}`);

        const deadline = Date.now() + 30_000;
        let ready = false;
        while (Date.now() < deadline) {
          try {
            const res = await fetch(`${endpoint}/minio/health/live`, {
              signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
            });
            if (res.status === 200) {
              ready = true;
              break;
            }
          } catch {
            // not up yet (including an abort past the per-request bound), keep polling
          }
          await new Promise((r) => setTimeout(r, 250));
        }
        if (!ready) {
          throw new Error(`MinIO container ${containerId} did not become ready within 30s`);
        }
      }

      const bucket = `compass-contract-${randomUUID()}`.toLowerCase();
      s3Storage = createStorage(
        buildConfig({
          S3_ENDPOINT: endpoint,
          S3_BUCKET: bucket,
          S3_ACCESS_KEY: accessKey,
          S3_SECRET_KEY: secretKey,
          S3_FORCE_PATH_STYLE: "true",
          ...(region ? { S3_REGION: region } : {}),
        }),
      );
      assert.strictEqual(s3Storage.constructor.name, "S3Storage");

      // Independent S3 client — constructed separately from the Storage
      // instance under test (never reused) — so a coherent in-memory
      // S3Storage stub cannot fool the anti-stub guard. Mirrors the disk
      // stat() probe above. Credentials are never logged.
      const probeClient = new S3Client({
        endpoint,
        region: region ?? "us-east-1",
        credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
        forcePathStyle: true,
      });

      let s3ProbeKey: string | undefined;
      await runContract(s3Storage, async (key) => {
        s3Keys.push(key);
        if (s3ProbeKey) return;
        s3ProbeKey = key;
        await probeClient.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      });
      assert.ok(s3ProbeKey, "runContract must have produced at least one s3 key");
      // Optional strengthening: the same independent client must observe the
      // probed key gone after runContract's own deletes ran.
      await assert.rejects(
        probeClient.send(new HeadObjectCommand({ Bucket: bucket, Key: s3ProbeKey })),
        "an independent HeadObjectCommand on a deleted s3 key must reject",
      );
      exercised.add("s3");

      assert.strictEqual(exercised.size, 2, "both backends must be exercised");
      assert.ok(exercised.has("disk"), "disk backend must have been exercised");
      assert.ok(exercised.has("s3"), "s3 backend must have been exercised");
    } catch (err) {
      primaryError = err;
    } finally {
      // Each cleanup step is guarded independently: one step failing must
      // neither skip the remaining steps nor (via an uncaught throw inside
      // `finally`) replace/mask a primary contract failure from the try block.
      try {
        if (dir) {
          await rm(dir, { recursive: true, force: true });
        }
      } catch (err) {
        console.error("[storage contract] temp dir cleanup failed:", err);
      }

      if (s3Storage) {
        for (const key of s3Keys) {
          await s3Storage.delete(key).catch((err: unknown) => {
            console.error(`[storage contract] failed to delete tracked s3 key ${key}:`, err);
          });
        }
      }

      if (containerId) {
        try {
          execFileSync("docker", ["rm", "-f", containerId], { encoding: "utf8" });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("No such container")) {
            // Always surfaced (even when a primary error already exists), but
            // only ever THROWN below when there is no primary error to mask.
            console.error(`[storage contract] docker rm -f ${containerId} failed:`, err);
            teardownError = err;
          }
        }
      }
    }
    if (primaryError) throw primaryError;
    if (teardownError) throw teardownError;
  });
}

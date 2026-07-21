import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openArchive, writeArchive, type ArchiveHeader } from "./backup-archive.ts";

const header: ArchiveHeader = {
  version: 2,
  exportedAt: "2026-07-21T00:00:00.000Z",
  userId: "u-1",
  tables: {
    accounts: [{ id: "a-1", user_id: "u-1", name: "HDFC" }],
    card_statements: [{ id: "s-1", stored_path: "ab/key-1", mime_type: "application/pdf" }],
    attachments: [{ id: "at-1", stored_path: "cd/key-2", mime_type: "image/png" }],
  },
  files: [
    { table: "card_statements", column: "stored_path", rowId: "s-1", key: "ab/key-1" },
    { table: "attachments", column: "stored_path", rowId: "at-1", key: "cd/key-2" },
  ],
};

async function writeToFile(path: string, blobs: Record<string, Buffer | null>): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of writeArchive(header, (ref) => Promise.resolve(blobs[ref.key] ?? null))) {
    chunks.push(chunk);
  }
  await writeFile(path, Buffer.concat(chunks));
}

test("archive round-trips header, blobs, and missing-blob frames", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cmpb-arch-"));
  try {
    const path = join(dir, "a.plain");
    await writeToFile(path, { "ab/key-1": Buffer.from("%PDF-1.7 statement"), "cd/key-2": null });

    const archive = await openArchive(path);
    try {
      assert.deepEqual(archive.header, header);
      assert.deepEqual(await archive.readBlob(0), Buffer.from("%PDF-1.7 statement"));
      assert.equal(await archive.readBlob(1), null); // missing at backup time
      await assert.rejects(archive.readBlob(2), /No file frame/);
    } finally {
      await archive.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("openArchive rejects truncated and non-archive files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cmpb-arch-"));
  try {
    const path = join(dir, "b.plain");
    await writeToFile(path, { "ab/key-1": Buffer.from("data"), "cd/key-2": Buffer.from("more") });
    const { readFile } = await import("node:fs/promises");
    const whole = await readFile(path);

    const cut = join(dir, "cut.plain");
    await writeFile(cut, whole.subarray(0, whole.length - 2));
    await assert.rejects(openArchive(cut), /truncated/);

    const junk = join(dir, "junk.plain");
    await writeFile(junk, Buffer.from("definitely not an archive"));
    await assert.rejects(openArchive(junk));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Config } from "../config.ts";

/**
 * Object storage for uploaded files. One backend interface used by attachments,
 * insurance policy documents, and health cards — so the storage engine is a
 * single swap. Prod uses S3-compatible MinIO; without S3_ENDPOINT it falls back
 * to the local disk (dev). `put` returns an opaque key persisted alongside the
 * file's metadata; `get`/`delete` take that key.
 */
export interface Storage {
  put(data: Buffer, contentType: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Ensure the backend is ready (create the bucket if missing). No-op for disk. */
  ensureReady(): Promise<void>;
}

/** Sharded, collision-free key: <hh>/<uuid>-<hash>. */
function makeKey(data: Buffer): string {
  const hash = createHash("sha256").update(data).digest("hex").slice(0, 8);
  return `${hash.slice(0, 2)}/${randomUUID()}-${hash}`;
}

class DiskStorage implements Storage {
  private readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }
  async put(data: Buffer): Promise<string> {
    const key = makeKey(data);
    const abs = join(this.dir, key);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, data);
    return key;
  }
  get(key: string): Promise<Buffer> {
    return readFile(join(this.dir, key));
  }
  async delete(key: string): Promise<void> {
    await unlink(join(this.dir, key)).catch(() => {});
  }
  async ensureReady(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }
}

class S3Storage implements Storage {
  private readonly client: S3Client;
  private readonly bucket: string;
  constructor(client: S3Client, bucket: string) {
    this.client = client;
    this.bucket = bucket;
  }
  async put(data: Buffer, contentType: string): Promise<string> {
    const key = makeKey(data);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }),
    );
    return key;
  }
  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async ensureReady(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client
        .send(new CreateBucketCommand({ Bucket: this.bucket }))
        .catch(() => {}); // a concurrent create or existing bucket is fine
    }
  }
}

export function createStorage(config: Config): Storage {
  if (config.S3_ENDPOINT) {
    const client = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
    });
    return new S3Storage(client, config.S3_BUCKET);
  }
  return new DiskStorage(config.STORAGE_DIR);
}

import { open } from "node:fs/promises";

/**
 * The plaintext layout inside a v2 encrypted backup — a self-contained archive
 * of one user's rows plus every storage object those rows reference:
 *
 *   [8-byte BE header length][header JSON][file frame]...[file frame]
 *
 * where each file frame is [8-byte BE length][bytes], one per header.files
 * entry in order. A zero-length frame means the object was missing from
 * storage at backup time (the row is still restored; the link stays broken
 * exactly as it was). Frames are length-prefixed rather than sized in the
 * header so the writer can stream blobs without pre-reading them.
 */
export interface ArchiveFileRef {
  /** the table and column the storage key was found in */
  table: string;
  column: string;
  /** primary key of the owning row */
  rowId: string;
  /** the storage key at backup time (opaque; remapped on restore) */
  key: string;
}

export interface ArchiveHeader {
  version: 2;
  exportedAt: string;
  /** the user the rows belonged to when backed up (informational; restore remaps) */
  userId: string;
  /** table name → exported rows, as `select *` objects */
  tables: Record<string, Array<Record<string, unknown>>>;
  files: ArchiveFileRef[];
}

function frameLength(size: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(size));
  return buf;
}

/**
 * Stream the archive: header first, then one frame per header.files entry.
 * `readBlob` returning null marks the object missing (zero-length frame).
 */
export async function* writeArchive(
  header: ArchiveHeader,
  readBlob: (ref: ArchiveFileRef) => Promise<Buffer | null>,
): AsyncGenerator<Buffer> {
  const json = Buffer.from(JSON.stringify(header));
  yield frameLength(json.length);
  yield json;
  for (const ref of header.files) {
    const data = await readBlob(ref);
    yield frameLength(data?.length ?? 0);
    if (data && data.length > 0) yield data;
  }
}

export interface ArchiveReader {
  header: ArchiveHeader;
  /** Read the i-th file frame; null when the object was missing at backup time. */
  readBlob(index: number): Promise<Buffer | null>;
  close(): Promise<void>;
}

const MAX_HEADER_BYTES = 512 * 1024 * 1024; // a corrupt length prefix must not OOM us
const MAX_FRAME_BYTES = 512 * 1024 * 1024;

/**
 * Open a decrypted archive file: parse the header, then walk the frames once to
 * index their offsets so blobs can be read individually during restore.
 */
export async function openArchive(path: string): Promise<ArchiveReader> {
  const handle = await open(path, "r");
  const { size: fileSize } = await handle.stat();
  const readAt = async (offset: number, length: number): Promise<Buffer> => {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buf, 0, length, offset);
    if (bytesRead !== length) throw new Error("Backup archive is truncated");
    return buf;
  };
  const lengthAt = async (offset: number): Promise<number> => {
    const raw = (await readAt(offset, 8)).readBigUInt64BE();
    if (raw > BigInt(MAX_HEADER_BYTES)) throw new Error("Backup archive is corrupt");
    return Number(raw);
  };

  try {
    const headerLength = await lengthAt(0);
    const header = JSON.parse((await readAt(8, headerLength)).toString()) as ArchiveHeader;
    if (header.version !== 2 || typeof header.tables !== "object" || !Array.isArray(header.files)) {
      throw new Error("Unsupported backup format");
    }
    const frames: Array<{ offset: number; size: number }> = [];
    let offset = 8 + headerLength;
    for (let i = 0; i < header.files.length; i++) {
      const size = await lengthAt(offset);
      if (size > MAX_FRAME_BYTES || offset + 8 + size > fileSize) {
        throw new Error("Backup archive is truncated");
      }
      frames.push({ offset: offset + 8, size });
      offset += 8 + size;
    }
    return {
      header,
      readBlob: async (index: number) => {
        const frame = frames[index];
        if (!frame) throw new Error(`No file frame ${index} in archive`);
        return frame.size === 0 ? null : readAt(frame.offset, frame.size);
      },
      close: () => handle.close(),
    };
  } catch (err) {
    await handle.close();
    throw err;
  }
}

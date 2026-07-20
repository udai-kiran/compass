import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PdfText {
  text: string;
  /** the candidate that opened it; "" when the PDF wasn't encrypted */
  usedPassword: string;
}

/** pdf.js raises this when a password is needed or wrong. */
function isPasswordError(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { name?: string }).name === "PasswordException"
  );
}

/**
 * Decrypt (trying no-password, then each candidate) and extract text from a PDF.
 * Glyph runs are grouped by their y-baseline and sorted left-to-right so the
 * statement's table layout survives — a flat join would scramble the columns.
 * Returns null when it isn't a readable PDF or nothing opened it, so the caller
 * can leave the statement for manual handling rather than crash the job.
 */
export async function extractPdfText(
  data: Uint8Array,
  passwordCandidates: string[],
): Promise<PdfText | null> {
  for (const password of ["", ...passwordCandidates]) {
    // Clone the bytes each attempt — pdf.js may detach the buffer it's handed.
    const task = getDocument({ data: new Uint8Array(data), password, useSystemFonts: true });
    try {
      const doc = await task.promise;
      const parts: string[] = [];
      for (let p = 1; p <= doc.numPages; p += 1) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        const rows = new Map<number, { x: number; str: string }[]>();
        for (const item of content.items) {
          if (!("str" in item) || item.str === "") continue;
          const y = Math.round(item.transform[5] ?? 0);
          const row = rows.get(y) ?? rows.set(y, []).get(y)!;
          row.push({ x: item.transform[4] ?? 0, str: item.str });
        }
        parts.push(
          [...rows.keys()]
            .sort((a, b) => b - a) // top of page first (higher y)
            .map((y) =>
              rows
                .get(y)!
                .sort((a, b) => a.x - b.x)
                .map((i) => i.str)
                .join(" ")
                .replace(/\s+/g, " ")
                .trim(),
            )
            .filter(Boolean)
            .join("\n"),
        );
      }
      return { text: parts.join("\n").trim(), usedPassword: password };
    } catch (err) {
      if (isPasswordError(err)) continue; // wrong/needed password → next candidate
      return null; // not a PDF, corrupt, etc.
    } finally {
      await task.destroy();
    }
  }
  return null;
}

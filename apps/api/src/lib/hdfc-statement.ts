import { toCsv } from "./csv.ts";

/**
 * HDFC's printed "Statement of accounts" is fixed-width text, not delimited: a
 * page-header block, then a column header, a row of dashes, and transaction rows
 * whose Narration wraps across several lines. The generic CSV importer can't read
 * it (it takes the first line as the header). This turns that layout into a clean
 * 7-column CSV so the rest of the import pipeline — and the HDFC preset — just work.
 *
 * Returns null when the text isn't an HDFC statement, so the caller falls back to
 * treating the upload as an ordinary CSV.
 */

const OUT_COLUMNS = [
  "Date",
  "Narration",
  "Chq./Ref.No.",
  "Value Dt",
  "Withdrawal Amt.",
  "Deposit Amt.",
  "Closing Balance",
];

/** [start,end) of each run of dashes in the separator line under the header. */
function dashRuns(line: string): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  const re = /-+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) runs.push([m.index, m.index + m[0].length]);
  return runs;
}

/**
 * Column cut points from the dash runs. Each boundary sits at the midpoint of the
 * gap between two runs, so a right-aligned amount that starts a hair before its
 * dashes (or a narration that ends a hair after) still lands in the right column.
 */
function columnCuts(dashLine: string): number[] {
  const runs = dashRuns(dashLine);
  const cuts = [0];
  for (let i = 0; i < runs.length - 1; i += 1) {
    cuts.push(Math.floor((runs[i]![1] + runs[i + 1]![0]) / 2));
  }
  cuts.push(Number.MAX_SAFE_INTEGER);
  return cuts; // column k spans [cuts[k], cuts[k+1]); there are cuts.length-1 columns
}

const DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
const DASH_LINE_RE = /^[\s-]*-{3,}[\s-]*$/;
/** Page furniture / summary that interrupts the transaction rows across pages. */
const NOISE_RE = /HDFC BANK|Page No|Statement of accounts|STATEMENT SUMMARY|Opening Balance/i;

interface Txn {
  date: string;
  narration: string;
  ref: string;
  valueDt: string;
  withdrawal: string;
  deposit: string;
  closing: string;
}

export function parseHdfcStatement(text: string): string | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  // Find the column header ("Narration" + both amount columns), then the dash rule
  // right under it — that dash line defines the column positions.
  let dashIdx = -1;
  for (let i = 0; i < lines.length - 1; i += 1) {
    const l = lines[i]!;
    if (/Narration/i.test(l) && /Withdrawal\s*Amt/i.test(l) && /Deposit\s*Amt/i.test(l)) {
      let j = i + 1;
      while (j < lines.length && lines[j]!.trim() === "") j += 1;
      if (j < lines.length && DASH_LINE_RE.test(lines[j]!) && lines[j]!.includes("---")) {
        dashIdx = j;
        break;
      }
    }
  }
  if (dashIdx === -1) return null;

  const cuts = columnCuts(lines[dashIdx]!);
  if (cuts.length - 1 < 7) return null; // couldn't resolve all seven columns
  const cell = (line: string, k: number): string => line.slice(cuts[k]!, cuts[k + 1]!).trim();

  const txns: Txn[] = [];
  let cur: Txn | null = null;
  const flush = () => {
    if (cur) txns.push(cur);
    cur = null;
  };

  for (let i = dashIdx + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.trim() === "") continue;

    // A transaction row always starts with a date in the first column.
    if (DATE_RE.test(cell(line, 0))) {
      flush();
      cur = {
        date: cell(line, 0),
        narration: cell(line, 1),
        ref: cell(line, 2),
        valueDt: cell(line, 3),
        withdrawal: cell(line, 4),
        deposit: cell(line, 5),
        closing: cell(line, 6),
      };
      continue;
    }

    // Not dated: page furniture / a repeated header / the summary → ends the row.
    if (NOISE_RE.test(line) || DASH_LINE_RE.test(line) || /Narration/i.test(line)) {
      flush();
      continue;
    }

    // Otherwise it's a wrapped continuation of the current Narration.
    if (cur) {
      const more = cell(line, 1);
      if (more) cur.narration = cur.narration ? `${cur.narration} ${more}` : more;
    }
  }
  flush();

  if (txns.length === 0) return null;
  return toCsv([
    OUT_COLUMNS,
    ...txns.map((t) => [t.date, t.narration, t.ref, t.valueDt, t.withdrawal, t.deposit, t.closing]),
  ]);
}

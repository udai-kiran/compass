/**
 * Minimal RFC-4180 CSV parser. Handles quoted fields, escaped quotes ("")
 * and embedded newlines. Parses the whole buffer synchronously per row via a
 * generator so callers can yield to the event loop between batches.
 */
export function* parseCsv(text: string): Generator<string[]> {
  const len = text.length;
  let i = 0;
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let sawAny = false;

  while (i < len) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
      continue;
    }
    switch (ch) {
      case '"':
        inQuotes = true;
        sawAny = true;
        i += 1;
        break;
      case ",":
        row.push(field);
        field = "";
        sawAny = true;
        i += 1;
        break;
      case "\r":
        i += 1;
        break;
      case "\n":
        if (sawAny || field.length > 0 || row.length > 0) {
          row.push(field);
          yield row;
        }
        row = [];
        field = "";
        sawAny = false;
        i += 1;
        break;
      default:
        field += ch;
        sawAny = true;
        i += 1;
    }
  }
  if (sawAny || field.length > 0 || row.length > 0) {
    row.push(field);
    yield row;
  }
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function expandYear(y: string): string {
  return y.length === 2 ? `20${y}` : y;
}

function valid(y: string, m: string, d: string): string | null {
  const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(t.getTime()) ? null : iso;
}

/** Parse a date cell per the mapping's declared format. Returns ISO YYYY-MM-DD or null. */
export function parseDateCell(raw: string, format: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m: RegExpExecArray | null;
  switch (format) {
    case "YYYY-MM-DD":
      m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
      return m ? valid(m[1]!, m[2]!, m[3]!) : null;
    case "DD/MM/YYYY":
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
      return m ? valid(expandYear(m[3]!), m[2]!, m[1]!) : null;
    case "MM/DD/YYYY":
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
      return m ? valid(expandYear(m[3]!), m[1]!, m[2]!) : null;
    case "DD-MM-YYYY":
      m = /^(\d{1,2})-(\d{1,2})-(\d{2,4})/.exec(s);
      return m ? valid(expandYear(m[3]!), m[2]!, m[1]!) : null;
    case "DD MMM YYYY": {
      m = /^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-](\d{2,4})/.exec(s);
      if (!m) return null;
      const month = MONTHS[m[2]!.toLowerCase()];
      return month ? valid(expandYear(m[3]!), month, m[1]!) : null;
    }
    default:
      return null;
  }
}

/**
 * Parse a money cell to integer paise. Handles ₹, thousand separators,
 * parentheses negatives and CR/DR suffixes. Returns null when unparseable.
 */
export function parseAmountCell(raw: string): number | null {
  let t = raw.trim().replace(/[₹,\s]/g, "");
  if (!t) return null;
  let sign = 1;
  if (t.startsWith("(") && t.endsWith(")")) {
    sign = -1;
    t = t.slice(1, -1);
  }
  if (/cr\.?$/i.test(t)) t = t.replace(/cr\.?$/i, "");
  else if (/dr\.?$/i.test(t)) {
    sign = -1;
    t = t.replace(/dr\.?$/i, "");
  }
  if (t.startsWith("-")) {
    sign = -1;
    t = t.slice(1);
  } else if (t.startsWith("+")) {
    t = t.slice(1);
  }
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(t);
  if (!m) return null;
  const paise = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0").slice(0, 2));
  return sign * paise;
}

/** RFC-4180 CSV writer: quotes fields containing commas, quotes or newlines. */
export function toCsv(rows: Array<Array<string | number>>): string {
  const cell = (v: string | number): string => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

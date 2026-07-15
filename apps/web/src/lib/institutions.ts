/**
 * Known Indian institutions, for recognisable account chips and for keeping the
 * free-text `institution` field from fragmenting into "HDFC" / "hdfc bank" /
 * "HDFC Bank Ltd" — three spellings the field cannot be a lookup key with.
 *
 * Monograms and brand colours, deliberately not logos: bank logos are
 * trademarked artwork, and a letter in the right colour is just as scannable at
 * 20px. Colours are close approximations, chosen for recognition and contrast
 * rather than brand accuracy.
 *
 * An institution missing from this list is not an error — it falls back to a
 * neutral chip built from its own initials.
 */

export interface Institution {
  /** canonical stored value */
  label: string;
  monogram: string;
  /** background colour of the chip */
  color: string;
  /** lowercase spellings that should resolve to this entry */
  aliases: readonly string[];
}

export const INSTITUTIONS: readonly Institution[] = [
  { label: "SBI", monogram: "SBI", color: "#22409A", aliases: ["state bank of india", "state bank"] },
  { label: "HDFC", monogram: "H", color: "#004C8F", aliases: ["hdfc bank", "hdfc ltd"] },
  { label: "ICICI", monogram: "I", color: "#F58220", aliases: ["icici bank"] },
  { label: "Axis", monogram: "A", color: "#97144D", aliases: ["axis bank"] },
  { label: "Kotak", monogram: "K", color: "#003874", aliases: ["kotak mahindra", "kotak mahindra bank"] },
  { label: "PNB", monogram: "P", color: "#8E1B65", aliases: ["punjab national bank", "punjab national"] },
  { label: "Bank of Baroda", monogram: "BoB", color: "#F15A22", aliases: ["bob", "baroda"] },
  { label: "Canara", monogram: "C", color: "#00539F", aliases: ["canara bank"] },
  { label: "Union Bank", monogram: "U", color: "#C8102E", aliases: ["union bank of india", "ubi"] },
  { label: "IndusInd", monogram: "In", color: "#90268F", aliases: ["indusind bank"] },
  { label: "IDFC First", monogram: "ID", color: "#9C1D26", aliases: ["idfc", "idfc bank", "idfc first bank"] },
  { label: "Yes Bank", monogram: "Y", color: "#00518F", aliases: ["yes"] },
  { label: "Federal Bank", monogram: "F", color: "#00539B", aliases: ["federal"] },
  { label: "IDBI", monogram: "ID", color: "#007A33", aliases: ["idbi bank"] },
  { label: "Indian Bank", monogram: "IB", color: "#1B3A6B", aliases: ["indian"] },
  { label: "Central Bank", monogram: "CB", color: "#B01E23", aliases: ["central bank of india"] },
  { label: "AU Small Finance", monogram: "AU", color: "#54187E", aliases: ["au bank", "au small finance bank"] },
  { label: "Bandhan", monogram: "B", color: "#A8172A", aliases: ["bandhan bank"] },
  { label: "RBL", monogram: "R", color: "#B32317", aliases: ["rbl bank", "ratnakar"] },
  { label: "Citi", monogram: "C", color: "#0B5FA5", aliases: ["citibank", "citi bank"] },
  { label: "HSBC", monogram: "H", color: "#DB0011", aliases: ["hsbc bank"] },
  { label: "Standard Chartered", monogram: "SC", color: "#0473EA", aliases: ["stanchart", "standard chartered bank"] },
  { label: "Amex", monogram: "AX", color: "#006FCF", aliases: ["american express", "american express bank"] },
  // Not banks, but they issue the accounts these types live in.
  { label: "EPFO", monogram: "EP", color: "#1F5C99", aliases: ["employees provident fund", "epf office"] },
  { label: "NSDL", monogram: "NS", color: "#2E5C99", aliases: ["nps trust", "protean", "nsdl e-gov"] },
  { label: "India Post", monogram: "IP", color: "#C8102E", aliases: ["post office", "postal", "india post payments bank"] },
];

/** Longest alias first, so "state bank of india" wins over a bare "state bank". */
const LOOKUP: ReadonlyMap<string, Institution> = new Map(
  INSTITUTIONS.flatMap((inst) =>
    [inst.label.toLowerCase(), ...inst.aliases].map((key) => [key, inst] as const),
  ),
);

const SUGGESTIONS: readonly string[] = INSTITUTIONS.map((i) => i.label);

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Resolve a stored institution string to a known entry. Falls back to a
 * trailing-word trim ("HDFC Bank Ltd" -> "HDFC Bank" -> "HDFC") so a slightly
 * wordier spelling still finds its chip.
 */
export function findInstitution(value: string | null): Institution | null {
  if (!value) return null;
  const key = normalize(value);
  const exact = LOOKUP.get(key);
  if (exact) return exact;

  const words = key.split(" ");
  for (let end = words.length - 1; end > 0; end--) {
    const found = LOOKUP.get(words.slice(0, end).join(" "));
    if (found) return found;
  }
  return null;
}

/** Initials for an institution we don't know, e.g. "Saraswat Co-op" -> "SC". */
function initialsOf(value: string): string {
  const words = normalize(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/**
 * Perceived brightness (ITU-R BT.601). Brand colours run from #003874 to
 * #F58220, so the label colour has to follow the background or half the chips
 * fail contrast.
 */
export function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 145;
}

/** Chip appearance for any institution string, known or not. */
export function chipFor(institution: string): { monogram: string; color: string; title: string } {
  const known = findInstitution(institution);
  return {
    monogram: known?.monogram ?? initialsOf(institution),
    color: known?.color ?? FALLBACK_COLOR,
    title: known?.label ?? institution,
  };
}

/** Neutral slate for an institution we don't recognise. */
export const FALLBACK_COLOR = "#94A3B8";

export const INSTITUTION_LIST_ID = "known-institutions";

/** Labels offered by the datalist; suggests without constraining. */
export const INSTITUTION_SUGGESTIONS = SUGGESTIONS;

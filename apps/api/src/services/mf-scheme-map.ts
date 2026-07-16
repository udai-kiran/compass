/**
 * Deterministic map from the exact "Name of the Fund" string in the user's
 * transaction CSV to its AMFI scheme code (the key NAV refresh uses).
 *
 * Resolved once against AMFI's NAVAll master, not fuzzy-matched at runtime — a
 * fund name absent here resolves to null (unmapped) and is skipped, never
 * guessed onto the wrong scheme. `schemeCode: null` means the fund has no AMFI
 * scheme at all (e.g. Kuvera SaveSmart, a platform product); it still imports,
 * but carries no code and is skipped by NAV refresh.
 *
 * A repo constant for now because the set is small and fixed; it can move to a
 * user-editable table later without changing callers, which only use resolveScheme.
 */
export interface SchemeMapEntry {
  csvName: string;
  schemeCode: number | null;
  canonicalName: string;
}

export const MF_SCHEME_MAP: readonly SchemeMapEntry[] = [
  { csvName: "Aditya Birla Sun Life Dynamic Bond IDCW Payout Direct Plan", schemeCode: 132918, canonicalName: "Aditya Birla Sun Life Dynamic Bond Fund - Direct - IDCW" },
  { csvName: "Aditya Birla Sun Life Mutual Dynamic Bond Growth Direct Plan", schemeCode: 119505, canonicalName: "Aditya Birla Sun Life Dynamic Bond Fund - Growth - Direct Plan" },
  { csvName: "Aditya Birla Sun Life Small Cap Growth Direct Plan", schemeCode: 119556, canonicalName: "Aditya Birla Sun Life Small Cap Fund - Growth - Direct Plan" },
  { csvName: "DSP Midcap Growth Direct Plan", schemeCode: 119071, canonicalName: "DSP Midcap Fund - Direct Plan - Growth" },
  { csvName: "Franklin India Focused Equity Growth Direct Plan", schemeCode: 118564, canonicalName: "Franklin India Focused Equity Fund - Direct - Growth" },
  { csvName: "Franklin India Small Cap Growth Direct Plan", schemeCode: 118525, canonicalName: "Franklin India Small Cap Fund - Direct - Growth" },
  { csvName: "HDFC Hybrid Equity Growth Direct Plan", schemeCode: 119062, canonicalName: "HDFC Hybrid Equity Fund - Growth Option - Direct Plan" },
  { csvName: "HDFC Mid Cap Growth Direct Plan", schemeCode: 118989, canonicalName: "HDFC Mid Cap Fund - Growth Option - Direct Plan" },
  { csvName: "HDFC Nifty 50 Index Growth Direct Plan", schemeCode: 119063, canonicalName: "HDFC Nifty 50 Index Fund - Direct Plan" },
  { csvName: "ICICI Prudential Large Cap Growth Direct Plan", schemeCode: 120586, canonicalName: "ICICI Prudential Large Cap Fund (erstwhile Bluechip Fund) - Direct Plan - Growth" },
  { csvName: "ICICI Prudential Value Growth Direct Plan", schemeCode: 120323, canonicalName: "ICICI Prudential Value Fund (erstwhile Value Discovery Fund) - Direct Plan - Growth" },
  // Kuvera SaveSmart is a platform sweep product, not an AMFI scheme — no code.
  { csvName: "Kuvera SaveSmart", schemeCode: null, canonicalName: "Kuvera SaveSmart (platform product — no AMFI scheme)" },
  { csvName: "Mirae Asset Large & Midcap Growth Direct Plan", schemeCode: 118834, canonicalName: "Mirae Asset Large & Midcap Fund - Direct Plan - Growth" },
  { csvName: "Nippon India Gilt Growth Direct Plan", schemeCode: 118672, canonicalName: "Nippon India Gilt Fund - Direct Plan Growth Plan - Growth Option" },
  { csvName: "Nippon India Liquid Growth Direct Plan", schemeCode: 118701, canonicalName: "Nippon India Liquid Fund - Direct Plan Growth Plan - Growth Option" },
  { csvName: "Parag Parikh Flexi Cap Growth Direct Plan", schemeCode: 122639, canonicalName: "Parag Parikh Flexi Cap Fund - Direct Plan - Growth" },
  { csvName: "PGIM India Global Equity Opportunities FoF Growth Direct Plan", schemeCode: 138528, canonicalName: "PGIM India Global Equity Opportunities Fund of Fund - Direct Plan - Growth" },
  { csvName: "Quantum Value Growth Direct Plan", schemeCode: 103490, canonicalName: "Quantum Value Fund - Direct Plan Growth Option" },
  { csvName: "SBI Flexicap Growth Direct Plan", schemeCode: 119718, canonicalName: "SBI Flexicap Fund - Direct Plan - Growth" },
  { csvName: "SBI Midcap Growth Direct Plan", schemeCode: 119716, canonicalName: "SBI Midcap Fund - Direct Plan - Growth" },
  { csvName: "UTI Nifty 50 Index Growth Direct Plan", schemeCode: 120716, canonicalName: "UTI Nifty 50 Index Fund - Growth Option - Direct" },
  { csvName: "UTI Nifty Next 50 Index Growth Direct Plan", schemeCode: 143341, canonicalName: "UTI Nifty Next 50 Index Fund - Direct Plan - Growth Option" },
];

/** Case/space-insensitive so trivial CSV formatting drift still resolves. */
function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

const BY_NAME = new Map(MF_SCHEME_MAP.map((e) => [normalize(e.csvName), e]));

/** Resolves a CSV fund name to its map entry, or null if the fund is unknown. */
export function resolveScheme(csvName: string): SchemeMapEntry | null {
  return BY_NAME.get(normalize(csvName)) ?? null;
}

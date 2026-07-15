/**
 * Presentation for the institution registry. Data and matching live in
 * institutions.ts — kept JSX-free so node --test can type-strip and run it.
 */
import {
  chipFor,
  INSTITUTION_LIST_ID,
  INSTITUTION_SUGGESTIONS,
  isLight,
} from "./institutions.ts";

export { INSTITUTION_LIST_ID };

export function InstitutionIcon({
  institution,
  className = "",
}: {
  institution: string | null;
  className?: string;
}) {
  if (!institution) return null;
  const { monogram, color, title } = chipFor(institution);

  return (
    <span
      aria-hidden="true"
      title={title}
      style={{ backgroundColor: color, color: isLight(color) ? "#0F172A" : "#FFFFFF" }}
      className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 text-[10px] font-semibold leading-none tracking-tight ${className}`}
    >
      {monogram}
    </span>
  );
}

/** Suggests known institutions without constraining — any bank is still typeable. */
export function InstitutionDatalist() {
  return (
    <datalist id={INSTITUTION_LIST_ID}>
      {INSTITUTION_SUGGESTIONS.map((label) => (
        <option key={label} value={label} />
      ))}
    </datalist>
  );
}

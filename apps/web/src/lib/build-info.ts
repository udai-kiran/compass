import type { BuildInfo } from "@compass/shared";

/** This web bundle's build provenance (Vite `define`, from Docker build args). */
export const buildInfo: BuildInfo = {
  version: __APP_VERSION__,
  gitSha: __GIT_SHA__,
  builtAt: __BUILD_TIME__,
};

/** Short display form: "dev" or the 7-char SHA when the version is just a SHA. */
export const shortSha = (sha: string) => (sha === "unknown" ? sha : sha.slice(0, 7));

/** "2 hours ago" for a build timestamp; null when unset (local builds) or unparseable. */
export function relativeBuildTime(iso: string): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const minutes = Math.round((then - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}

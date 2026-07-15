import type { BuildInfo } from "@compass/shared";

/** This web bundle's build provenance (Vite `define`, from Docker build args). */
export const buildInfo: BuildInfo = {
  version: __APP_VERSION__,
  gitSha: __GIT_SHA__,
  builtAt: __BUILD_TIME__,
};

/** Short display form: "dev" or the 7-char SHA when the version is just a SHA. */
export const shortSha = (sha: string) => (sha === "unknown" ? sha : sha.slice(0, 7));

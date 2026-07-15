import type { BuildInfo } from "@compass/shared";

// Populated from build args baked into the image (apps/api/Dockerfile).
// Falls back to dev-friendly defaults when running from source.
export const buildInfo: BuildInfo = {
  version: process.env.APP_VERSION ?? "dev",
  gitSha: process.env.GIT_SHA ?? "unknown",
  builtAt: process.env.BUILD_TIME ?? "",
};

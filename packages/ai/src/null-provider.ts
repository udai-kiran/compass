import { AiDisabledError, type AiProvider } from "./types.ts";

/**
 * Default provider when `AI_PROVIDER=none`. Every capability throws
 * {@link AiDisabledError}; the API guards on `provider.enabled` first and
 * returns 404, so these throws are a safety net, not a normal path. The entire
 * core test suite runs against this provider.
 */
export const NullProvider: AiProvider = {
  name: "none",
  enabled: false,
  async suggestCategories() {
    throw new AiDisabledError();
  },
  async generateSummary() {
    throw new AiDisabledError();
  },
  async chat() {
    throw new AiDisabledError();
  },
};

import assert from "node:assert/strict";
import test from "node:test";
import { UpdateAiSettingsSchema } from "./ai.ts";

test("AI settings reject unsafe base URL shapes", () => {
  for (const baseUrl of [
    "",
    "file:///etc/passwd",
    "https://user:pass@example.com/v1",
    "https://example.com/v1?q=x",
  ]) {
    assert.equal(
      UpdateAiSettingsSchema.safeParse({ provider: "custom", baseUrl, model: "m", apiKey: "k" })
        .success,
      false,
    );
  }
});

test("stored-key state is not accepted from the client", () => {
  const parsed = UpdateAiSettingsSchema.parse({
    provider: "anthropic",
    hasStoredKey: true,
  });
  assert.equal("hasStoredKey" in parsed, false);
});

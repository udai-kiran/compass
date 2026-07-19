import assert from "node:assert/strict";
import test from "node:test";
import { assertAllowedBaseUrl } from "./ai-settings.ts";

test("AI endpoint allowlist uses normalized exact base URLs", () => {
  assert.doesNotThrow(() =>
    assertAllowedBaseUrl(
      "custom",
      "https://ai.example.com/v1/",
      "https://other.example, https://ai.example.com/v1",
    ),
  );
  assert.throws(() =>
    assertAllowedBaseUrl("custom", "https://ai.example.com/v1/extra", "https://ai.example.com/v1"),
  );
  assert.throws(() =>
    assertAllowedBaseUrl("ollama", "http://169.254.169.254", "http://ollama:11434"),
  );
});

test("fixed providers do not require a base URL allowlist", () => {
  assert.doesNotThrow(() => assertAllowedBaseUrl("anthropic", "", ""));
});

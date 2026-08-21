/**
 * Vision capability tests (task 9.5 P0, updated iter2).
 *
 * Tests for:
 *   - `modelSupportsVision` allowlist (positive + negative hits)
 *   - Each provider's `supportsVision` flag value
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { modelSupportsVision } from "./types.ts";
import { createAiProvider } from "./factory.ts";
import { NullProvider } from "./null-provider.ts";

// ─── modelSupportsVision allowlist ───────────────────────────────────────────

test("modelSupportsVision: gpt-4o → true", () => {
  assert.equal(modelSupportsVision("gpt-4o"), true);
});

test("modelSupportsVision: gpt-4o-mini → true (contains gpt-4o)", () => {
  assert.equal(modelSupportsVision("gpt-4o-mini"), true);
});

test("modelSupportsVision: gpt-4.1 → true", () => {
  assert.equal(modelSupportsVision("gpt-4.1"), true);
});

test("modelSupportsVision: gpt-4-turbo → true", () => {
  assert.equal(modelSupportsVision("gpt-4-turbo"), true);
});

test("modelSupportsVision: claude-3-haiku → true (contains claude-3)", () => {
  assert.equal(modelSupportsVision("claude-3-haiku-20240307"), true);
});

test("modelSupportsVision: anthropic/claude-3.5-sonnet → true (contains claude-3)", () => {
  assert.equal(modelSupportsVision("anthropic/claude-3.5-sonnet"), true);
});

test("modelSupportsVision: claude-3-opus → true (contains claude-3)", () => {
  assert.equal(modelSupportsVision("claude-3-opus"), true);
});

test("modelSupportsVision: llava → true", () => {
  assert.equal(modelSupportsVision("llava"), true);
});

test("modelSupportsVision: llava:13b → true (contains llava)", () => {
  assert.equal(modelSupportsVision("llava:13b"), true);
});

test("modelSupportsVision: llava-1.6 → true (contains llava)", () => {
  assert.equal(modelSupportsVision("llava-1.6"), true);
});

test("modelSupportsVision: qwen2-vl → true (contains -vl)", () => {
  assert.equal(modelSupportsVision("qwen2-vl"), true);
});

test("modelSupportsVision: qwen2-vl-7b → true (contains -vl)", () => {
  assert.equal(modelSupportsVision("qwen2-vl-7b"), true);
});

test("modelSupportsVision: pixtral-12b → true (contains pixtral)", () => {
  assert.equal(modelSupportsVision("pixtral-12b"), true);
});

// ─── FALSE cases — text-only models must not match ───────────────────────────

test("modelSupportsVision: not-vision → false (bare 'vision' token removed)", () => {
  assert.equal(modelSupportsVision("not-vision"), false);
});

test("modelSupportsVision: my-vision-benchmark-text-model → false (bare 'vision' token removed)", () => {
  assert.equal(modelSupportsVision("my-vision-benchmark-text-model"), false);
});

test("modelSupportsVision: claude-2 → false (bare 'claude' removed; only claude-3/claude-4 match)", () => {
  assert.equal(modelSupportsVision("claude-2"), false);
});

test("modelSupportsVision: claude-instant-1 → false (bare 'claude' removed)", () => {
  assert.equal(modelSupportsVision("claude-instant-1"), false);
});

test("modelSupportsVision: deepseek-chat → false", () => {
  assert.equal(modelSupportsVision("deepseek-chat"), false);
});

test("modelSupportsVision: deepseek/deepseek-chat → false (OpenRouter default)", () => {
  assert.equal(modelSupportsVision("deepseek/deepseek-chat"), false);
});

test("modelSupportsVision: llama3.1 → false (Ollama default)", () => {
  assert.equal(modelSupportsVision("llama3.1"), false);
});

test("modelSupportsVision: unknown/custom-text-model → false", () => {
  assert.equal(modelSupportsVision("my-custom-text-model"), false);
});

test("modelSupportsVision: empty string → false", () => {
  assert.equal(modelSupportsVision(""), false);
});

// ─── Provider supportsVision flags ───────────────────────────────────────────

test("NullProvider.supportsVision is false", () => {
  assert.equal(NullProvider.supportsVision, false);
});

test("Anthropic provider.supportsVision is true", () => {
  const provider = createAiProvider({ provider: "anthropic", apiKey: "sk-test" });
  assert.equal(provider.supportsVision, true);
});

test("Ollama provider.supportsVision is false", () => {
  const provider = createAiProvider({ provider: "ollama", baseUrl: "http://localhost:11434" });
  assert.equal(provider.supportsVision, false);
});

test("OpenAI-compat (openrouter) with deepseek-chat model → supportsVision false", () => {
  const provider = createAiProvider({
    provider: "openrouter",
    apiKey: "sk-or-x",
    model: "deepseek/deepseek-chat",
  });
  assert.equal(provider.supportsVision, false);
});

test("OpenAI-compat (openrouter) with gpt-4o model → supportsVision true", () => {
  const provider = createAiProvider({
    provider: "openrouter",
    apiKey: "sk-or-x",
    model: "openai/gpt-4o",
  });
  assert.equal(provider.supportsVision, true);
});

test("OpenAI-compat (deepseek) with default deepseek-chat → supportsVision false", () => {
  // Default model for deepseek provider is "deepseek-chat"
  const provider = createAiProvider({ provider: "deepseek", apiKey: "sk-x" });
  assert.equal(provider.supportsVision, false);
});

test("OpenAI-compat (custom) with gpt-4-turbo model → supportsVision true", () => {
  const provider = createAiProvider({
    provider: "custom",
    apiKey: "sk-x",
    baseUrl: "https://api.example.com/v1",
    model: "gpt-4-turbo",
  });
  assert.equal(provider.supportsVision, true);
});

test("OpenAI-compat (custom) with unknown model → supportsVision false", () => {
  const provider = createAiProvider({
    provider: "custom",
    apiKey: "sk-x",
    baseUrl: "https://api.example.com/v1",
    model: "my-text-only-model",
  });
  assert.equal(provider.supportsVision, false);
});

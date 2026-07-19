import { test } from "node:test";
import assert from "node:assert/strict";
import { createAiProvider } from "./factory.ts";
import { NullProvider } from "./null-provider.ts";
import { extractJson } from "./http.ts";
import { AiDisabledError, CategorySuggestionsSchema } from "./types.ts";

test("factory: none / missing-field fall back to NullProvider", () => {
  assert.equal(createAiProvider({ provider: "none" }), NullProvider);
  assert.equal(createAiProvider({ provider: "anthropic" }), NullProvider); // no key
  assert.equal(createAiProvider({ provider: "ollama" }), NullProvider); // no url
  assert.equal(createAiProvider({ provider: "openrouter" }), NullProvider); // no key
  assert.equal(createAiProvider({ provider: "deepseek" }), NullProvider); // no key
  assert.equal(createAiProvider({ provider: "custom", apiKey: "sk-x", baseUrl: "http://h/v1" }), NullProvider); // no model
  assert.equal(createAiProvider({ provider: "custom", apiKey: "sk-x", model: "m" }), NullProvider); // no baseUrl
});

test("factory: configured providers are enabled and named", () => {
  const a = createAiProvider({ provider: "anthropic", apiKey: "sk-x" });
  assert.equal(a.name, "anthropic");
  assert.equal(a.enabled, true);
  const o = createAiProvider({ provider: "ollama", baseUrl: "http://h:11434" });
  assert.equal(o.name, "ollama");
  assert.equal(o.enabled, true);
  const r = createAiProvider({ provider: "openrouter", apiKey: "sk-or-x" });
  assert.equal(r.name, "openrouter");
  assert.equal(r.enabled, true);
  const d = createAiProvider({ provider: "deepseek", apiKey: "sk-x" });
  assert.equal(d.name, "deepseek");
  assert.equal(d.enabled, true);
  // custom = generic OpenAI-compatible endpoint; needs key + baseUrl + model.
  const c = createAiProvider({ provider: "custom", apiKey: "sk-x", baseUrl: "http://h/v1", model: "m" });
  assert.equal(c.name, "custom");
  assert.equal(c.enabled, true);
});

test("NullProvider: every capability throws AiDisabledError", async () => {
  await assert.rejects(() => NullProvider.suggestCategories({ categories: [], transactions: [] }), AiDisabledError);
  await assert.rejects(() => NullProvider.generateSummary({ period: "2026-06", facts: {} }), AiDisabledError);
  await assert.rejects(() => NullProvider.chat({ system: "", messages: [], tools: [] }), AiDisabledError);
});

test("extractJson: pulls JSON from fences and trailing prose, undefined on junk", () => {
  assert.deepEqual(extractJson('```json\n[{"a":1}]\n```'), [{ a: 1 }]);
  assert.deepEqual(extractJson('Here you go: {"x":true} — hope that helps'), { x: true });
  assert.equal(extractJson("no json here"), undefined);
  assert.equal(extractJson("{ broken "), undefined);
});

test("CategorySuggestionsSchema: rejects out-of-range confidence", () => {
  assert.equal(CategorySuggestionsSchema.safeParse([{ transactionId: "t", categoryId: null, confidence: 2 }]).success, false);
  assert.equal(CategorySuggestionsSchema.safeParse([{ transactionId: "t", categoryId: "c", confidence: 0.9 }]).success, true);
});

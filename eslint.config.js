import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/data/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // AI SDKs may only be imported inside packages/ai — the app must run without AI.
    files: ["apps/**", "packages/shared/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@anthropic-ai/*", "ollama", "openai"],
              message: "AI SDKs are only allowed inside packages/ai (see PRD: app must run without AI).",
            },
          ],
        },
      ],
    },
  },
);

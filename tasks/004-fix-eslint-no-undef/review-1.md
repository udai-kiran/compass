## Plan review

No blocking issues found. The proposed change is correct, minimal, and should make `npm run lint` pass without weakening lint rules elsewhere.

### 1. Scratch scripts are safe to delete

Confirmed for both:

- `apps/api/investigate-card-details.tmp.mjs`
- `apps/api/investigate-card-details2.tmp.mjs`

Evidence:

- `git status --porcelain` reports both as `??`, so they are genuinely untracked.
- `git log --all -- <paths>` returns no history.
- `git rev-list --all --objects` contains neither path, so they do not appear under those names in any reachable Git object history.
- Neither file is ignored.
- Repository-wide reference searches found no references to either filename outside the task plan.
- No CI, documentation, package script, or source file depends on them.
- Inspection confirms the files contain PostgreSQL connection details and query application tables.

Deleting them is appropriate. They are untracked, have no repository history, contain sensitive local credentials, and have no consumers.

### 2. Proposed ESLint override is valid and effective

The current [eslint.config.js](/home/udai/PennyPilot/eslint.config.js) exports:

```js
export default tseslint.config(
  { ignores: [...] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: {...} },
  { files: [...], rules: {...} },
);
```

Adding another object such as:

```js
{
  files: ["scripts/**/*.mjs"],
  languageOptions: {
    globals: {
      process: "readonly",
      console: "readonly",
    },
  },
},
```

is valid flat-config syntax and fits the existing `tseslint.config(...)` structure.

I tested the proposed object in memory alongside the real exported configuration. `scripts/tasks-to-issues.mjs` then linted with:

- 0 errors
- 0 warnings
- `no-undef` still enabled

Thus, it fixes the errors by declaring the two names, not by disabling or weakening `no-undef` or any other rule.

The current lint results also exactly match the plan:

- First scratch script: 3 `console` errors
- Second scratch script: 6 `console` errors
- `scripts/tasks-to-issues.mjs`: 16 `process`/`console` errors
- Total: 25 errors

One minor wording correction: `scripts/tasks-to-issues.mjs` is not “referenced by nothing else.” It is documented in `tasks/README.md` and mentioned in several task review records. This reinforces that it is legitimate tooling and should remain; it does not affect the proposed implementation.

### 3. Other JavaScript-family files

After excluding the directories already ignored by ESLint, the complete `.js`, `.mjs`, and `.cjs` inventory is:

- `eslint.config.js` — tracked
- `apps/api/investigate-card-details.tmp.mjs` — untracked
- `apps/api/investigate-card-details2.tmp.mjs` — untracked
- `scripts/tasks-to-issues.mjs` — untracked

There are no additional tracked, untracked, or relevant ignored plain-JavaScript files that the plan missed. `eslint.config.js` already passes lint and does not need Node globals.

### 4. Override scope and leakage risk

`files: ["scripts/**/*.mjs"]` is appropriately narrow:

- It does not match `apps/**`.
- It does not match `packages/**`.
- It does not match `.ts` or `.tsx` files, including any TypeScript file under `scripts/`.
- It declares only `process` and `console`, rather than the complete Node environment.
- It leaves all existing rules enabled.

The only small future-facing risk is that every future `.mjs` file under `scripts/` will receive these two globals, including a hypothetical browser-oriented script. Given that `scripts/` is conventionally repository tooling and only two globals are declared, this is reasonable and materially narrower than a repository-wide Node environment.

### 5. TypeScript `no-undef` behavior

The plan’s claim about `apps/**` and `packages/**` is correct.

A direct lint run over the existing `.ts` and `.tsx` files under both scopes passed. Calculated ESLint configuration for a TypeScript source file shows:

```text
no-undef: off
parser: typescript-eslint/parser
```

This comes from `...tseslint.configs.recommended`, which disables core `no-undef` for TypeScript files. TypeScript’s own compiler and type-aware name resolution handle undefined identifiers more accurately for those files.

For `scripts/tasks-to-issues.mjs`, calculated configuration instead shows core `no-undef` enabled. That difference explains why TypeScript application/package files currently pass without explicit Node globals while the plain `.mjs` script does not.

## Conclusion

The plan is ready for implementation as written:

1. Delete the two untracked credential-bearing scratch files.
2. Add the `scripts/**/*.mjs` override declaring only `process` and `console` as readonly.
3. Run repository lint and typecheck.

There are no real blocking issues and no additional JavaScript files requiring expansion of the override.
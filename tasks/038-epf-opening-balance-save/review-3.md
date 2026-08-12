The file contains 16 top-level function declarations:

- 59 — `errorOf`
- 67 — `AccountDetailPage`
- 86 — `AccountDetail`
- 125 — `StatementPasswordSection`
- 192 — `Section`
- 202 — `Field`
- 217 — `SaveButton`
- 229 — `IdentitySection`
- 307 — `EpfOpeningSection`
- 364 — `OpeningBalanceSection`
- 438 — `UpiSection`
- 525 — `BankSection`
- 679 — `DerivedRow`
- 691 — `OverdraftSection`
- 787 — `RetirementSection`
- 895 — `NpsSection`

All top-level names are unique. In particular:

- `EpfOpeningSection`: once, line 307
- `OpeningBalanceSection`: once, line 364
- `UpiSection`: once, line 438

Across nested declarations, two names recur:

- `save`: lines 136 and 443
- `submit`: lines 148, 242, 322, 376, 559, 715, 816, and 926

These occur in separate enclosing component scopes and therefore are not duplicate implementations.

The names of every non-exported top-level declaration begin at column 10: lines 59, 86, 125, 192, 202, 217, 229, 307, 364, 438, 525, 679, 691, 787, and 895. `AccountDetailPage` begins at column 17 on line 67 because its declaration starts with `export function`.

Running `tsc --noEmit -p apps/web/tsconfig.json` completes successfully and produces no TS2393 errors. `apps/web/tsconfig.json` extends the root configuration at line 2 and includes `src` at line 11. The base configuration enables `noEmit` at `tsconfig.base.json` line 17. Since every file-scope function name is unique, and repeated nested names reside in different scopes, there are no duplicate function implementations for TypeScript to report as TS2393.
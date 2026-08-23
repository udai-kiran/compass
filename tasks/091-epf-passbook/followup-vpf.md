# Follow-up: emit `"vpf"` from the payslip AI-extraction parser

Brief: make the payslip AI tool spec able to emit the `"vpf"` canonical component
kind so EPF passbook import can populate the VPF columns.

## Files inspected

- `apps/api/src/modules/tax/services/payslip-parse.ts` (full read)
- `apps/api/src/modules/tax/services/payslip-parse.test.ts` (full read)
- `apps/api/src/modules/tax/services/epf-contributions.ts` (grep + lines 210–264)
- `apps/api/src/modules/tax/schema.ts` (grep for vpf)
- `packages/shared/src/schemas/tax.ts` (grep + lines 65–94)

## Files changed

- `apps/api/src/modules/tax/services/payslip-parse.ts`
- `apps/api/src/modules/tax/services/payslip-parse.test.ts`

No other file touched.

## Sanity check of the mapping target (step 2) — PASS

The chain is consistent end to end; nothing mismatched, so no scope expansion
was needed.

- `packages/shared/src/schemas/tax.ts:76-88` — `CanonicalComponentKindSchema`
  contains `"vpf"`, positioned immediately after `"eps"`:

  ```
  76	export const CanonicalComponentKindSchema = z.enum([
  ...
  83	  "eps",
  84	  "vpf",
  85	  "professional_tax",
  ```

- `apps/api/src/modules/tax/services/epf-contributions.ts:235-237` — live branch:

  ```
  235	      case "vpf":
  236	        expectedVpfPaise += comp.currentPaise;
  237	        break;
  ```

  and it is written through at line 260 (`expectedVpfPaise,`) / line 157 + 269
  (`expectedVpfPaise: sql`EXCLUDED.expected_vpf_paise``).

- `apps/api/src/modules/tax/schema.ts:313` and `:325` — both columns exist with
  the expected spelling:

  ```
  313	    expectedVpfPaise: bigint("expected_vpf_paise", { mode: "number" }).notNull().default(0),
  325	    actualVpfPaise: bigint("actual_vpf_paise", { mode: "number" }),
  ```

So the only gap was the tool-spec enum, exactly as the brief stated.

## Implementation details

### 1. `payslip-parse.ts` — tool enum + description

Added `"vpf"` to the `canonicalKind` enum inside `PARSE_PAYSLIP_TOOL`, placed
after `"eps"` to match the ordering of `CanonicalComponentKindSchema` in
`packages/shared/src/schemas/tax.ts`. Extended the adjacent description string
(which already enumerated `employee_epf` / `employer_epf` / `eps`) with a
minimal, style-consistent mention of `vpf`.

Both files are currently untracked in git (`git status --porcelain` reports `??`
for them), so `git diff` produces no output. The change is therefore shown as a
hand-written before/after of the single edited region.

Before:

```ts
            canonicalKind: {
              type: "string",
              enum: [
                "basic",
                "hra",
                "special_allowance",
                "other_earning",
                "employee_epf",
                "employer_epf",
                "eps",
                "professional_tax",
                "other_deduction",
                "employer_contribution",
              ],
              description:
                "Canonical classification. Use employee_epf for the employee's share, " +
                "employer_epf for the employer's recognized PF contribution (NOT NPS/80CCD(2)), " +
                "and eps for the pension diversion.",
            },
```

After:

```ts
            canonicalKind: {
              type: "string",
              enum: [
                "basic",
                "hra",
                "special_allowance",
                "other_earning",
                "employee_epf",
                "employer_epf",
                "eps",
                "vpf",
                "professional_tax",
                "other_deduction",
                "employer_contribution",
              ],
              description:
                "Canonical classification. Use employee_epf for the employee's share, " +
                "employer_epf for the employer's recognized PF contribution (NOT NPS/80CCD(2)), " +
                "eps for the pension diversion, " +
                "and vpf for voluntary employee PF beyond the statutory EPF contribution.",
            },
```

Nothing else in the file was modified — the `PAYSLIP_SYSTEM` prompt, the Zod
schemas, `rupeesToPaise`, `redactPayslipText`, and the `parsePayslip`
orchestrator are untouched.

### 2. `payslip-parse.test.ts` — one added test

Added a single test inside the existing `describe("parsePayslipFromTurn")`
suite, immediately before `"accepts output with only required fields (optional
fields absent)"`. It mirrors the existing per-kind style (a `makeTurn` with one
matching tool call, then assertions on the parsed components) and additionally
asserts the tool spec advertises `"vpf"` — without that, the model could never
emit the kind even though the Zod schema accepts it.

```ts
  it("accepts a vpf component (voluntary PF flows to the EPF passbook VPF columns)", () => {
    const turn = makeTurn({
      toolCalls: [
        {
          id: "call1",
          name: PARSE_PAYSLIP_TOOL.name,
          input: {
            payMonth: "2025-06",
            components: [
              {
                rawLabel: "Voluntary PF",
                canonicalKind: "vpf",
                category: "deduction",
                currentRupees: 5000,
                confidence: 0.9,
              },
            ],
          },
        },
      ],
    });
    const result = parsePayslipFromTurn(turn);
    assert.ok(result !== null);
    assert.equal(result!.components.length, 1);
    assert.equal(result!.components[0]!.canonicalKind, "vpf");
    assert.equal(rupeesToPaise(result!.components[0]!.currentRupees), 500000);
    // The tool spec must advertise "vpf" or the model can never emit it.
    const kindProp = (
      PARSE_PAYSLIP_TOOL.inputSchema as {
        properties: {
          components: { items: { properties: { canonicalKind: { enum: string[] } } } };
        };
      }
    ).properties.components.items.properties.canonicalKind;
    assert.ok(kindProp.enum.includes("vpf"), 'tool enum must include "vpf"');
  });
```

## Verification

All four commands run from `/work/personal/compass`.

### 1. `node --test apps/api/src/modules/tax/services/payslip-parse.test.ts`

```
▶ parsePayslipFromTurn
  ✔ returns parsed output with 1 matching tool call (1.550666ms)
  ✔ falls back to prose JSON with 0 matching tool calls (Ollama path) (0.26203ms)
  ✔ FAILS CLOSED with 2+ matching tool calls (0.326422ms)
  ✔ returns null for a wrong-name tool call (no prose JSON fallback) (0.172299ms)
  ✔ returns null for malformed model output (0.137792ms)
  ✔ returns null for output with non-finite amounts (0.214459ms)
  ✔ returns null for component with unknown canonicalKind (0.22022ms)
  ✔ accepts a vpf component (voluntary PF flows to the EPF passbook VPF columns) (0.152641ms)
  ✔ accepts output with only required fields (optional fields absent) (0.148794ms)
✔ parsePayslipFromTurn (3.934089ms)
▶ rupeesToPaise
  ✔ converts whole rupees exactly (0.166617ms)
  ✔ rounds fractional rupees correctly (0.069362ms)
  ✔ handles negative amounts (adjustments) (0.071527ms)
  ✔ returns null for non-finite values (0.054644ms)
  ✔ returns null for null/undefined (0.03678ms)
  ✔ handles large but safe salaries (0.034195ms)
✔ rupeesToPaise (0.581889ms)
▶ redactPayslipText
  ✔ redacts PAN numbers from payslip text (0.900506ms)
  ✔ redacts Aadhaar numbers from payslip text (0.352031ms)
  ✔ redacts phone numbers from payslip text (0.072889ms)
  ✔ redacts IFSC codes from payslip text (0.064513ms)
  ✔ redacts employee code in labelled form (0.067318ms)
  ✔ redacts employee names in labelled fields without a stored identity match (0.065084ms)
  ✔ redacts dates of birth in labelled fields (0.091525ms)
  ✔ redacts known employee names from payslip text (0.172349ms)
  ✔ preserves salary component names and amounts (0.081516ms)
  ✔ handles empty text gracefully (0.038914ms)
✔ redactPayslipText (2.065788ms)
ℹ tests 25
ℹ suites 3
ℹ pass 25
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 478.328501
EXIT=0
```

### 2. `node --test apps/api/src/modules/tax/services/epf-contributions.test.ts`

```
▶ computeStatus
  ✔ returns pending when actual employee is null (passbook not confirmed) (0.475597ms)
  ✔ returns pending even when other actuals are set but employee is null (0.077848ms)
  ✔ returns matched on an exact match across all three columns (0.077858ms)
  ✔ returns matched when the difference is within the 1% tolerance (0.067789ms)
  ✔ returns mismatch when employee differs by more than 1% (0.068821ms)
  ✔ returns mismatch when employer differs by more than 1% (0.06841ms)
  ✔ returns mismatch when eps differs by more than 1% (0.069853ms)
  ✔ treats a null expected column as not comparable (no mismatch) (0.0627ms)
  ✔ treats a zero expected column as not comparable (avoids divide-by-zero) (0.077247ms)
  ✔ treats a null actual (other than employee) as not comparable (0.106063ms)
  ✔ flags a mismatch when actual is lower than expected by more than 1% (0.070224ms)
  ✔ returns matched when all expected are null but employee actual is set (0.056127ms)
✔ computeStatus (1.983601ms)
▶ fyToWageMonthRange
  ✔ maps FY 2025-26 to April 2025 → March 2026 (0.431262ms)
  ✔ maps FY 2024-25 to April 2024 → March 2025 (0.058542ms)
  ✔ handles a century rollover FY 2099-00 (0.055064ms)
  ✔ produces a range that string-orders correctly for wage_month comparison (0.096975ms)
✔ fyToWageMonthRange (0.735472ms)
▶ buildEpfContributionDto
  ✔ converts an unconfirmed payslip-derived row (0.342943ms)
  ✔ computes 80C eligibility from expected values when unconfirmed (0.060335ms)
  ✔ excludes employer EPF and EPS from 80C eligibility (0.050336ms)
  ✔ prefers actual over expected for 80C eligibility once confirmed (0.052399ms)
  ✔ mixes actual employee with expected vpf when only vpf is unconfirmed (0.05269ms)
  ✔ treats a fully null expected/actual row as zero 80C eligibility (0.052871ms)
  ✔ carries a null payslipId for manual entries (0.043914ms)
  ✔ carries a null employerName (0.041599ms)
  ✔ carries gapReason through (0.046478ms)
  ✔ carries the matched status through (0.06819ms)
✔ buildEpfContributionDto (0.936515ms)
ℹ tests 26
ℹ suites 3
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 354.622235
EXIT=0
```

### 3. `npm run typecheck`

```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present


> @compass/api@0.1.0 typecheck
> tsc --noEmit


> @compass/docs@0.1.0 typecheck
> tsc --noEmit


> @compass/extractor@0.1.0 typecheck
> tsc --noEmit


> @compass/ingestor@0.1.0 typecheck
> tsc --noEmit


> @compass/web@0.1.0 typecheck
> tsc --noEmit


> @compass/ai@0.1.0 typecheck
> tsc --noEmit


> @compass/shared@0.1.0 typecheck
> tsc --noEmit

EXIT=0
```

### 4. `npm run lint`

```
> compass@0.1.0 lint
> eslint .

EXIT=0
```

## Assumptions

- Placed `"vpf"` after `"eps"` in the enum to mirror the ordering of the shared
  `CanonicalComponentKindSchema`. JSON-Schema enum order is not semantic, so this
  is cosmetic consistency only.
- "One test exercising a vpf component through the parse path" was read as the
  pure `parsePayslipFromTurn` seam, since that is the only parse path this test
  file exercises (the `parsePayslip` orchestrator needs a DB, storage, and an AI
  provider, and has no existing test here to mirror).
- The description string was extended rather than rewritten, so the wording for
  the pre-existing kinds is unchanged apart from `"and eps"` → `"eps"` where the
  clause is no longer last in the list.

## Unresolved risks

- The `PAYSLIP_SYSTEM` prompt (`payslip-parse.ts:284-297`) still does not mention
  VPF. Models will now see `vpf` in the tool enum and its description, which is
  what the brief asked for, but extraction recall for VPF lines may be lower than
  for kinds that the system prompt calls out explicitly. Out of scope here —
  flagging only.
- No test covers the full `parsePayslip` → `createExtractedPayslip` →
  `importFromPayslip` path for a VPF component, so the end-to-end population of
  `expected_vpf_paise` from an AI-extracted payslip is verified only by
  inspection of the (already existing and already tested) `case "vpf":` branch,
  not by an integration test.
- Both changed files are untracked (`??`), so `git diff` shows nothing for them;
  the diff above is hand-transcribed from the edited region rather than captured
  git output.

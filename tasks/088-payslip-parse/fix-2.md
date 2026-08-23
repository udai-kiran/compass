Files changed:

- `apps/api/src/modules/tax/services/payslip-review.ts`
- `apps/api/src/modules/tax/services/payslip-parse.ts`

Changes made:

- Reject component corrections that contain neither `currentPaise` nor `ytdPaise`.
- Defer document storage until parsing and component amount validation succeed; log storage failures.
- Reject AI-extracted pay months outside the requested Indian financial year.

Complete diff:

```diff
diff --git a/apps/api/src/modules/tax/services/payslip-review.ts b/apps/api/src/modules/tax/services/payslip-review.ts
@@
     for (const corr of corrections.componentCorrections) {
       const compSet: Record<string, unknown> = {};
       if (corr.currentPaise !== undefined) compSet.currentPaise = corr.currentPaise;
       if (corr.ytdPaise !== undefined) compSet.ytdPaise = corr.ytdPaise;
+      if (Object.keys(compSet).length === 0) {
+        throw new HttpError(
+          400,
+          `Component correction for ${corr.id} must include at least one field to change (currentPaise or ytdPaise)`,
+        );
+      }
       if (Object.keys(compSet).length > 0) {
         const affected = await tx
           .update(payslipComponents)
diff --git a/apps/api/src/modules/tax/services/payslip-parse.ts b/apps/api/src/modules/tax/services/payslip-parse.ts
@@
-  // F2: Store document permanently for audit trail and re-parse (D6/AC7).
-  // Failure is non-fatal — the parse continues but documentKey stays null.
-  let documentKey: string | null = null;
-  try {
-    documentKey = await storage.put(input.buffer, input.contentType);
-  } catch {
-    // Non-fatal: document storage failure should not block parse
-  }
-
   let turn: ChatTurn;
@@
-    // Document was already persisted above for audit trail (F2).
     const base64Data = input.buffer.toString("base64");
@@
   if (!modelOutput.payMonth) {
     return {
       available: false,
@@
     };
   }
 
+  // Validate extracted payMonth falls within the requested FY (Indian FY: Apr–Mar).
+  {
+    const [payYearStr, payMonthStr] = modelOutput.payMonth.split("-");
+    const payYear = Number(payYearStr);
+    const payMonthNum = Number(payMonthStr);
+    const [fyYearStr] = fy.split("-");
+    const fyStartYear = Number(fyYearStr);
+    const fyEndYear = fyStartYear + 1;
+    const inFY =
+      (payMonthNum >= 4 && payMonthNum <= 12 && payYear === fyStartYear) ||
+      (payMonthNum >= 1 && payMonthNum <= 3 && payYear === fyEndYear);
+    if (!inFY) {
+      return {
+        available: false,
+        message: `AI extracted pay month ${modelOutput.payMonth} which does not fall within FY ${fy}. Use POST /api/tax/payslips/manual to enter data manually.`,
+      };
+    }
+  }
+
   // F4: At least one component is required — an empty component list is unusable.
@@
     });
   }
 
+  // Store document permanently only after we know parse succeeded.
+  let documentKey: string | null = null;
+  try {
+    documentKey = await storage.put(input.buffer, input.contentType);
+  } catch (err) {
+    console.warn("payslip-parse: document storage failed, continuing without documentKey", err);
+  }
+
   // Convert header rupees → paise deterministically, then persist.
```

Verification commands and literal outputs:

```text
$ npm run typecheck 2>&1
exit code: 0

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
```

```text
$ npm run lint 2>&1
exit code: 0

> compass@0.1.0 lint
> eslint .
```

```text
$ node --experimental-test-module-mocks --test apps/api/src/modules/tax/services/payslip-parse.test.ts apps/api/src/modules/tax/services/payslip-review.test.ts 2>&1
exit code: 0

▶ parsePayslipFromTurn
  ✔ returns parsed output with 1 matching tool call (1.530006ms)
  ✔ falls back to prose JSON with 0 matching tool calls (Ollama path) (0.262009ms)
  ✔ FAILS CLOSED with 2+ matching tool calls (0.307566ms)
  ✔ returns null for a wrong-name tool call (no prose JSON fallback) (0.15209ms)
  ✔ returns null for malformed model output (0.131942ms)
  ✔ returns null for output with non-finite amounts (0.182147ms)
  ✔ returns null for component with unknown canonicalKind (0.198458ms)
  ✔ accepts output with only required fields (optional fields absent) (0.104069ms)
✔ parsePayslipFromTurn (3.523397ms)
▶ rupeesToPaise
  ✔ converts whole rupees exactly (0.149515ms)
  ✔ rounds fractional rupees correctly (0.098107ms)
  ✔ handles negative amounts (adjustments) (0.071796ms)
  ✔ returns null for non-finite values (0.05247ms)
  ✔ returns null for null/undefined (0.040517ms)
  ✔ handles large but safe salaries (0.041569ms)
✔ rupeesToPaise (0.591648ms)
▶ redactPayslipText
  ✔ redacts PAN numbers from payslip text (0.634941ms)
  ✔ redacts Aadhaar numbers from payslip text (0.295904ms)
  ✔ redacts phone numbers from payslip text (0.070344ms)
  ✔ redacts IFSC codes from payslip text (0.065265ms)
  ✔ redacts employee code in labelled form (0.067008ms)
  ✔ redacts known employee names from payslip text (0.142201ms)
  ✔ preserves salary component names and amounts (0.079371ms)
  ✔ handles empty text gracefully (0.044825ms)
✔ redactPayslipText (1.528633ms)
▶ buildComponentDto
  ✔ converts DB row to component DTO (0.578963ms)
  ✔ handles null optional fields (0.099841ms)
✔ buildComponentDto (1.207401ms)
▶ buildPayslipDto
  ✔ converts DB row to payslip DTO with components (0.21503ms)
  ✔ handles null optional header fields (0.364134ms)
  ✔ sets status correctly for pending payslip (0.108096ms)
  ✔ sets status correctly for rejected payslip (0.091705ms)
✔ buildPayslipDto (0.935243ms)
▶ computeFyTdsPaise
  ✔ sums tds_current_paise for accepted payslips only (0.167008ms)
  ✔ NEVER sums tds_ytd_paise (D4 invariant) (0.112475ms)
  ✔ returns 0 for empty list (0.070434ms)
  ✔ returns 0 when all payslips are pending (0.100552ms)
  ✔ excludes accepted payslips with null tds_current_paise (0.065585ms)
  ✔ handles multiple employers in the same FY (D4 multi-employer) (0.066236ms)
✔ computeFyTdsPaise (0.752875ms)
ℹ tests 34
ℹ suites 6
ℹ pass 34
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 466.482476
```

```text
$ npm run test -w packages/shared 2>&1
exit code: 0

> @compass/shared@0.1.0 test
> node --test "src/**/*.test.ts"

✔ ddmmyyyyToISO returns null for ISO format (user typing 1990-05-15 in a DD-MM-YYYY field) (0.838137ms)
✔ ddmmyyyyToISO returns null for incomplete/partial dates (0.142913ms)
✔ ddmmyyyyToISO returns null for impossible dates (0.15204ms)
✔ ddmmyyyyToISO returns null for 2-digit years (0.208027ms)
✔ ddmmyyyyToISO returns null for mixed/wrong separators (0.131451ms)
✔ ddmmyyyyToISO SUCCEEDS for valid DD-MM-YYYY dates (0.212856ms)
✔ DateField isInRange would reject future dates when max={todayInIST()} (0.128164ms)
✔ toISODate formats as YYYY-MM-DD (1.877588ms)
✔ monthKey formats as YYYY-MM (0.268983ms)
✔ todayInIST returns a YYYY-MM-DD string (13.176586ms)
✔ todayInIST is ahead of UTC date late at night IST (past UTC midnight) (0.27836ms)
✔ formatDisplayDate converts YYYY-MM-DD to DD-Mon-YYYY (0.2988ms)
✔ formatDisplayDate preserves zero-padded day (0.437033ms)
✔ formatDisplayDate handles all 12 months correctly (0.311934ms)
✔ formatDisplayDate returns original string unchanged for malformed input (0.101431ms)
✔ formatDisplayDate handles leap year Feb 29 correctly (0.372069ms)
✔ formatDisplayDate rejects invalid Feb 29 in non-leap year (0.35686ms)
✔ formatDisplayDate rejects Feb 29 in century non-leap year (0.200623ms)
✔ formatDisplayDate accepts Feb 29 in century leap year (0.08928ms)
✔ formatDisplayDate rejects April 31 (30-day month) (0.067699ms)
✔ formatDisplayDate rejects month zero (0.070274ms)
✔ formatDisplayDate rejects day zero (0.079672ms)
✔ isoToDDMMYYYY converts YYYY-MM-DD to DD-MM-YYYY (0.127222ms)
✔ isoToDDMMYYYY preserves zero-padded day and month (0.064724ms)
✔ isoToDDMMYYYY handles all 12 months correctly (0.137412ms)
✔ isoToDDMMYYYY passthrough on malformed input (0.078109ms)
✔ isoToDDMMYYYY passthrough on invalid month (0.068872ms)
✔ isoToDDMMYYYY passthrough on invalid day (0.069472ms)
✔ isoToDDMMYYYY handles leap year Feb 29 correctly (0.075233ms)
✔ isoToDDMMYYYY passthrough on invalid Feb 29 in non-leap year (0.060776ms)
✔ isoToDDMMYYYY passthrough on April 31 (0.067699ms)
✔ ddmmyyyyToISO parses DD-MM-YYYY to YYYY-MM-DD (0.182428ms)
✔ ddmmyyyyToISO accepts slash separator (0.112114ms)
✔ ddmmyyyyToISO accepts dot separator (0.082497ms)
✔ ddmmyyyyToISO accepts single-digit day and month (0.306284ms)
✔ ddmmyyyyToISO returns canonical zero-padded ISO (0.090002ms)
✔ ddmmyyyyToISO validates leap year Feb 29 (0.095041ms)
✔ ddmmyyyyToISO rejects April 31 (0.088498ms)
✔ ddmmyyyyToISO rejects month zero (0.215811ms)
✔ ddmmyyyyToISO rejects day zero (0.088569ms)
✔ ddmmyyyyToISO rejects 2-digit year (0.075233ms)
✔ ddmmyyyyToISO returns null on empty input (0.070014ms)
✔ ddmmyyyyToISO returns null on malformed input (0.153903ms)
✔ ddmmyyyyToISO rejects sub-1000 four-digit year like 0999 (0.083498ms)
✔ ddmmyyyyToISO accepts valid 4-digit year >= 1000 (0.096654ms)
✔ ddmmyyyyToISO rejects mixed separators (0.085704ms)
✔ ddmmyyyyToISO rejects overlong day field (0.074181ms)
✔ ddmmyyyyToISO rejects overlong month field (0.090502ms)
✔ ddmmyyyyToISO rejects overlong year field (0.078109ms)
✔ ddmmyyyyToISO month-end round-trip sanity cases (0.36198ms)
✔ calculateAge returns correct age for past date of birth (0.305733ms)
✔ calculateAge returns correct age when birthday not yet reached this year (0.173498ms)
✔ calculateAge returns correct age when birthday already passed this year (0.169733ms)
✔ calculateAge returns null for null date of birth (0.080623ms)
✔ calculateAge returns null for future date of birth (0.159764ms)
✔ calculateAge handles birthday on exact date (0.156498ms)
✔ calculateAge handles edge case of birthday tomorrow (0.163572ms)
✔ isRealIsoDate accepts a real calendar date (0.102916ms)
✔ isRealIsoDate rejects an impossible calendar date (0.084498ms)
✔ isRealIsoDate rejects an out-of-range month (0.077157ms)
✔ isRealIsoDate rejects a non-date string (0.063411ms)
✔ isRealIsoDate rejects a non-zero-padded date (0.067699ms)
✔ isRealIsoDate accepts Feb 29 in a leap year (0.077157ms)
✔ isRealIsoDate rejects Feb 29 in a non-leap year (0.072498ms)
✔ inclusiveDayCount returns 1 for the same day (0.091431ms)
✔ inclusiveDayCount returns 31 for a full March (0.073431ms)
✔ inclusiveDayCount counts correctly across a leap February (0.064724ms)
✔ unitPricePaise: ₹100 / 5000 g → 2000 p (₹20/kg) (1.37947ms)
✔ unitPricePaise: ₹100 / 2000 ml → 5000 p (₹50/L) (0.118776ms)
✔ unitPricePaise: ₹100 / 6 pieces → 1667 p (round-half-up) (0.08416ms)
✔ unitPricePaise: exact half rounds up (3p / 2 pieces = 1.5 → 2) (0.087256ms)
✔ unitPricePaise: 7p / 4 pieces = 1.75 → 2 (rounds up) (0.169233ms)
✔ unitPricePaise: zero price is valid → 0 (0.107195ms)
✔ unitPricePaise: ref=1000 for g (not piece) — confirms unit matters (0.167498ms)
✔ unitPricePaise: result > MAX_SAFE_INTEGER throws RangeError (0.325731ms)
✔ unitPricePaise: zero quantityBase → RangeError (0.428498ms)
✔ unitPricePaise: negative quantityBase → RangeError (0.517386ms)
✔ unitPricePaise: negative pricePaise → RangeError (0.200131ms)
✔ unitPricePaise: fractional pricePaise → RangeError (0.384833ms)
✔ unitPricePaise: fractional quantityBase → RangeError (0.088498ms)
✔ unitPricePaise: invalid unit → RangeError (0.092498ms)
✔ unitPricePaise: result is non-increasing as quantityBase increases (0.256228ms)
✔ unitPricePaise: result is always non-negative (0.082498ms)
✔ convertToBaseQuantity: '1.5' kg → 1500 g (0.720944ms)
✔ convertToBaseQuantity: '0.25' litre → 250 ml (0.11017ms)
✔ convertToBaseQuantity: '6' piece → 6 piece (0.086498ms)
✔ convertToBaseQuantity: '500' g → 500 g (passthrough) (0.072498ms)
✔ convertToBaseQuantity: '1000' ml → 1000 ml (passthrough) (0.075498ms)
✔ convertToBaseQuantity: '1' kg → 1000 g (0.086498ms)
✔ convertToBaseQuantity: '0.001' kg → 1 g (3 dp exact) (0.074498ms)
✔ convertToBaseQuantity: '2.5' kg → 2500 g (0.088498ms)
✔ convertToBaseQuantity: '0.001' litre → 1 ml (3 dp exact) (0.083498ms)
✔ convertToBaseQuantity: excess precision for kg → RangeError (0.101498ms)
✔ convertToBaseQuantity: excess precision for litre → RangeError (0.090498ms)
✔ convertToBaseQuantity: fractional g → RangeError (0 dp max) (0.086498ms)
✔ convertToBaseQuantity: fractional ml → RangeError (0 dp max) (0.085498ms)
✔ convertToBaseQuantity: fractional piece → RangeError (0 dp max) (0.095498ms)
✔ convertToBaseQuantity: tiny-positive-that-would-round-to-0 rejected by excess-dp check ('0.0004' kg → 4 dp) (0.085498ms)
✔ convertToBaseQuantity: invalid format → RangeError (0.343498ms)
✔ convertToBaseQuantity: invalid displayUnit → RangeError (0.152498ms)
✔ convertToBaseQuantity deepEqual: '5' kg → {quantityBase:5000, unit:'g'} (0.245498ms)
✔ convertToBaseQuantity deepEqual: '1.500' kg → {quantityBase:1500, unit:'g'} (0.093498ms)
✔ masks the user's own name but keeps merchant names (1.89908ms)
✔ masks a salutation name even when it isn't the stored user (0.296886ms)
✔ masks the user's VPA but keeps a merchant's VPA (0.213498ms)
✔ masks a VPA whose handle matches a user name token even if unsaved (1.383918ms)
✔ masks all email addresses in the body (0.195498ms)
✔ keeps the bank-masked last-4 and rupee amounts, masks full account numbers (0.159498ms)
✔ masks phone, PAN and Aadhaar (0.158498ms)
✔ masks a labelled PIN code but leaves a bare 6-digit amount alone (0.170498ms)
✔ structural:false leaves sender routing but still strips the user's own identifiers (0.177498ms)
✔ masks a hyphen-grouped card number (0.245498ms)
✔ masks a space-grouped card number (0.128498ms)
✔ masks a spaced account number (0.128498ms)
✔ masks a spaced mobile number (0.340498ms)
✔ masks a +91-prefixed spaced mobile number (0.095498ms)
✔ masks a hyphenated Aadhaar (0.468498ms)
✔ masks a labelled multi-line address but leaves the following transaction line intact (0.432498ms)
✔ masks an address ending in a labelled PIN and leaves the following transaction line intact (0.105498ms)
✔ a PIN-less address followed by a dated transaction line does not swallow the transaction (0.106498ms)
✔ a PIN-less address followed by an amount line does not swallow that line (0.100498ms)
✔ does not touch Indian-grouped rupee amounts, dates, masked last-4, or statement lines (0.171498ms)
✔ a hyphenated date followed by a space-separated amount survives completely intact (0.093498ms)
✔ a uniformly space-grouped account number is masked but a trailing decimal amount survives (0.117498ms)
✔ a spaced account number that happens to be Aadhaar-shaped is still masked, and the trailing amount still survives (0.088498ms)
✔ empty text and empty identity are safe (0.081498ms)
✔ AI settings reject unsafe base URL shapes (1.901174ms)
✔ stored-key state is not accepted from the client (0.251498ms)
✔ account numbers accept the range Indian banks actually issue (1.314105ms)
✔ account numbers reject anything that isn't digits (0.206498ms)
✔ IFSC is uppercased on the way in (0.369498ms)
✔ IFSC enforces the 5th-character zero (0.275498ms)
✔ IFSC allows digits in the branch code (0.130498ms)
✔ UPI IDs normalise to lowercase (0.172498ms)
✔ UPI IDs accept the shapes banks hand out (0.141498ms)
✔ UPI IDs reject things that aren't handles (0.242498ms)
✔ a UPI ID can't be listed twice on one account (0.531498ms)
✔ empty string clears a bank detail rather than failing validation (1.488447ms)
✔ omitting requiredAmbPaise leaves it undefined, so a stored requirement is preserved (0.11562ms)
✔ requiredAmbPaise at the cap is accepted, one paisa above is rejected (1.748293ms)
✔ a half-typed IFSC is still rejected when other fields are fine (0.295498ms)
✔ only bank accounts carry bank details (0.085498ms)
✔ create schema still defaults optional fields (unchanged create-time behavior) (2.383884ms)
✔ a single-field partial update returns only that field (defaults not resurrected) (1.240645ms)
✔ updating kind alone returns only kind (the field implicated in the EMI pause/resume bug) (0.139666ms)
✔ an empty partial update is accepted and returns an empty object (0.106498ms)
✔ a full-object update still validates and passes every value through unchanged (0.4039ms)
✔ an invalid value for a present field still fails validation (constraint preserved by unwrap) (0.533688ms)
✔ explicit null clears for nullable fields still parse and pass through as null (0.113498ms)
✔ effectiveNecessity: transaction override 'essential' beats category default 'non_essential' (0.950311ms)
✔ effectiveNecessity: transaction override 'non_essential' beats category default 'essential' (0.100498ms)
✔ effectiveNecessity: no override falls back to the category default on an expense category (0.084498ms)
✔ effectiveNecessity: no override and no category default is null (0.089498ms)
✔ effectiveNecessity: no override on an income category ignores its default (0.096498ms)
✔ effectiveNecessity: an override still stands even on an income category (0.072498ms)
✔ effectiveNecessity: no override, uncategorized (null category kind) is null (0.076498ms)
✔ CreateTransactionSchema defaults necessity to null when the client omits it (1.464501ms)
✔ UpdateTransactionSchema leaves necessity absent when the client omits it (0.596106ms)
✔ effectiveNecessity: a category default is ignored when the kind is unknown (0.262498ms)
✔ drawing power is the limit minus what you owe (0.724371ms)
✔ drawing power never goes negative (0.104498ms)
✔ only overdraft loans carry overdraft details (0.098498ms)
✔ overdraft details default to zero when unset (1.19612ms)
✔ a home-loan rate above 20% is rejected as a typo (0.927978ms)
✔ a negative sanctioned limit is rejected (0.185498ms)
✔ period defaults to monthly when omitted (1.985424ms)
✔ valid monthly and annual queries are accepted (0.278498ms)
✔ custom period missing from is rejected (0.717799ms)
✔ custom period missing to is rejected (0.217498ms)
✔ custom period with from after to is rejected (0.168498ms)
✔ custom period with from === to (single-day range) is accepted (0.134498ms)
✔ custom period spanning more than MAX_REPORT_RANGE_DAYS is rejected (0.140498ms)
✔ custom period exactly at MAX_REPORT_RANGE_DAYS is accepted (0.113498ms)
✔ monthly period with a bare-year key is rejected (0.242498ms)
✔ annual period with a month key is rejected (0.259498ms)
✔ an out-of-range month key is rejected (0.134498ms)
✔ supports vehicles and the common household connection types (1.230455ms)
✔ resource input keeps a friendly name and defaults optional metadata (1.046234ms)
✔ a single-field partial update returns only that field (defaults not resurrected) (0.826676ms)
✔ updating archived alone returns only archived (0.153111ms)
✔ an empty partial update is accepted and returns an empty object (0.222183ms)
✔ explicit values for all fields still get trim-transformed and enforce max-length bounds (1.033279ms)
✔ NormalizedUnitSchema accepts g, ml, piece and rejects kg and litre (1.33282ms)
✔ PriceObservationSchema rejects a fractional pricePaise (0.993204ms)
✔ PriceObservationSchema rejects a negative packQuantityBase and accepts null (0.292778ms)
✔ CatalogItemSchema rejects an empty canonicalName and accepts brand/categoryId as null (0.52463ms)
✔ ShoppingListItemSchema rejects an empty rawText and rejects a negative position (0.556871ms)
✔ ShoppingUnitsResponseSchema parses valid entry and rejects an empty label (0.457061ms)
✔ CartDraftSchema accepts totalPaise 0 and rejects totalPaise 12.5 (0.348093ms)
✔ CatalogItemSchema rejects quantity-without-unit and unit-without-quantity; accepts both-null and both-set (0.193498ms)
✔ ShoppingListItemSchema rejects quantity-without-unit and unit-without-quantity; accepts both-null and both-set (0.222498ms)
✔ PriceObservationSchema rejects quantity-without-unit and unit-without-quantity; accepts both-null and both-set (0.235498ms)
✔ PantryItemSchema rejects quantity-without-unit and unit-without-quantity; accepts both-null and both-set (0.369498ms)
✔ HabitProfileSchema rejects consumption-without-unit and unit-without-consumption; accepts both-null and both-set (0.354498ms)
✔ PriceObservationSchema rejects pricePaise -1 (0.107498ms)
✔ CartDraftSchema rejects totalPaise -1 (0.087498ms)
✔ PriceObservationSchema rejects mrpPaise -1 but accepts mrpPaise null (0.171498ms)
✔ HabitProfileSchema accepts a valid row with unit and consumptionBasePerMonth both set (0.073498ms)
✔ quantity fields reject fractional values across all five quantity-bearing schemas (0.256498ms)
✔ CreateShoppingListSchema accepts name+null note, defaults note to null (0.238498ms)
✔ CreateShoppingListSchema rejects blank name (0.156498ms)
✔ CreateShoppingListSchema rejects name > 120 chars (0.096498ms)
✔ CreateShoppingListSchema rejects note > 1000 chars (0.101498ms)
✔ UpdateShoppingListSchema requires all three fields; omitting any is a 400 (0.350498ms)
✔ CreateShoppingListItemSchema accepts rawText only (no catalogId/quantity/unit) (0.229498ms)
✔ CreateShoppingListItemSchema rejects blank rawText (0.110498ms)
✔ CreateShoppingListItemSchema rejects rawText > 200 chars (0.110498ms)
✔ CreateShoppingListItemSchema enforces quantity/unit pairing (0.123498ms)
✔ UpdateShoppingListItemSchema requires all five fields; omitting any is a 400 (0.369498ms)
✔ UpdateShoppingListItemSchema enforces quantity/unit pairing (0.134498ms)
✔ ReorderItemsSchema accepts an empty array (0.155498ms)
✔ ReorderItemsSchema accepts a valid list of uuids (0.073498ms)
✔ ReorderItemsSchema rejects duplicate uuids (0.107498ms)
✔ ReorderItemsSchema rejects non-uuid strings (0.119498ms)
✔ ShoppingListWithItemsSchema accepts a list with zero items (0.349498ms)
✔ ShoppingListWithItemsSchema propagates item pairing refinement (0.154498ms)
✔ CreateShoppingListSchema deepEqual: name+note round-trip (0.473498ms)
✔ CreateShoppingListSchema deepEqual: name only — url null, isActive true (0.072498ms)
✔ UpdateShoppingListSchema deepEqual: full replace round-trip (archived) (0.076498ms)
✔ CreateShoppingListSchema deepEqual: full create round-trip with quantity (0.114498ms)
✔ ParsedShoppingItemSchema accepts rawText only (both quantity+unit null) (0.206498ms)
✔ sipDateRangeValid: a null endDate (open-ended) is always valid (0.658135ms)
✔ sipDateRangeValid: endDate on or after startDate is valid (0.123498ms)
✔ sipDateRangeValid: endDate before startDate is invalid (0.117498ms)
✔ CreateSipSchema: accepts a valid startDate/endDate pair (1.3275ms)
✔ CreateSipSchema: accepts a null (open-ended) endDate (0.159498ms)
✔ CreateSipSchema: rejects endDate before startDate (0.302498ms)
✔ unitsForInstallment: derives units from paise amount and NAV (0.096498ms)
✔ unitsForInstallment: rounds to 4 decimals (0.078498ms)
✔ unitsForInstallment: throws on a zero NAV (0.276498ms)
✔ unitsForInstallment: throws on a negative NAV (0.163498ms)
✔ RecordSipInstallmentSchema: rejects both units and nav missing (8.626283ms)
✔ RecordSipInstallmentSchema: rejects both units and nav set (0.255498ms)
✔ RecordSipInstallmentSchema: accepts units alone (0.151498ms)
✔ RecordSipInstallmentSchema: accepts nav alone (0.151629ms)
✔ RecordSipInstallmentSchema: rejects a zero or negative amountPaise (0.419498ms)
✔ defaultSipDate: at 00:30 IST it returns the IST day, not the earlier UTC day (0.277498ms)
✔ defaultSipDate: defaults its clock to now and yields today in IST (0.209498ms)
✔ RecordSipInstallmentSchema: an omitted date defaults to today in IST (0.226498ms)
✔ CreateSipSchema: an omitted startDate defaults to today in IST (0.302498ms)
✔ CreateSipSchema: an omitted fundingSource defaults to bank_debit (0.157498ms)
✔ UpdateSipSchema: fundingSource is optional and accepts a valid value (0.461498ms)
✔ sipFundingSourceIssue: payroll + mf_folio is rejected (0.086498ms)
✔ CreateSipSchema: rejects a payroll + mf_folio body (0.207498ms)
✔ create: an empty title is rejected (1.464661ms)
✔ create: a whitespace-only title is rejected (trimmed to empty) (0.146498ms)
✔ create: a title of exactly 200 chars is accepted (0.119498ms)
✔ create: a title of 201 chars is rejected (0.141498ms)
✔ update: an empty, whitespace-only, or 201-char title is rejected (0.523498ms)
✔ create: notes defaults to empty string and dueDate/transactionId default to unset (0.483498ms)
✔ update: an empty partial update is accepted and returns an empty object (0.143498ms)
✔ UserTaskSchema embeds a nullable transaction projection alongside transactionId (1.009845ms)
✔ the event body accepts units or none — the asset class decides, not the schema (1.654083ms)
✔ only classes with a per-unit price are unitised (0.092498ms)
✔ real estate and silver are holdings, not accounts (0.158498ms)
✔ long-lived schemes, including NPS, are account types (0.145498ms)
✔ account last4 takes exactly 4 digits, or nothing (0.570437ms)
✔ account defaults leave institution and last4 unset (0.124498ms)
✔ NPS scheme allocation must total 100% (0.400544ms)
✔ NPS defaults to tier I (0.093498ms)
✔ NPS account details enforce the same E/C/G allocation (0.308498ms)
✔ gold purity applies to metal, not paper (0.448498ms)
✔ only SGBs mature (0.131498ms)
✔ retirement rate is basis points, capped at 100% (0.379498ms)
✔ StatementReconciliationSchema parses the Diners-shaped fixture, signed ledgerDuePaise verbatim (0.879106ms)
✔ StatementReconciliationSchema accepts a negative (credit) ledgerDuePaise, never clamped (0.084498ms)
✔ StatementReconciliationSchema accepts both ledger fields null (no statement date/total due) (0.069498ms)
✔ StatementReconciliationSchema rejects a response missing ledgerDuePaise/dueDriftPaise (required, not optional) (0.144498ms)
✔ UpsertDepositDetailsSchema rejects totalInstallments above MAX_RD_INSTALLMENTS (0.497198ms)
ℹ tests 352
ℹ suites 0
ℹ pass 352
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 314.175559
```

Additional formatting command:

```text
$ npx prettier --write apps/api/src/modules/tax/services/payslip-parse.ts apps/api/src/modules/tax/services/payslip-review.ts
exit code: 0

apps/api/src/modules/tax/services/payslip-parse.ts 64ms
apps/api/src/modules/tax/services/payslip-review.ts 32ms
```

Issues, risks, and deviations:

- No blockers or deviations encountered.
- The worktree already contained unrelated modified and untracked files; they were left untouched.

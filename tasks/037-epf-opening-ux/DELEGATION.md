# Sonnet Worker Delegation — EPF Opening Balance UX

## Task
037-epf-opening-ux

## Approved Plan
- P1: New `EpfOpeningSection` component in `AccountDetailPage.tsx`
- P2: Wire it into `AccountDetail` render (replace `OpeningBalanceSection` for EPF)
- P3: Remove EPS editing from `RetirementSection`, preserve value on save

## File
`apps/web/src/routes/settings/AccountDetailPage.tsx` — only file to change.

## Step 0 — Create branch
```bash
git -C /home/udai/common/compass checkout -b feat/epf-opening-balance-ux
```

## Required Changes

### P1 — New `EpfOpeningSection` component

Add this component. It replaces `OpeningBalanceSection` for EPF accounts only.

```tsx
function EpfOpeningSection({ account }: { account: AccountWithBalance }) {
  const { update } = useAccountMutations();
  const { data: retData, isPending: retIsPending } = useRetirementDetails(account.id, true);
  const saveRetirement = useRetirementDetailsMutation(account.id);

  const [totalText, setTotalText] = useState(() =>
    openingBalanceToInput(account.openingBalancePaise, account.type),
  );
  const [epsText, setEpsText] = useState("");
  const [sequencePending, setSequencePending] = useState(false);

  // Seed totalText when account data changes (mirrors OpeningBalanceSection)
  useEffect(() => {
    setTotalText(openingBalanceToInput(account.openingBalancePaise, account.type));
  }, [account.openingBalancePaise, account.type]);

  // Seed epsText once retirement details resolve (mirrors RetirementSection)
  useEffect(() => {
    if (!retData) return;
    setEpsText(
      retData.epsBalancePaise == null
        ? ""
        : (retData.epsBalancePaise / 100).toFixed(2).replace(/\.00$/, ""),
    );
  }, [retData]);

  // --- Parsing ---

  const totalPaise = openingBalanceFromInput(totalText, account.type); // null = invalid

  /** Strict EPS parser: blank → 0; decimal notation, ≤ 2dp, safe integer, ≥ 0. */
  function parseEpsInput(text: string): number | null {
    const trimmed = text.trim();
    if (trimmed === "") return 0;
    if (!/^\d*\.?\d{0,2}$/.test(trimmed) || trimmed === ".") return null;
    const rupees = Number(trimmed);
    if (!Number.isFinite(rupees) || rupees < 0) return null;
    const paise = rupeesToPaise(rupees);
    if (!Number.isSafeInteger(paise)) return null;
    return paise;
  }

  const epsPaise = parseEpsInput(epsText); // null = invalid

  const epfCorpusPaise =
    totalPaise !== null && epsPaise !== null ? totalPaise - epsPaise : null;

  // --- Errors ---

  const totalError = totalPaise === null ? "must be an amount in rupees" : null;
  const epsError = epsPaise === null ? "must be ≥ 0 with at most two decimal places" : null;
  const corpusError =
    epfCorpusPaise !== null && epfCorpusPaise < 0 ? "EPS cannot exceed total balance" : null;

  const hasError = totalError !== null || epsError !== null || corpusError !== null;

  // --- Dirty ---

  const retResolved = retData !== undefined; // retData === null means "row doesn't exist yet" — resolved

  const dirty =
    retResolved &&
    !hasError &&
    ((totalPaise !== null && totalPaise !== account.openingBalancePaise) ||
      (epsPaise !== null && epsPaise !== (retData?.epsBalancePaise ?? 0)));

  // --- Submit ---

  function submit(e: FormEvent) {
    e.preventDefault();
    if (hasError || totalPaise === null || epsPaise === null || !retResolved) return;
    setSequencePending(true);
    update.mutate(
      { id: account.id, openingBalancePaise: totalPaise },
      {
        onSuccess: () => {
          saveRetirement.mutate(
            {
              annualRateBps: retData?.annualRateBps ?? 0,
              maturityDate: null, // EPF never has a maturity date
              referenceNumber: retData?.referenceNumber ?? "",
              epsBalancePaise: epsPaise,
            },
            {
              onSuccess: () => {
                setSequencePending(false);
                toast("Opening balance saved", "success");
              },
              onError: () => {
                setSequencePending(false);
                toast("Balance saved, but EPS update failed — retry to fix");
              },
            },
          );
        },
        onError: () => {
          setSequencePending(false);
        },
      },
    );
  }

  const isPending = update.isPending || saveRetirement.isPending || sequencePending;

  if (retIsPending) {
    return (
      <Section title="Opening balance">
        <p className="text-sm text-slate-400">Loading…</p>
      </Section>
    );
  }

  return (
    <form onSubmit={submit}>
      <Section
        title="Opening balance"
        hint="Enter figures from your EPFO passbook. Total = Member PF account (EE + ER) + Pension (EPS) account combined."
      >
        <Field label="Total PF balance" error={totalError}>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">₹</span>
            <input
              value={totalText}
              onChange={(e) => setTotalText(e.target.value)}
              inputMode="decimal"
              aria-invalid={totalError !== null}
              className={`${inputClass} tabular-nums ${totalError ? "border-red-400" : ""}`}
            />
          </div>
        </Field>
        <Field label="Of which, EPS" error={epsError ?? corpusError}>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">₹</span>
            <input
              value={epsText}
              onChange={(e) => setEpsText(e.target.value)}
              inputMode="decimal"
              aria-invalid={epsError !== null || corpusError !== null}
              className={`${inputClass} tabular-nums ${epsError ?? corpusError ? "border-red-400" : ""}`}
            />
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Pension (EPS) corpus — part of the total above, not counted twice
          </p>
        </Field>
        <div className="space-y-2 rounded-md bg-slate-50 p-3">
          <DerivedRow
            label="EPF corpus"
            value={
              epfCorpusPaise !== null && epfCorpusPaise >= 0
                ? formatINR(epfCorpusPaise)
                : "—"
            }
            hint="total minus EPS (EE + ER share)"
          />
          <DerivedRow
            label="Current balance"
            value={formatINR(account.balancePaise)}
            hint="opening balance plus every contribution"
          />
        </div>
        <div className="pt-1">
          <SaveButton dirty={dirty} disabled={hasError || !retResolved} pending={isPending} />
        </div>
      </Section>
    </form>
  );
}
```

Note: `parseEpsInput` is defined inside the component since it's only used there.

### P2 — Wire into `AccountDetail`

In `AccountDetail`, replace:
```tsx
<OpeningBalanceSection account={account} />
```
with:
```tsx
{account.type === "epf" ? (
  <EpfOpeningSection account={account} />
) : (
  <OpeningBalanceSection account={account} />
)}
```

### P3 — Remove EPS editing from `RetirementSection`

From `RetirementSection`:

**Remove these state declarations:**
- `const [eps, setEps] = useState("");`
- The `useEffect` assignment line `setEps(data.epsBalancePaise == null ? "" : ...)` (one line inside the existing effect)
- `const epsPaise = ...` derived var
- `const epsError = ...` derived var

**Remove from `dirty`:**
- `(isEpf && epsPaise !== (data?.epsBalancePaise ?? null))`

**Remove from submit disabled/validation:**
- `|| epsError` in the `if (rateError || epsError) return;` guard

**Remove the JSX block:**
```tsx
{isEpf && (
  <Field label="EPS balance" error={epsError}>
    <div className="flex items-center gap-2">
      <span className="text-sm text-slate-400">₹</span>
      <input
        value={eps}
        onChange={(e) => setEps(e.target.value)}
        inputMode="decimal"
        placeholder="Pension balance"
        aria-invalid={epsError !== null}
        className={`${inputClass} ${epsError ? "border-red-400" : ""}`}
      />
    </div>
  </Field>
)}
```

**In the submit body, change the retirement payload to:**
```ts
epsBalancePaise: isEpf ? (data?.epsBalancePaise ?? null) : null,
```

**Keep `isEpf`** — it still drives:
- Maturity field conditional (`!isEpf && <Field label="Matures on">`)
- Hint text in the Section
- Reference label
- Placeholder
- The submit payload's `maturityDate: isEpf ? null : ...`
- The new `epsBalancePaise: isEpf ? (data?.epsBalancePaise ?? null) : null`

**Remove from SaveButton disabled:**
- `|| epsError !== null`

## Must Not Change
- Any other component in the file
- `OpeningBalanceSection` (unchanged)
- PPF, SSY, bank, NPS, overdraft sections
- Backend files

## Acceptance Criteria
- AC1: EPF account detail shows `EpfOpeningSection` (two fields + derived row)
- AC2: Scheme Details for EPF has no EPS editing field
- AC3: Saving Scheme Details (rate/UAN) for EPF preserves existing EPS value
- AC4: All non-EPF accounts still use `OpeningBalanceSection`
- AC5: `npm run typecheck` exits 0; `npm run lint` exits 0

## Commands
1. `git -C /home/udai/common/compass checkout -b feat/epf-opening-balance-ux`
2. (implement changes)
3. `npm run typecheck` from `/home/udai/common/compass`
4. `npm run lint` from `/home/udai/common/compass`

## Required Evidence
- Git branch name confirmation
- Diff of `AccountDetailPage.tsx`
- Literal output + exit codes for typecheck and lint
- Confirmation that `eps` state no longer appears in `RetirementSection`
- Confirmation that `EpfOpeningSection` is rendered for `type === "epf"`

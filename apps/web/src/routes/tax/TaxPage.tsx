import { useState } from "react";
import { formatINR } from "@compass/shared";
import { useMe } from "../../lib/auth.ts";
import { Meter, STATUS } from "../../lib/viz.tsx";
import { EmptyState, PageError, PageLoading } from "../../components/States.tsx";
import {
  useAdvanceTax,
  useDeductionBasket,
  useRegimeComparison,
  useTaxStatementDetail,
  useTaxStatementMutations,
  useTaxStatements,
} from "../../lib/tax-queries.ts";
import {
  bucketPct,
  currentFyLabel,
  fyChoices,
  instalmentState,
  regimeVerdict,
} from "./tax-view.ts";

/**
 * TaxPage — the Phase-13 tax surface (task 13.14).
 *
 * Four sections, all estimates on a stated FY basis:
 *   1. Deduction basket — legally distinct caps on separate meters (the two 80D
 *      groups are never pooled; 80CCD(2) meters against its derived entry cap).
 *   2. Regime comparison — both regimes side by side with the crossover stated;
 *      new-regime users are told plainly that chasing 80C is pointless.
 *   3. Advance tax — the four Sec 211 instalments with 234B/234C exposure.
 *   4. AIS/26AS/Form-16 statements — staged, reviewable discrepancies; nothing
 *      here ever writes to the ledger by itself.
 */

const INSTALMENT_LABELS = ["Jun (15%)", "Sep (45%)", "Dec (75%)", "Mar (100%)"] as const;

const DOC_KIND_LABEL: Record<string, string> = {
  ais: "AIS",
  "26as": "Form 26AS",
  form16: "Form 16",
};

export function TaxPage() {
  const [fy, setFy] = useState(currentFyLabel());

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Tax</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Estimates on a stated basis — never a filed position.
          </p>
        </div>
        <select
          aria-label="Financial year"
          className="input w-auto"
          value={fy}
          onChange={(e) => setFy(e.target.value)}
        >
          {fyChoices().map((f) => (
            <option key={f} value={f}>
              FY {f}
            </option>
          ))}
        </select>
      </header>

      <EstimateBanner fy={fy} />
      <DeductionBasketSection fy={fy} />
      <RegimeComparisonSection fy={fy} />
      <AdvanceTaxSection fy={fy} />
      <StatementsSection fy={fy} />
    </div>
  );
}

function EstimateBanner({ fy }: { fy: string }) {
  return (
    <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
      Everything below is an <strong>estimate</strong> for FY {fy}, computed from your
      recorded data with simplifying assumptions shown per section. It informs decisions;
      it is not a filed return and not tax advice.
    </p>
  );
}

// ─── 1. Deduction basket ──────────────────────────────────────────────────────

interface Bucket {
  key: string;
  title: string;
  capLabel: string;
  contributedPaise: number;
  capPaise: number | null; // null ⇒ regime suppressed this bucket
  eligiblePaise: number;
}

function DeductionBasketSection({ fy }: { fy: string }) {
  const { data, isLoading, isError } = useDeductionBasket(fy);
  if (isLoading) return <PageLoading label="Computing deduction basket…" />;
  if (isError || !data) return <PageError message="Could not load the deduction basket." />;

  const isNew = data.regime === "new";
  // 80D's two groups carry legally SEPARATE caps (₹25k/₹50k self+family vs
  // ₹50k senior parents) — they are rendered as distinct meters, never pooled.
  // 80CCD(2)'s aggregate cap is derived from its per-entry caps (rate × each
  // employer's Basic+DA); it applies under BOTH regimes so it is never
  // suppressed.
  const ccd2CapPaise = data.eightyCcd2.entries.reduce((s, e) => s + e.capPaise, 0);
  const ccd2CapLabel =
    data.eightyCcd2.entries.length === 0
      ? "% of salary"
      : `${(ccd2CapPaise / 100).toLocaleString("en-IN")} cap`;
  const buckets: Bucket[] = [
    {
      key: "80C",
      title: "80C",
      capLabel: "₹1.5L cap",
      contributedPaise: data.eightyC.contributedPaise,
      // Under the new regime these deductions simply do not apply — show the
      // fact rather than a headroom bar that quietly does not count.
      capPaise: isNew ? null : data.eightyC.capPaise,
      eligiblePaise: data.eightyC.eligiblePaise,
    },
    {
      key: "80CCD1B",
      title: "80CCD(1B) · NPS",
      capLabel: "₹50k cap",
      contributedPaise: data.eightyCcd1b.contributedPaise,
      capPaise: isNew ? null : data.eightyCcd1b.capPaise,
      eligiblePaise: data.eightyCcd1b.eligiblePaise,
    },
    {
      key: "80CCD2",
      title: "80CCD(2) · employer NPS",
      capLabel: ccd2CapLabel,
      contributedPaise: data.eightyCcd2.contributedPaise,
      capPaise: ccd2CapPaise,
      eligiblePaise: data.eightyCcd2.eligiblePaise,
    },
    {
      key: "80D-self",
      title: `80D · health (self${data.eightyD.selfFamily.seniorApplies ? "+family, senior" : "+family"})`,
      capLabel: "₹25k / ₹50k cap",
      contributedPaise: data.eightyD.selfFamily.contributedPaise,
      capPaise: isNew ? null : data.eightyD.selfFamily.capPaise,
      eligiblePaise: data.eightyD.selfFamily.eligiblePaise,
    },
    {
      key: "80D-parents",
      title: `80D · health (parents${data.eightyD.parents.seniorApplies ? ", senior" : ""})`,
      capLabel: "₹25k / ₹50k cap",
      contributedPaise: data.eightyD.parents.contributedPaise,
      capPaise: isNew ? null : data.eightyD.parents.capPaise,
      eligiblePaise: data.eightyD.parents.eligiblePaise,
    },
  ];

  const assumptions = [...data.eightyC.assumptions];

  return (
    <section className="card p-5" aria-label="Deduction basket">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-800">Deduction basket</h2>
        <span className="badge">{isNew ? "new regime" : `${data.regime} regime`}</span>
      </div>
      {isNew && (
        <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
          You are assessed under the new regime: 80C, 80CCD(1B) and 80D deductions do not
          apply to you. Only 80CCD(2) counts either way.
        </p>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {buckets.map((b) => (
          <div key={b.key} className="rounded-lg border border-slate-100 p-3">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium text-slate-700">{b.title}</span>
              <span className="text-xs text-slate-400">{b.capLabel}</span>
            </div>
            {b.capPaise == null ? (
              <p className="mt-2 text-xs text-slate-500">
                Contributed {formatINR(b.contributedPaise)} — not deductible under your regime.
              </p>
            ) : (
              <>
                <div className="mt-2">
                  <Meter pct={bucketPct(b.contributedPaise, b.capPaise)} />
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  {formatINR(b.contributedPaise)} of {formatINR(b.capPaise)} · eligible{" "}
                  {formatINR(b.eligiblePaise)}
                </p>
              </>
            )}
          </div>
        ))}
      </div>
      {assumptions.length > 0 && (
        <Assumptions items={assumptions} />
      )}
    </section>
  );
}

function Assumptions({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-xs font-medium text-slate-400 hover:text-slate-600"
        aria-expanded={open}
      >
        {open ? "Hide assumptions" : `Assumptions (${items.length})`}
      </button>
      {open && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-500">
          {items.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── 2. Regime comparison ─────────────────────────────────────────────────────

function RegimeComparisonSection({ fy }: { fy: string }) {
  const { data, isLoading, isError } = useRegimeComparison(fy);
  if (isLoading) return <PageLoading label="Comparing regimes…" />;
  if (isError || !data) return <PageError message="Could not load the regime comparison." />;

  const verdict = regimeVerdict(data);
  // Amounts are formatted here via formatINR — the pure helper stays
  // structured so no hand-built currency strings exist anywhere.
  const headline =
    verdict.recommendation === "new"
      ? `The new regime is cheaper for you by ${formatINR(verdict.savingPaise)}.`
      : verdict.recommendation === "old"
        ? `The old regime is cheaper for you by ${formatINR(verdict.savingPaise)} this year.`
        : "Both regimes cost the same for you this year.";

  return (
    <section className="card p-5" aria-label="Regime comparison">
      <h2 className="text-sm font-semibold text-slate-800">Old vs new regime</h2>
      <p className="mt-1 text-sm text-slate-700">{headline}</p>
      {verdict.deductionNote && (
        <p className="mt-1 text-xs text-slate-500">{verdict.deductionNote}</p>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {[data.old, data.new].map((r) => (
          <div
            key={r.regime}
            className={`rounded-lg border p-3 ${
              data.recommendation === r.regime ? "border-emerald-300 bg-emerald-50/40" : "border-slate-100"
            }`}
          >
            <div className="flex items-baseline justify-between">
              <span className="font-medium capitalize text-slate-700">{r.regime} regime</span>
              <span className="text-sm font-semibold text-slate-800">
                {formatINR(r.totalLiabilityPaise)}
              </span>
            </div>
            <dl className="mt-2 space-y-1 text-xs text-slate-500">
              <Row k="Taxable income" v={formatINR(r.taxableIncomePaise)} />
              <Row k="Total deductions" v={formatINR(r.deductions.totalDeductionsPaise)} />
              <Row k="Rebate 87A" v={formatINR(r.rebate87APaise)} />
              <Row k="Effective rate" v={`${(r.effectiveRateBps / 100).toFixed(1)}%`} />
            </dl>
          </div>
        ))}
      </div>
      {data.crossoverDeductionPaise != null && (
        <p className="mt-3 text-xs text-slate-500">
          Crossover: old-regime tax equals new-regime tax once total deductions reach{" "}
          {formatINR(data.crossoverDeductionPaise)}.
        </p>
      )}
      <Assumptions items={data.assumptions} />
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt>{k}</dt>
      <dd className="tabular-nums text-slate-700">{v}</dd>
    </div>
  );
}

// ─── 3. Advance tax ───────────────────────────────────────────────────────────

function AdvanceTaxSection({ fy }: { fy: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const { data, isLoading, isError } = useAdvanceTax(fy);
  if (isLoading) return <PageLoading label="Building the advance-tax schedule…" />;
  if (isError || !data) return <PageError message="Could not load the advance-tax position." />;
  if (data.seniorCitizenExempt) {
    return (
      <section className="card p-5" aria-label="Advance tax">
        <h2 className="text-sm font-semibold text-slate-800">Advance tax</h2>
        <p className="mt-2 text-sm text-slate-600">
          Likely exempt as a resident senior citizen without business income (Sec 207).
          Compass does not track residence or business income — if either applies to
          you, the exemption may NOT and the schedule below would.
        </p>
      </section>
    );
  }

  return (
    <section className="card overflow-x-auto p-5" aria-label="Advance tax">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">Advance tax schedule</h2>
        <p className="text-xs text-slate-500">
          Assessed tax {formatINR(data.assessedTaxPaise)} · interest exposure{" "}
          <span style={{ color: data.interestTotalPaise > 0 ? STATUS.warning : undefined }}>
            {formatINR(data.interestTotalPaise)}
          </span>{" "}
          (234C {formatINR(data.interest234CTotalPaise)} · 234B{" "}
          {formatINR(data.interest234BPaise)})
        </p>
      </div>
      <table className="mt-3 w-full min-w-[560px] text-left text-xs">
        <thead className="text-slate-400">
          <tr>
            <th className="py-1 font-medium">Instalment</th>
            <th className="py-1 font-medium">Due</th>
            <th className="py-1 font-medium">Required cumulative</th>
            <th className="py-1 font-medium">TDS credit</th>
            <th className="py-1 font-medium">Shortfall</th>
            <th className="py-1 font-medium">234C</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 tabular-nums text-slate-700">
          {data.instalments.map((inst, i) => {
            const past = instalmentState(inst.dueDate, today) === "past";
            return (
              <tr key={inst.dueDate} className={past ? "" : "text-slate-400"}>
                <td className="py-1.5">{INSTALMENT_LABELS[i] ?? inst.dueDate}</td>
                <td className="py-1.5">{inst.dueDate}</td>
                <td className="py-1.5">{formatINR(inst.requiredCumulativePaise)}</td>
                <td className="py-1.5">{formatINR(inst.cumulativeTdsPaise)}</td>
                <td className="py-1.5">{formatINR(inst.shortfallPaise)}</td>
                <td className="py-1.5">{formatINR(inst.interest234CPaise)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">
        Payments are not tracked yet, so shortfall equals the full requirement — TDS credits
        stand in for tax already paid. Interest accrues only on instalments whose due date has passed.
      </p>
      <Assumptions items={data.assumptions} />
    </section>
  );
}

// ─── 4. AIS / 26AS statements ─────────────────────────────────────────────────

function StatementsSection({ fy }: { fy: string }) {
  const { data, isLoading, isError } = useTaxStatements(fy);
  const [openId, setOpenId] = useState<string | null>(null);
  const mutations = useTaxStatementMutations();
  const { data: me } = useMe();
  // Demo sessions are rejected server-side on every mutating method — mirror
  // that here so the buttons say why they do nothing instead of erroring.
  const isDemo = me?.isDemo ?? false;

  return (
    <section className="card p-5" aria-label="AIS and 26AS reconciliation">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">AIS / 26AS reconciliation</h2>
        {isDemo && <span className="badge">demo — read only</span>}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        What the department reports against what you have recorded. Discrepancies are review
        items only — nothing is applied to your ledger automatically.
      </p>
      {isLoading && <PageLoading label="Loading statements…" />}
      {isError && <PageError message="Could not load staged statements." />}
      {data && data.statements.length === 0 && (
        <EmptyState
          title="No staged statements"
          hint="Import one from the AIS/26AS portal, or enter its lines via the API — discrepancies will appear here for review."
        />
      )}
      {data && data.statements.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100">
          {data.statements.map((s) => (
            <li key={s.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  className="text-left"
                  onClick={() => setOpenId(openId === s.id ? null : s.id)}
                  aria-expanded={openId === s.id}
                >
                  <span className="text-sm font-medium text-slate-700">
                    {DOC_KIND_LABEL[s.docKind] ?? s.docKind} · FY {s.fy}
                    {s.sourceLabel ? ` — ${s.sourceLabel}` : ""}
                  </span>
                  <span className="ml-2 badge">{s.status}</span>
                </button>
                <div className="flex items-center gap-3 text-xs">
                  <MatchStat n={s.matchedCount} label="matched" tone="ok" />
                  <MatchStat n={s.amountMismatchCount} label="amount mismatch" tone="warn" />
                  <MatchStat n={s.unmatchedCount} label="unmatched" tone="info" />
                  {/* Ledger events for this FY that no reported line accounted for. */}
                  <MatchStat n={s.unmatchedLedgerCount} label="ledger only" tone="info" />
                  {!isDemo && (
                    <>
                      {s.status === "pending" && (
                        <>
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1 text-xs"
                            disabled={mutations.accept.isPending}
                            onClick={() => mutations.accept.mutate(s.id)}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1 text-xs"
                            disabled={mutations.reject.isPending}
                            onClick={() => mutations.reject.mutate(s.id)}
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {/* Pending imports can be discarded outright; accepted/
                          rejected ones stay as the review record, so deleting
                          is their only remaining action. */}
                      <button
                        type="button"
                        className="btn-secondary px-2 py-1 text-xs"
                        title="Delete this staged statement and its stored document"
                        disabled={mutations.remove.isPending}
                        onClick={() => {
                          if (confirm("Delete this statement and its attached document? Nothing was ever applied to your ledger.")) {
                            mutations.remove.mutate(s.id);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
              {openId === s.id && <StatementLines id={s.id} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MatchStat({ n, label, tone }: { n: number; label: string; tone: "ok" | "warn" | "info" }) {
  const color =
    n === 0
      ? "text-slate-400"
      : tone === "ok"
        ? "text-emerald-600"
        : tone === "warn"
          ? "text-amber-600"
          : "text-slate-600";
  return (
    <span className={`${color} font-medium`}>
      {n} {label}
    </span>
  );
}

function StatementLines({ id }: { id: string }) {
  const { data, isLoading, isError } = useTaxStatementDetail(id);
  if (isLoading) return <PageLoading label="Loading lines…" />;
  if (isError || !data) return <PageError message="Could not load statement lines." />;

  return (
    <div className="mt-2">
      {data.lines.length === 0 ? (
        <p className="text-xs text-slate-500">No lines were reported on this document.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead className="text-slate-400">
              <tr>
                <th className="py-1 font-medium">Category</th>
                <th className="py-1 font-medium">Payer</th>
                <th className="py-1 font-medium">Section</th>
                <th className="py-1 font-medium">Gross</th>
                <th className="py-1 font-medium">TDS</th>
                <th className="py-1 font-medium">Verdict</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {data.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-1.5 capitalize">{l.category}</td>
                  <td className="py-1.5">{l.payerName ?? "—"}</td>
                  <td className="py-1.5">{l.section ?? "—"}</td>
                  <td className="py-1.5 tabular-nums">{formatINR(l.grossPaise)}</td>
                  <td className="py-1.5 tabular-nums">{formatINR(l.tdsPaise)}</td>
                  <td className="py-1.5">
                    {l.matchStatus === "matched" ? (
                      <span className="text-emerald-600">matched ledger</span>
                    ) : l.matchStatus === "amount_mismatch" ? (
                      <span className="text-amber-600">amount differs from your entry</span>
                    ) : (
                      <span>not in your ledger — record it?</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.unmatchedLedgerEvents.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <p className="text-xs font-medium text-slate-500">
            Recorded in your ledger but not in this statement
          </p>
          <table className="mt-1 w-full min-w-[420px] text-left text-xs">
            <thead className="text-slate-400">
              <tr>
                <th className="py-1 font-medium">Kind</th>
                <th className="py-1 font-medium">Payer</th>
                <th className="py-1 font-medium">Accrued</th>
                <th className="py-1 font-medium">Gross</th>
                <th className="py-1 font-medium">TDS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-600">
              {data.unmatchedLedgerEvents.map((e) => (
                <tr key={e.id}>
                  <td className="py-1.5 capitalize">{e.incomeKind}</td>
                  <td className="py-1.5">{e.payerName ?? "—"}</td>
                  <td className="py-1.5">{e.accrualDate}</td>
                  <td className="py-1.5 tabular-nums">{formatINR(e.grossPaise)}</td>
                  <td className="py-1.5 tabular-nums">{formatINR(e.tdsPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

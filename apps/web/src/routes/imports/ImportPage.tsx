import { useState } from "react";
import {
  DATE_FORMATS,
  formatINR,
  type ImportBatch,
  type ImportMapping,
  type ImportRow,
} from "@compass/shared";
import { toast } from "../../lib/toast.tsx";
import { useAccounts, useCategories } from "../../lib/queries.ts";
import {
  useBankPresets,
  useImportBatch,
  useImportMutations,
  useImportRows,
  useImports,
} from "../../lib/import-queries.ts";

const PAGE_SIZE = 50;

export function ImportPage() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const { data: batch } = useImportBatch(activeId);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-4 text-2xl font-semibold text-slate-800">Import</h1>
      {activeId === null ? (
        <>
          <UploadCard onStaged={(b) => setActiveId(b.id)} />
          <History onOpen={(b) => setActiveId(b.id)} />
        </>
      ) : batch ? (
        <BatchWorkbench batch={batch} onBack={() => setActiveId(null)} />
      ) : (
        <p className="text-sm text-slate-500">Loading…</p>
      )}
    </div>
  );
}

// ---------- step 1: upload ----------

function UploadCard({ onStaged }: { onStaged: (b: ImportBatch) => void }) {
  const { data: accounts } = useAccounts();
  const { upload } = useImportMutations();
  const active = accounts?.filter((a) => !a.archivedAt) ?? [];
  const [accountId, setAccountId] = useState("");
  const effAccount = accountId || active[0]?.id || "";

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">Upload a bank statement (CSV)</h2>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-600">
          Into account{" "}
          <select
            value={effAccount}
            onChange={(e) => setAccountId(e.target.value)}
            className="ml-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {active.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={!effAccount || upload.isPending}
          className="text-sm text-slate-500"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f && effAccount) {
              upload.mutate(
                { accountId: effAccount, file: f },
                {
                  onSuccess: (b) => {
                    toast(`Staged ${b.rowCount} rows`, "success");
                    onStaged(b);
                  },
                },
              );
            }
            e.target.value = "";
          }}
        />
        {upload.isPending && <span className="text-sm text-slate-400">Uploading & parsing…</span>}
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Nothing touches your transactions until you commit. Saved mappings and bank presets are
        applied automatically when the columns match.
      </p>
    </div>
  );
}

// ---------- step 2+3: mapping + preview ----------

function BatchWorkbench({ batch, onBack }: { batch: ImportBatch; onBack: () => void }) {
  const staged = batch.status === "staged";
  return (
    <div>
      <button onClick={onBack} className="mb-3 text-sm text-slate-500 underline">
        ← All imports
      </button>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-slate-800">{batch.fileName}</h2>
        <span className="text-sm text-slate-500">
          {batch.rowCount} rows · {batch.errorCount} errors · <StatusBadge status={batch.status} />
        </span>
      </div>
      {staged && <MappingEditor batch={batch} />}
      {batch.mapping && <RowsTable batch={batch} />}
      {staged && batch.mapping && <CommitBar batch={batch} onDone={onBack} />}
      {batch.status === "committed" && <RollbackBar batch={batch} onDone={onBack} />}
    </div>
  );
}

function StatusBadge({ status }: { status: ImportBatch["status"] }) {
  const styles = {
    staged: "bg-amber-100 text-amber-700",
    committed: "bg-emerald-100 text-emerald-700",
    rolled_back: "bg-slate-100 text-slate-500",
  } as const;
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs ${styles[status]}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function MappingEditor({ batch }: { batch: ImportBatch }) {
  const { data: presets } = useBankPresets();
  const { setMapping } = useImportMutations();
  const [draft, setDraft] = useState<ImportMapping>(
    batch.mapping ?? {
      dateColumn: batch.headers[0] ?? "",
      dateFormat: "DD/MM/YYYY",
      amountMode: "signed",
      amountColumn: "",
      invertSign: false,
      merchantColumn: batch.headers[1] ?? "",
    },
  );
  const [saveAsPreset, setSaveAsPreset] = useState(false);

  const col = (value: string | undefined, set: (v: string) => void, allowNone = false) => (
    <select
      value={value ?? ""}
      onChange={(e) => set(e.target.value)}
      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
    >
      {allowNone && <option value="">—</option>}
      {batch.headers.map((h) => (
        <option key={h} value={h}>
          {h}
        </option>
      ))}
    </select>
  );

  const valid =
    draft.dateColumn &&
    draft.merchantColumn &&
    (draft.amountMode === "signed" ? draft.amountColumn : draft.debitColumn && draft.creditColumn);

  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Column mapping</h3>
        <select
          defaultValue=""
          onChange={(e) => {
            const p = presets?.find((x) => x.name === e.target.value);
            if (p) setDraft(p.mapping);
          }}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="">Apply preset…</option>
          {presets?.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-4 text-sm text-slate-600">
        <label className="flex flex-col gap-1">
          Date {col(draft.dateColumn, (v) => setDraft({ ...draft, dateColumn: v }))}
        </label>
        <label className="flex flex-col gap-1">
          Format
          <select
            value={draft.dateFormat}
            onChange={(e) =>
              setDraft({ ...draft, dateFormat: e.target.value as ImportMapping["dateFormat"] })
            }
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {DATE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Merchant {col(draft.merchantColumn, (v) => setDraft({ ...draft, merchantColumn: v }))}
        </label>
        <label className="flex flex-col gap-1">
          Notes{" "}
          {col(draft.notesColumn, (v) => setDraft({ ...draft, notesColumn: v || undefined }), true)}
        </label>
        <label className="flex flex-col gap-1">
          Amount style
          <select
            value={draft.amountMode}
            onChange={(e) =>
              setDraft({ ...draft, amountMode: e.target.value as ImportMapping["amountMode"] })
            }
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="signed">Single signed column</option>
            <option value="debit_credit">Separate debit / credit</option>
          </select>
        </label>
        {draft.amountMode === "signed" ? (
          <>
            <label className="flex flex-col gap-1">
              Amount {col(draft.amountColumn, (v) => setDraft({ ...draft, amountColumn: v }), true)}
            </label>
            <label className="flex items-center gap-1 pb-1">
              <input
                type="checkbox"
                checked={draft.invertSign}
                onChange={(e) => setDraft({ ...draft, invertSign: e.target.checked })}
              />
              positive = money out
            </label>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              Debit {col(draft.debitColumn, (v) => setDraft({ ...draft, debitColumn: v }), true)}
            </label>
            <label className="flex flex-col gap-1">
              Credit {col(draft.creditColumn, (v) => setDraft({ ...draft, creditColumn: v }), true)}
            </label>
          </>
        )}
        <label className="flex items-center gap-1 pb-1">
          <input
            type="checkbox"
            checked={saveAsPreset}
            onChange={(e) => setSaveAsPreset(e.target.checked)}
          />
          save for this account
        </label>
        <button
          disabled={!valid || setMapping.isPending}
          onClick={() =>
            setMapping.mutate(
              { id: batch.id, mapping: draft, saveAsPreset },
              { onSuccess: () => toast("Rows parsed", "success") },
            )
          }
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {setMapping.isPending ? "Parsing…" : "Parse rows"}
        </button>
      </div>
    </div>
  );
}

function RowsTable({ batch }: { batch: ImportBatch }) {
  const staged = batch.status === "staged";
  const [offset, setOffset] = useState(0);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const { data } = useImportRows(batch.id, { offset, limit: PAGE_SIZE, onlyProblems });
  const { data: categories } = useCategories();
  const { updateRow } = useImportMutations();

  if (!data) return null;
  const patch = (
    row: ImportRow,
    body: { include?: boolean; duplicate?: boolean; categoryId?: string | null },
  ) => updateRow.mutate({ importId: batch.id, rowId: row.id, ...body });

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-sm">
        <label className="flex items-center gap-1 text-slate-600">
          <input
            type="checkbox"
            checked={onlyProblems}
            onChange={(e) => {
              setOnlyProblems(e.target.checked);
              setOffset(0);
            }}
          />
          only duplicates & errors
        </label>
        <span className="text-slate-400">
          {data.totalCount === 0
            ? "no rows"
            : `${offset + 1}–${Math.min(offset + PAGE_SIZE, data.totalCount)} of ${data.totalCount}`}
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className="ml-3 disabled:opacity-30"
          >
            ←
          </button>
          <button
            disabled={offset + PAGE_SIZE >= data.totalCount}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="ml-2 disabled:opacity-30"
          >
            →
          </button>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="px-3 py-1.5">use</th>
              <th className="px-2 py-1.5">date</th>
              <th className="px-2 py-1.5">merchant</th>
              <th className="px-2 py-1.5">category</th>
              <th className="px-2 py-1.5 text-right">amount</th>
              <th className="px-2 py-1.5">flags</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((row) => (
              <tr
                key={row.id}
                className={`border-b border-slate-50 ${row.include && !row.error ? "" : "opacity-50"}`}
              >
                <td className="px-3 py-1">
                  <input
                    type="checkbox"
                    disabled={!staged || row.error !== null}
                    checked={row.include}
                    onChange={(e) => patch(row, { include: e.target.checked })}
                  />
                </td>
                <td className="px-2 py-1 text-slate-500">{row.date ?? "—"}</td>
                <td
                  className="max-w-64 truncate px-2 py-1 font-medium text-slate-700"
                  title={row.rawMerchant}
                >
                  {row.merchant || row.rawMerchant || "—"}
                </td>
                <td className="px-2 py-1">
                  {staged && row.error === null ? (
                    <select
                      value={row.categoryId ?? ""}
                      onChange={(e) =>
                        patch(row, { categoryId: e.target.value === "" ? null : e.target.value })
                      }
                      className="w-40 rounded border border-slate-200 px-1 py-0.5 text-xs"
                    >
                      <option value="">Uncategorized</option>
                      {categories
                        ?.filter((c) => !c.archivedAt)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <span className="text-slate-400">
                      {categories?.find((c) => c.id === row.categoryId)?.name ?? "—"}
                    </span>
                  )}
                </td>
                <td
                  className={`px-2 py-1 text-right tabular-nums ${(row.amountPaise ?? 0) >= 0 ? "text-emerald-600" : "text-slate-700"}`}
                >
                  {row.amountPaise === null ? "—" : formatINR(row.amountPaise)}
                </td>
                <td className="px-2 py-1">
                  {row.error && (
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                      {row.error}
                    </span>
                  )}
                  {row.duplicate && (
                    <button
                      disabled={!staged}
                      title="Flagged as duplicate — click to keep anyway"
                      onClick={() => patch(row, { duplicate: false, include: true })}
                      className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 hover:bg-amber-200"
                    >
                      duplicate ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CommitBar({ batch, onDone }: { batch: ImportBatch; onDone: () => void }) {
  const { commit, remove } = useImportMutations();
  return (
    <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3">
      <button
        onClick={() => remove.mutate(batch.id, { onSuccess: onDone })}
        className="text-sm text-red-600 underline"
      >
        Discard batch
      </button>
      <button
        disabled={commit.isPending}
        onClick={() =>
          commit.mutate(batch.id, {
            onSuccess: (r) => {
              toast(
                `Imported ${r.created} transactions (${r.skippedDuplicates} duplicates, ${r.skippedErrors} errors, ${r.skippedExcluded} excluded skipped)`,
                "success",
              );
              const net = `Net ${formatINR(r.netPaise)}`;
              const links =
                r.linkedTransfers > 0
                  ? ` · ${r.linkedTransfers} payment(s) linked as transfers`
                  : "";
              toast(`${net} imported — reconcile against your statement total.${links}`, "success");
            },
          })
        }
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {commit.isPending ? "Committing…" : "Commit import"}
      </button>
    </div>
  );
}

function RollbackBar({ batch, onDone }: { batch: ImportBatch; onDone: () => void }) {
  const { rollback } = useImportMutations();
  return (
    <div className="mt-3 flex items-center justify-end rounded-lg border border-slate-200 bg-white p-3">
      <button
        disabled={rollback.isPending}
        onClick={() => {
          if (confirm("Remove every transaction created by this import?")) {
            rollback.mutate(batch.id, {
              onSuccess: (r) => {
                toast(`Rolled back ${r.removed} transactions`, "success");
                onDone();
              },
            });
          }
        }}
        className="rounded-md border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        {rollback.isPending ? "Rolling back…" : "Roll back this import"}
      </button>
    </div>
  );
}

// ---------- history ----------

function History({ onOpen }: { onOpen: (b: ImportBatch) => void }) {
  const { data: batches } = useImports();
  const { data: accounts } = useAccounts();
  if (!batches || batches.length === 0) return null;
  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white">
      <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
        Import history
      </h2>
      {batches.map((b) => (
        <button
          key={b.id}
          onClick={() => onOpen(b)}
          className="flex w-full items-center justify-between border-b border-slate-50 px-4 py-2 text-left text-sm hover:bg-slate-50"
        >
          <span className="font-medium text-slate-700">{b.fileName}</span>
          <span className="flex items-center gap-3 text-slate-500">
            <span>{accounts?.find((a) => a.id === b.accountId)?.name}</span>
            <span>{b.rowCount} rows</span>
            <span>{new Date(b.createdAt).toLocaleDateString()}</span>
            <StatusBadge status={b.status} />
          </span>
        </button>
      ))}
    </div>
  );
}
